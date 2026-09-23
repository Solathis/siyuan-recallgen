import { jsonrepair } from "jsonrepair";
import { t } from "@/lib/i18n";

/**
 * 题目 JSON Schema：遵循标准规则（additionalProperties:false + required + 简单类型）。
 * answer 字段不约束 type（因题型不同类型不同），仅用 description 说明。
 */
export const QUIZ_SCHEMA = {
    type: "object",
    properties: {
        questions: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    type: {
                        type: "string",
                        enum: ["single_choice", "multiple_choice", "fill_blank", "true_false", "subjective", "coding"],
                    },
                    difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
                    question: { type: "string" },
                    options: {
                        type: "array",
                        items: { type: "string" },
                        description: "选项文本数组，仅 single_choice/multiple_choice 使用",
                    },
                    answer: {
                        description:
                            "single_choice:number; multiple_choice:number[]; true_false:boolean; fill_blank:string[][]; coding:string",
                    },
                    reference_answer: { type: "string", description: "主观题参考答案要点 / 编程题参考说明" },
                    language: { type: "string", description: "编程题语言：python/javascript/go 等" },
                    starter_code: { type: "string", description: "编程题初始代码模板" },
                    test_cases: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                input: { type: "string" },
                                expected: { type: "string" },
                                description: { type: "string" },
                            },
                            required: ["input", "expected"],
                            additionalProperties: false,
                        },
                    },
                    explanation: { type: "string" },
                    tags: {
                        type: "array",
                        items: { type: "string" },
                        description: "1-3 个知识点标签，用于统计薄弱知识点，如「二叉树遍历」「HTTP 缓存」",
                    },
                },
                required: ["type", "difficulty", "question"],
                additionalProperties: false,
            },
        },
    },
    required: ["questions"],
    additionalProperties: false,
} as const;

/** 审题结果 Schema：{reviews:[{index,passed,reason}]} */
export const REVIEW_SCHEMA = {
    type: "object",
    properties: {
        reviews: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    index: { type: "number", description: "题目索引（0-based）" },
                    passed: { type: "boolean", description: "是否通过审核" },
                    reason: { type: "string", description: "不通过时的原因说明" },
                },
                required: ["index", "passed"],
                additionalProperties: false,
            },
        },
    },
    required: ["reviews"],
    additionalProperties: false,
} as const;

/** 判分结果 Schema：{score:number, comment:string} */
export const GRADING_SCHEMA = {
    type: "object",
    properties: {
        score: { type: "number", minimum: 0, maximum: 100 },
        comment: { type: "string" },
    },
    required: ["score", "comment"],
    additionalProperties: false,
} as const;

/** 构建 tools/function calling 声明（遵循标准格式） */
export function buildTools(name: string, description: string, schema: object): unknown[] {
    return [
        {
            type: "function",
            function: { name, description, parameters: schema },
        },
    ];
}

/** 构建强制工具选择：要求模型必须调用指定函数 */
export function buildToolChoice(name: string): unknown {
    return { type: "function", function: { name } };
}

/** 仅强制返回合法 JSON（jsonSchemaEnabled=false 时使用） */
export function buildJsonObjectResponseFormat(): unknown {
    return { type: "json_object" };
}

/**
 * 宽松解析 LLM 文本输出：依次尝试直接解析、提取 JSON 后修复解析。
 * 处理 AI 回复中包含前导文字、代码围栏、后置文字等情况。
 */
export function parseJsonLoose(text: string): unknown {
    const cleaned = stripCodeFence(text);
    // 1. 直接解析
    try {
        return JSON.parse(cleaned);
    } catch {
        /* 继续容错 */
    }
    // 2. 从文本中提取第一个完整 JSON 对象后解析
    const extracted = extractJsonObject(cleaned);
    if (extracted) {
        try {
            return JSON.parse(extracted);
        } catch {
            /* 继续修复 */
        }
        try {
            return JSON.parse(jsonrepair(extracted));
        } catch (e) {
            throw new Error(t("schema.parseFailed", (e as Error).message, cleaned.slice(0, 200)));
        }
    }
    // 3. 对全文做 jsonrepair 最后尝试
    try {
        return JSON.parse(jsonrepair(cleaned));
    } catch (e) {
        throw new Error(t("schema.parseFailed", (e as Error).message, cleaned.slice(0, 200)));
    }
}

/** 剥离 LLM 常见的 ```json 包裹（仅在文本开头时生效，避免截断 JSON 内部的代码块） */
function stripCodeFence(text: string): string {
    const trimmed = text.trim();
    if (!trimmed.startsWith("```")) return trimmed;
    const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
    return m ? m[1].trim() : trimmed;
}

/**
 * 用括号计数从文本中提取第一个完整 JSON 对象/数组。
 * 正确处理字符串内的括号和转义符。
 */
function extractJsonObject(text: string): string | null {
    const start = text.indexOf("{");
    const startArr = text.indexOf("[");
    // 取最早出现的 { 或 [
    let begin = -1;
    if (start >= 0 && startArr >= 0) begin = Math.min(start, startArr);
    else if (start >= 0) begin = start;
    else if (startArr >= 0) begin = startArr;
    else return null;

    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = begin; i < text.length; i++) {
        const ch = text[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (ch === "\\") {
            escape = true;
            continue;
        }
        if (ch === '"') {
            inStr = !inStr;
            continue;
        }
        if (inStr) continue;
        if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") {
            depth--;
            if (depth === 0) return text.slice(begin, i + 1);
        }
    }
    return null;
}
