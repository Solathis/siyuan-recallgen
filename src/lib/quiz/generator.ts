import { callLLM, AIError, type ChatMessage } from "../ai/client";
import { buildGenerateMessages } from "../ai/prompts";
import {
    QUIZ_SCHEMA,
    buildJsonSchemaResponseFormat,
    buildJsonObjectResponseFormat,
    parseJsonLoose,
} from "../ai/schema";
import type { AIProvider, RecallGenConfig } from "@/types/config";
import type {
    DifficultyDistribution,
    Question,
    QuestionType,
} from "@/types/quiz";

/**
 * 调用 AI 生成题目，返回校验后的 Question[]。
 * 失败显式抛出 AIError；内容过短等前置校验由调用方（selector）处理。
 */
export async function generateQuestions(
    config: RecallGenConfig,
    content: string,
): Promise<Question[]> {
    const { prompts, general, ai } = config;
    const types = general.allowedTypes;
    const difficulty = general.difficulty;

    const messages = buildGenerateMessages(prompts, general, content, types, difficulty);
    const responseFormat = pickResponseFormat(ai.provider);
    const result = await callLLM(ai, messages as ChatMessage[], { responseFormat });

    const parsed = parseJsonLoose(result.content) as { questions?: unknown[] };
    if (!parsed?.questions || !Array.isArray(parsed.questions)) {
        throw new AIError("AI 返回缺少 questions 数组");
    }
    return validateQuestions(parsed.questions, types, difficulty);
}

/** 按 provider 选择 response_format：OpenAI 兼容用 json_schema，Ollama 用 json_object */
function pickResponseFormat(provider: AIProvider): unknown {
    if (provider === "ollama") {
        return buildJsonObjectResponseFormat();
    }
    return buildJsonSchemaResponseFormat("recallgen_quiz", QUIZ_SCHEMA as object);
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
