import { jsonrepair } from "jsonrepair";

/**
 * 题目 JSON Schema：统一对象 + type 鉴别字段。
 * answer 字段使用 anyOf 联合类型，兼容所有题型答案格式。
 * strict:false 宽松模式，兼容 OpenAI 与第三方 API 网关。
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
                        anyOf: [
                            { type: "number" },
                            { type: "boolean" },
                            { type: "string" },
                            { type: "array", items: { type: "number" } },
                            { type: "array", items: { type: "array", items: { type: "string" } } },
                        ],
                        description: "single_choice:number; multiple_choice:number[]; true_false:boolean; fill_blank:string[][]; coding:string",
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
                        },
                    },
                    explanation: { type: "string" },
                },
                required: ["type", "difficulty", "question"],
            },
        },
    },
    required: ["questions"],
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
            },
        },
    },
    required: ["reviews"],
} as const;

/** 判分结果 Schema：{score:number, comment:string} */
export const GRADING_SCHEMA = {
    type: "object",
    properties: {
        score: { type: "number", minimum: 0, maximum: 100 },
        comment: { type: "string" },
    },
    required: ["score", "comment"],
} as const;

/** OpenAI 兼容 json_schema response_format（strict=false 以兼容宽松模型） */
export function buildJsonSchemaResponseFormat(name: string, schema: object): unknown {
    return {
        type: "json_schema",
        json_schema: { name, schema, strict: false },
    };
}

/** 仅强制返回合法 JSON（不支持 json_schema 的模型走此路径） */
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
    } catch { /* 继续容错 */ }
    // 2. 从文本中提取第一个完整 JSON 对象后解析
    const extracted = extractJsonObject(cleaned);
    if (extracted) {
        try {
            return JSON.parse(extracted);
        } catch { /* 继续修复 */ }
        try {
            return JSON.parse(jsonrepair(extracted));
        } catch (e) {
            throw new Error(`JSON 解析失败: ${(e as Error).message}`);
        }
    }
    // 3. 对全文做 jsonrepair 最后尝试
    try {
        return JSON.parse(jsonrepair(cleaned));
    } catch (e) {
        throw new Error(`JSON 解析失败: ${(e as Error).message}（原文前200字: ${cleaned.slice(0, 200)}）`);
    }
}

/** 剥离 LLM 常见的 ```json 包裹 */
function stripCodeFence(text: string): string {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return m ? m[1].trim() : text.trim();
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
        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") {
            depth--;
            if (depth === 0) return text.slice(begin, i + 1);
        }
    }
    return null;
}
