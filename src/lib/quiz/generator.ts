import { t } from "@/lib/i18n";
import { dedupeQuestions, planBatches, renumberQuestions } from "./batching";
import { callLLM, resolveAI, AIError, type ChatMessage } from "../ai/client";
import { buildGenerateMessages, buildReviewMessages, buildRegenerateMessages } from "../ai/prompts";
import {
    QUIZ_SCHEMA,
    REVIEW_SCHEMA,
    buildTools,
    buildToolChoice,
    buildJsonObjectResponseFormat,
    parseJsonLoose,
} from "../ai/schema";
import type { RecallGenConfig } from "@/types/config";
import type { Difficulty, Question, QuestionType } from "@/types/quiz";

/** 审题进度回调：phase=当前阶段, round=当前轮次(1-based), detail=描述 */
export type GenProgressCallback = (phase: GenPhase, round: number, detail: string) => void;

export type GenPhase = "generating" | "reviewing" | "regenerating";

/** 审题结果 */
interface ReviewItem {
    index: number;
    passed: boolean;
    reason?: string;
}

const MAX_REVIEW_ROUNDS = 3;

/**
 * 调用 AI 生成题目，可选审题循环。
 * 流程：生成 → 审题 → (失败题重新生成 → 再审) × max 3 rounds。
 * onProgress 回调报告各阶段进度。
 */
export async function generateQuestions(
    config: RecallGenConfig,
    content: string,
    onProgress?: GenProgressCallback
): Promise<Question[]> {
    const { prompts, general, ai } = config;
    const types = general.allowedTypes;
    const difficulty = general.difficulty;

    // 1. 生成：题量超过单次上限时拆成多批，避免输出过长导致截断或超时
    const genAI = resolveAI(ai, ai.roles.generator);
    const callOpts = pickCallOpts(ai.jsonSchemaEnabled, "recallgen_quiz", "生成复习题目", QUIZ_SCHEMA as object);
    const batches = planBatches(difficulty);

    const collected: Question[] = [];
    let skipped = 0;
    for (let i = 0; i < batches.length; i++) {
        onProgress?.(
            "generating",
            1,
            batches.length > 1
                ? t("gen.batchProgress", String(i + 1), String(batches.length), String(batches[i].total))
                : t("quiz.generating")
        );

        const messages = buildGenerateMessages(prompts, general, content, types, batches[i]);
        const result = await callLLM(genAI, messages as ChatMessage[], callOpts);
        const parsed = parseJsonLoose(result.content) as Record<string, unknown>;

        // 兼容 AI 返回 {questions:[]} / {data:[]} / 直接返回数组等情况
        let rawQuestions: unknown[] | null = null;
        if (Array.isArray(parsed?.questions)) {
            rawQuestions = parsed.questions;
        } else if (Array.isArray(parsed?.data)) {
            rawQuestions = parsed.data;
        } else if (Array.isArray(parsed)) {
            rawQuestions = parsed;
        } else if (Array.isArray(parsed?.items)) {
            rawQuestions = parsed.items;
        }

        if (!rawQuestions) {
            // 分批时单批失败不该作废已成功的批次
            if (batches.length > 1 && collected.length > 0) {
                console.warn("[RecallGen] 某一批出题失败，保留已成功的批次", parsed);
                continue;
            }
            throw new AIError(t("gen.missingQuestions", parsed === null ? "null" : typeof parsed), undefined, "parse");
        }

        collected.push(
            ...validateQuestions(rawQuestions, types, () => {
                skipped++;
            })
        );
    }

    // 跨批也可能重复，去重后重新连续编号
    let questions = renumberQuestions(dedupeQuestions(collected));
    const discarded = skipped + (collected.length - questions.length);
    if (discarded > 0) {
        onProgress?.("generating", 1, t("gen.dropped", String(questions.length), String(discarded)));
    }

    // 2. 审题循环（仅当审题者模型存在时执行）
    if (ai.roles.reviewer && ai.models.some((m) => m.id === ai.roles.reviewer)) {
        questions = await reviewLoop(config, questions, content, onProgress);
    }

    return questions;
}

