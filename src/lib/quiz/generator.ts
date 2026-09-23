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

    // 1. 生成
    onProgress?.("generating", 1, "AI 正在生成题目…");
    const genAI = resolveAI(ai, ai.roles.generator);
    const messages = buildGenerateMessages(prompts, general, content, types, difficulty);
    const callOpts = pickCallOpts(ai.jsonSchemaEnabled, "recallgen_quiz", "生成复习题目", QUIZ_SCHEMA as object);
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
        throw new AIError(
            `AI 返回缺少 questions 数组（解析后类型: ${parsed === null ? "null" : typeof parsed}）`,
            undefined,
            "parse"
        );
    }

    let skipped = 0;
    let questions = validateQuestions(rawQuestions, types, () => {
        skipped++;
    });
    if (skipped > 0) {
        onProgress?.("generating", 1, `已生成 ${questions.length} 题（丢弃 ${skipped} 道不合格题目）`);
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
        onProgress?.("reviewing", round, `第 ${round} 轮审题中…`);

        const reviewMessages = buildReviewMessages(prompts, questions);
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
                reasons.push(r.reason ?? "未通过审核");
            }
        }

        if (failedIndices.length === 0) {
            onProgress?.("reviewing", round, `第 ${round} 轮审题通过，共 ${questions.length} 题`);
            break;
        }

        if (round === MAX_REVIEW_ROUNDS) {
            onProgress?.("reviewing", round, `已达最大审题轮次，${failedIndices.length} 题仍未通过`);
            break;
        }

        // 重新生成失败题
        onProgress?.("regenerating", round, `第 ${round} 轮：重新生成 ${failedIndices.length} 道未通过题目…`);
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
        onProgress?.("regenerating", round, `第 ${round} 轮：已替换 ${replaced}/${failedIndices.length} 道题目`);
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
        return { ok: false, reason: "题目不是对象" };
    }
    const item = raw as Record<string, unknown>;
    const type = item.type as QuestionType;
    if (!allowedTypes.includes(type)) {
        return { ok: false, reason: `题型 ${String(item.type)} 未启用` };
    }
    const question = String(item.question ?? "").trim();
    if (!question) {
        return { ok: false, reason: "题干为空" };
    }
    const base = {
        id,
        type,
        difficulty: toDifficulty(item.difficulty),
        question,
        explanation: item.explanation ? String(item.explanation) : undefined,
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
            const reason = result.reason ?? "未知原因";
            reasons.push(reason);
            onSkip?.(reason);
        }
    }

    if (out.length === 0) {
        throw new AIError(
            raw.length === 0
                ? "AI 返回的 questions 数组为空"
                : `${raw.length} 道题目全部校验失败：${reasons.slice(0, 3).join("；")}`
        );
    }
    return out;
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
                throw new AIError("单选题选项或答案索引不合法");
            }
            return { ...base, type, options, answer } as Question;
        }
        case "multiple_choice": {
            const options = toStringArray(item.options);
            const answer = [...new Set(toNumberArray(item.answer))].sort((a, b) => a - b);
            if (options.length < 2 || answer.length === 0 || answer.some((i) => i < 0 || i >= options.length)) {
                throw new AIError("多选题选项或答案索引不合法");
            }
            return { ...base, type, options, answer } as Question;
        }
        case "fill_blank": {
            const answer = toAnswerMatrix(item.answer);
            if (answer.length === 0 || answer.some((opts) => opts.length === 0)) {
                throw new AIError("填空题答案缺失");
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
            throw new AIError("判断题 answer 不是布尔值");
        }
        case "subjective": {
            const reference_answer = String(item.reference_answer ?? "").trim();
            if (!reference_answer) {
                throw new AIError("主观题缺少参考答案");
            }
            return { ...base, type, reference_answer } as Question;
        }
        case "coding": {
            const language = String(item.language ?? "python");
            const answer = String(item.answer ?? "");
            const test_cases = Array.isArray(item.test_cases)
                ? item.test_cases.map((t) => ({
                      input:
                          (t as { input?: unknown })?.input !== undefined
                              ? String((t as { input: unknown }).input)
                              : undefined,
                      expected: String((t as { expected: unknown }).expected ?? ""),
                      description:
                          (t as { description?: unknown })?.description !== undefined
                              ? String((t as { description: unknown }).description)
                              : undefined,
                  }))
                : undefined;
            // 编程题至少要能对照参考答案或测试用例，否则无从判分
            if (!answer.trim() && !test_cases?.length) {
                throw new AIError("编程题缺少参考答案与测试用例");
            }
            return {
                ...base,
                type,
                language,
                starter_code: item.starter_code !== undefined ? String(item.starter_code) : undefined,
                test_cases,
                answer,
                reference_answer: item.reference_answer !== undefined ? String(item.reference_answer) : undefined,
            } as Question;
        }
        default:
            throw new AIError(`未知题型: ${String(type)}`);
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
