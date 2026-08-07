import { jsonrepair } from "jsonrepair";

/**
 * 题目 JSON Schema：统一对象 + type 鉴别字段，permissive（非 strict），
 * 兼容 OpenAI json_schema 与不支持该格式的模型（后者仅作提示词引导）。
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
                        description: "single_choice:数字索引；multiple_choice:数字索引数组；true_false:布尔；fill_blank:每空可接受答案的二维数组；subjective:空；coding:参考答案代码",
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
 * 宽松解析 LLM 文本输出：先 JSON.parse，失败则用 jsonrepair 修复后重试。
 * 用于非 schema 约束路径的容错。
 */
export function parseJsonLoose(text: string): unknown {
    const cleaned = stripCodeFence(text);
    try {
        return JSON.parse(cleaned);
    } catch {
        try {
            return JSON.parse(jsonrepair(cleaned));
        } catch (e) {
            throw new Error(`JSON 解析失败: ${(e as Error).message}`);
        }
    }
}

/** 剥离 LLM 常见的 ```json 包裹 */
function stripCodeFence(text: string): string {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return m ? m[1].trim() : text.trim();
}
