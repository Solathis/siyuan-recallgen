import { callLLM, resolveAI, AIError, type ChatMessage } from "../ai/client";
import { buildGenerateMessages, buildReviewMessages, buildRegenerateMessages } from "../ai/prompts";
import {
    QUIZ_SCHEMA,
    REVIEW_SCHEMA,
    buildJsonSchemaResponseFormat,
    buildJsonObjectResponseFormat,
    parseJsonLoose,
} from "../ai/schema";
import type { RecallGenConfig } from "@/types/config";
import type {
    DifficultyDistribution,
    Question,
    QuestionType,
} from "@/types/quiz";

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
    onProgress?: GenProgressCallback,
): Promise<Question[]> {
    const { prompts, general, ai } = config;
    const types = general.allowedTypes;
    const difficulty = general.difficulty;

    // 1. 生成
    onProgress?.("generating", 1, "AI 正在生成题目…");
    const genAI = resolveAI(ai, ai.roles.generator);
    const messages = buildGenerateMessages(prompts, general, content, types, difficulty);
    const responseFormat = pickResponseFormat(ai.jsonSchemaEnabled);
    const result = await callLLM(genAI, messages as ChatMessage[], { responseFormat });

    const parsed = parseJsonLoose(result.content) as { questions?: unknown[] };
    if (!parsed?.questions || !Array.isArray(parsed.questions)) {
        throw new AIError("AI 返回缺少 questions 数组");
    }
    let questions = validateQuestions(parsed.questions, types, difficulty);

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
    onProgress?: GenProgressCallback,
): Promise<Question[]> {
    const { ai, prompts } = config;
    const reviewAI = resolveAI(ai, ai.roles.reviewer);
    const genAI = resolveAI(ai, ai.roles.generator);
    const reviewFormat = pickReviewFormat(ai.jsonSchemaEnabled);
    const genFormat = pickResponseFormat(ai.jsonSchemaEnabled);
    const types = config.general.allowedTypes;
    const difficulty = config.general.difficulty;

    for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
        onProgress?.("reviewing", round, `第 ${round} 轮审题中…`);

        const reviewMessages = buildReviewMessages(prompts, questions);
        const reviewResult = await callLLM(reviewAI, reviewMessages as ChatMessage[], {
            responseFormat: reviewFormat,
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
        const regenResult = await callLLM(genAI, regenMessages as ChatMessage[], { responseFormat: genFormat });

        const regenParsed = parseJsonLoose(regenResult.content) as { questions?: unknown[] };
        if (!regenParsed?.questions || !Array.isArray(regenParsed.questions)) {
            break; // 重新生成失败，保留原题
        }
        const regenQuestions = validateQuestions(regenParsed.questions, types, difficulty);

        // 替换失败题（按顺序替换）
        for (let i = 0; i < failedIndices.length && i < regenQuestions.length; i++) {
            const newQ = regenQuestions[i];
            // 保持原题 id 不变
            newQ.id = questions[failedIndices[i]].id;
            questions[failedIndices[i]] = newQ;
        }
    }

    return questions;
}

/** 按 jsonSchemaEnabled 选择 response_format：true=json_schema（严格），false=json_object（宽松兼容） */
function pickResponseFormat(jsonSchemaEnabled: boolean): unknown {
    return jsonSchemaEnabled
        ? buildJsonSchemaResponseFormat("recallgen_quiz", QUIZ_SCHEMA as object)
        : buildJsonObjectResponseFormat();
}

/** 审题 response_format */
function pickReviewFormat(jsonSchemaEnabled: boolean): unknown {
    return jsonSchemaEnabled
        ? buildJsonSchemaResponseFormat("recallgen_review", REVIEW_SCHEMA as object)
        : buildJsonObjectResponseFormat();
}

/** 校验并转换为强类型 Question[]，赋 id */
function validateQuestions(
    raw: unknown[],
    allowedTypes: QuestionType[],
    _difficulty: DifficultyDistribution,
): Question[] {
    const out: Question[] = [];
    for (let i = 0; i < raw.length; i++) {
        const item = raw[i] as Record<string, unknown>;
        const type = item.type as QuestionType;
        if (!allowedTypes.includes(type)) {
            throw new AIError(`第 ${i + 1} 题：题型 ${type} 未启用`);
        }
        const base = {
            id: `q-${i + 1}`,
            type,
            difficulty: (item.difficulty as Question["difficulty"]) ?? "medium",
            question: String(item.question ?? ""),
            explanation: item.explanation ? String(item.explanation) : undefined,
            weight: 1,
        };
        out.push(coerceByType(base, type, item));
    }
    return out;
}

function coerceByType(
    base: Omit<Question, never>,
    type: QuestionType,
    item: Record<string, unknown>,
): Question {
    switch (type) {
        case "single_choice": {
            const options = toStringArray(item.options);
            const answer = toNumber(item.answer);
            if (options.length < 2 || answer === null || answer >= options.length) {
                throw new AIError("单选题字段不完整");
            }
            return { ...base, type, options, answer } as Question;
        }
        case "multiple_choice": {
            const options = toStringArray(item.options);
            const answer = toNumberArray(item.answer);
            if (options.length < 2 || answer.length === 0) {
                throw new AIError("多选题字段不完整");
            }
            return { ...base, type, options, answer } as Question;
        }
        case "fill_blank": {
            const answer = toAnswerMatrix(item.answer);
            if (answer.length === 0) {
                throw new AIError("填空题答案缺失");
            }
            return { ...base, type, answer } as Question;
        }
        case "true_false": {
            if (typeof item.answer !== "boolean") {
                throw new AIError("判断题 answer 非布尔");
            }
            return { ...base, type, answer: item.answer } as Question;
        }
        case "subjective": {
            const reference_answer = String(item.reference_answer ?? "");
            if (!reference_answer) {
                throw new AIError("主观题缺少参考答案");
            }
            return { ...base, type, reference_answer } as Question;
        }
        case "coding": {
            const language = String(item.language ?? "python");
            const test_cases = Array.isArray(item.test_cases)
                ? item.test_cases.map((t) => ({
                      input: (t as { input?: unknown })?.input !== undefined ? String((t as { input: unknown }).input) : undefined,
                      expected: String((t as { expected: unknown }).expected ?? ""),
                      description: (t as { description?: unknown })?.description !== undefined ? String((t as { description: unknown }).description) : undefined,
                  }))
                : undefined;
            return {
                ...base,
                type,
                language,
                starter_code: item.starter_code !== undefined ? String(item.starter_code) : undefined,
                test_cases,
                answer: String(item.answer ?? ""),
                reference_answer: item.reference_answer !== undefined ? String(item.reference_answer) : undefined,
            } as Question;
        }
        default:
            throw new AIError(`未知题型: ${type}`);
    }
}

function toStringArray(v: unknown): string[] {
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
}
function toNumber(v: unknown): number | null {
    return typeof v === "number" ? v : null;
}
function toNumberArray(v: unknown): number[] {
    return Array.isArray(v) ? v.map((x) => Number(x)).filter((n) => !Number.isNaN(n)) : [];
}
/** 填空题 answer: 二维数组 string[][] */
function toAnswerMatrix(v: unknown): string[][] {
    if (!Array.isArray(v)) return [];
    return v.map((blank) => Array.isArray(blank) ? blank.map((x) => String(x)) : [String(blank)]);
}