/** 审题循环：生成→审核→重新生成失败题→再审，最多 MAX_REVIEW_ROUNDS 轮 */
async function reviewLoop(
    config: RecallGenConfig,
    questions: Question[],
    content: string,
    onProgress?: GenProgressCallback
): Promise<Question[]> {
    const { ai, prompts } = config;
    const reviewAI = resolveAI(ai, ai.roles.reviewer);
    const genAI = resolveAI(ai, ai.roles.generator);
    const reviewOpts = pickCallOpts(ai.jsonSchemaEnabled, "recallgen_review", "审核题目质量", REVIEW_SCHEMA as object);
    const genOpts = pickCallOpts(ai.jsonSchemaEnabled, "recallgen_quiz", "生成复习题目", QUIZ_SCHEMA as object);
    const types = config.general.allowedTypes;

    for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
        onProgress?.("reviewing", round, t("gen.reviewing", String(round)));

        const reviewMessages = buildReviewMessages(prompts, questions, config.general.language);
        const reviewResult = await callLLM(reviewAI, reviewMessages as ChatMessage[], {
            ...reviewOpts,
            temperature: 0.3,
        });

        const reviewParsed = parseJsonLoose(reviewResult.content) as { reviews?: ReviewItem[] };
        const reviews = reviewParsed?.reviews;
        if (!reviews || !Array.isArray(reviews)) {
            // 审题结果解析失败，跳过审题
            break;
        }

        // 筛选未通过的题
        const failedIndices: number[] = [];
        const reasons: string[] = [];
        for (const r of reviews) {
            if (!r.passed && r.index >= 0 && r.index < questions.length) {
                failedIndices.push(r.index);
                reasons.push(r.reason ?? t("gen.reviewNoReason"));
            }
        }

        if (failedIndices.length === 0) {
            onProgress?.("reviewing", round, t("gen.reviewPassed", String(round), String(questions.length)));
            break;
        }

        if (round === MAX_REVIEW_ROUNDS) {
            onProgress?.("reviewing", round, t("gen.reviewMaxRounds", String(failedIndices.length)));
            break;
        }

        // 重新生成失败题
        onProgress?.("regenerating", round, t("gen.regenerating", String(round), String(failedIndices.length)));
        const failedQuestions = failedIndices.map((i) => questions[i]);
        const regenMessages = buildRegenerateMessages(prompts, config.general, failedQuestions, reasons, content);
        const regenResult = await callLLM(genAI, regenMessages as ChatMessage[], genOpts);

        const regenParsed = parseJsonLoose(regenResult.content) as { questions?: unknown[] } | null;
        if (!regenParsed || !Array.isArray(regenParsed.questions)) {
            break; // 重新生成失败，保留原题
        }

        // 逐题替换失败题；单题校验失败则保留原题
        let replaced = 0;
        for (let i = 0; i < failedIndices.length; i++) {
            const target = failedIndices[i];
            const result = coerceQuestion(regenParsed.questions[i], questions[target].id, types);
            if (!result.ok || !result.question) continue;
            questions[target] = result.question;
            replaced++;
        }
        onProgress?.(
            "regenerating",
            round,
            t("gen.regenerated", String(round), String(replaced), String(failedIndices.length))
        );
    }

    return questions;
}

/**
 * 按 jsonSchemaEnabled 选择调用选项：
 * true → tools/function calling（严格 Schema 约束）
 * false → response_format: json_object（宽松兼容）
 */
function pickCallOpts(
    jsonSchemaEnabled: boolean,
    name: string,
    description: string,
    schema: object
): { tools?: unknown[]; toolChoice?: unknown; responseFormat?: unknown } {
    if (jsonSchemaEnabled) {
        return {
            tools: buildTools(name, description, schema),
            toolChoice: buildToolChoice(name),
        };
    }
    return { responseFormat: buildJsonObjectResponseFormat() };
}

// ── 题目校验与类型收敛 ──────────────────────────────────────────────

export interface CoerceResult {
    ok: boolean;
    question?: Question;
    reason?: string;
}

/**
 * 单题宽松校验：任何字段问题都通过返回值上报，不抛异常。
 * 单题不合格只应被丢弃，而不应让整批生成作废。
 */
export function coerceQuestion(raw: unknown, id: string, allowedTypes: QuestionType[]): CoerceResult {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, reason: t("validate.notObject") };
    }
    const item = raw as Record<string, unknown>;
    const type = item.type as QuestionType;
    if (!allowedTypes.includes(type)) {
        return { ok: false, reason: t("validate.typeDisabled", String(item.type)) };
    }
    const question = String(item.question ?? "").trim();
    if (!question) {
        return { ok: false, reason: t("validate.emptyQuestion") };
    }
    const base = {
        id,
        type,
        difficulty: toDifficulty(item.difficulty),
        question,
        explanation: item.explanation ? String(item.explanation) : undefined,
        tags: toTags(item.tags),
    };
    try {
        return { ok: true, question: coerceByType(base, type, item) };
    } catch (e) {
        return { ok: false, reason: (e as Error).message };
    }
}

/**
 * 批量校验：逐题丢弃不合格题目，并按输出顺序重新编号为 q-1..q-n。
 * 仅当一道题都没通过时才抛错。
 */
export function validateQuestions(
    raw: unknown[],
    allowedTypes: QuestionType[],
    onSkip?: (reason: string) => void
): Question[] {
    const out: Question[] = [];
    const reasons: string[] = [];

    for (const item of raw) {
        const result = coerceQuestion(item, `q-${out.length + 1}`, allowedTypes);
        if (result.ok && result.question) {
            out.push(result.question);
        } else {
            const reason = result.reason ?? t("gen.unknownReason");
            reasons.push(reason);
            onSkip?.(reason);
        }
    }

    if (out.length === 0) {
        throw new AIError(
            raw.length === 0
                ? t("gen.emptyQuestions")
                : t("gen.allInvalid", String(raw.length), reasons.slice(0, 3).join("; "))
        );
    }
    return out;
}

/** 单题知识点标签数量上限 */
const MAX_TAGS = 3;
/** 单个标签长度上限 */
const MAX_TAG_LENGTH = 24;

/**
 * 归一化知识点标签：去空白、截断长度、按大小写不敏感去重，最多保留 MAX_TAGS 个。
 * 全部无效时返回 undefined，避免索引里出现空标签。
 */
export function toTags(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of value) {
        if (typeof raw !== "string" && typeof raw !== "number") continue;
        const tag = String(raw).trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(tag);
        if (out.length >= MAX_TAGS) break;
    }
    return out.length > 0 ? out : undefined;
}

function toDifficulty(value: unknown): Difficulty {
    const s = String(value ?? "").toLowerCase();
    return s === "easy" || s === "medium" || s === "hard" ? s : "medium";
}

function coerceByType(base: Omit<Question, never>, type: QuestionType, item: Record<string, unknown>): Question {
    switch (type) {
        case "single_choice": {
            const options = toStringArray(item.options);
            const answer = toNumber(item.answer);
            // 越界或负数索引会导致用户永远答不对，必须丢弃
            if (options.length < 2 || answer === null || answer < 0 || answer >= options.length) {
                throw new AIError(t("validate.singleChoice"));
            }
            return { ...base, type, options, answer } as Question;
        }
        case "multiple_choice": {
            const options = toStringArray(item.options);
            const answer = [...new Set(toNumberArray(item.answer))].sort((a, b) => a - b);
            if (options.length < 2 || answer.length === 0 || answer.some((i) => i < 0 || i >= options.length)) {
                throw new AIError(t("validate.multipleChoice"));
            }
            return { ...base, type, options, answer } as Question;
        }
        case "fill_blank": {
            const answer = toAnswerMatrix(item.answer);
            if (answer.length === 0 || answer.some((opts) => opts.length === 0)) {
                throw new AIError(t("validate.blankMissing"));
            }
            return { ...base, type, answer } as Question;
        }
        case "true_false": {
            if (typeof item.answer === "boolean") return { ...base, type, answer: item.answer } as Question;
            if (typeof item.answer === "string") {
                const s = item.answer.trim().toLowerCase();
                if (s === "true" || s === "正确" || s === "对" || s === "1") {
                    return { ...base, type, answer: true } as Question;
                }
                if (s === "false" || s === "错误" || s === "错" || s === "0") {
                    return { ...base, type, answer: false } as Question;
                }
            }
            if (typeof item.answer === "number") return { ...base, type, answer: item.answer !== 0 } as Question;
            throw new AIError(t("validate.notBoolean"));
        }
        case "subjective": {
            const reference_answer = String(item.reference_answer ?? "").trim();
            if (!reference_answer) {
                throw new AIError(t("validate.subjectiveNoRef"));
            }
            return { ...base, type, reference_answer } as Question;
        }
        case "coding": {
            const language = String(item.language ?? "python");
            const answer = String(item.answer ?? "");
            const test_cases = Array.isArray(item.test_cases)
                ? item.test_cases.map((t) => {
                      const raw = t as { input?: unknown; args?: unknown; expected?: unknown; description?: unknown };
                      return {
                          input: raw.input !== undefined ? String(raw.input) : undefined,
                          // args 保持原样：它要被当作实参调用入口函数，不能转成字符串
                          args: Array.isArray(raw.args) ? raw.args : undefined,
                          expected: String(raw.expected ?? ""),
                          description: raw.description !== undefined ? String(raw.description) : undefined,
                      };
                  })
                : undefined;
            // 编程题至少要能对照参考答案或测试用例，否则无从判分
            if (!answer.trim() && !test_cases?.length) {
                throw new AIError(t("validate.codingNoRef"));
            }
            return {
                ...base,
                type,
                language,
                entry_point: item.entry_point !== undefined ? String(item.entry_point).trim() || undefined : undefined,
                starter_code: item.starter_code !== undefined ? String(item.starter_code) : undefined,
                test_cases,
                answer,
                reference_answer: item.reference_answer !== undefined ? String(item.reference_answer) : undefined,
            } as Question;
        }
        default:
            throw new AIError(t("validate.unknownType", String(type)));
    }
}

function toStringArray(v: unknown): string[] {
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/** 数字或字母索引（A=0, B=1, …）转 0-based 索引 */
function toNumber(v: unknown): number | null {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
        const trimmed = v.trim();
        const n = parseInt(trimmed, 10);
        if (!Number.isNaN(n)) return n;
        const upper = trimmed.toUpperCase();
        if (upper.length === 1 && upper >= "A" && upper <= "Z") return upper.charCodeAt(0) - 65;
    }
    return null;
}

function toNumberArray(v: unknown): number[] {
    if (!Array.isArray(v)) return [];
    return v.map((x) => toNumber(x)).filter((n): n is number => n !== null);
}

/** 填空题 answer: 二维数组 string[][]，单个答案会包成一元数组 */
function toAnswerMatrix(v: unknown): string[][] {
    if (!Array.isArray(v)) return [];
    return v.map((blank) => (Array.isArray(blank) ? blank.map((x) => String(x)) : [String(blank)]));
}
