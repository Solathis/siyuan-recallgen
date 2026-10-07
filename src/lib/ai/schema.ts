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
                    entry_point: { type: "string", description: "编程题的入口函数名（用于自动运行测试用例）" },
                    test_cases: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                input: { type: "string", description: "输入的可读描述" },
                                args: {
                                    type: "array",
                                    description: "调用入口函数时传入的参数列表，例如 [3, 4]",
                                },
                                expected: { type: "string", description: "期望的返回值（JSON 或字符串）" },
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
    return parseJsonDetailed(text).value;
}

/** JSON 解析诊断：除了结果，还说明「是否需要修复」与「是否疑似被截断」 */
export interface JsonParseDiagnosis {
    value: unknown;
    /** 模型没给出严格合法 JSON，靠 jsonrepair 才解析出来 */
    repaired: boolean;
    /** 括号/引号未闭合，典型是输出被 maxTokens 截断 */
    truncated: boolean;
}

/**
 * 带诊断的宽松解析。
 *
 * 为什么需要 truncated：被截断的 JSON 会被 jsonrepair「修」成看似合法的残缺对象
 * （`{"questions":` → `{questions:null}`），只看解析结果无法区分
 * 「模型给错了形状」和「模型没说完」，用户只会拿到一句
 * 「缺少 questions 数组（解析结果类型：object）」，完全猜不到要调大 Max Tokens。
 */
export function parseJsonDetailed(text: string): JsonParseDiagnosis {
    const cleaned = stripCodeFence(text);
    const truncated = isJsonTruncated(cleaned);
    // 1. 直接解析
    try {
        return { value: JSON.parse(cleaned), repaired: false, truncated };
    } catch {
        /* 继续容错 */
    }
    // 2. 从文本中提取第一个完整 JSON 对象后解析
    const extracted = extractJsonObject(cleaned);
    if (extracted) {
        try {
            return { value: JSON.parse(extracted), repaired: false, truncated };
        } catch {
            /* 继续修复 */
        }
        try {
            return { value: JSON.parse(jsonrepair(extracted)), repaired: true, truncated };
        } catch (e) {
            throw new Error(t("schema.parseFailed", (e as Error).message, cleaned.slice(0, 200)));
        }
    }
    // 3. 对全文做 jsonrepair 最后尝试
    try {
        return { value: JSON.parse(jsonrepair(cleaned)), repaired: true, truncated };
    } catch (e) {
        throw new Error(t("schema.parseFailed", (e as Error).message, cleaned.slice(0, 200)));
    }
}

/**
 * 判断文本里的 JSON 是否「没写完」。
 *
 * 做法：从第一个 `{` 或 `[` 开始按括号深度扫描（忽略字符串内部），
 * 若走到末尾深度都没回到 0（或停在未闭合的字符串里），就是被截断了。
 * 纯文本（没有 JSON 起始符）返回 false——那是形状问题，不是截断问题。
 */
export function isJsonTruncated(text: string): boolean {
    const begin = firstJsonStart(text);
    if (begin < 0) return false;
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (let i = begin; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
            if (escape) escape = false;
            else if (ch === "\\") escape = true;
            else if (ch === '"') inStr = false;
            continue;
        }
        if (ch === '"') {
            inStr = true;
            continue;
        }
        if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") {
            depth--;
            if (depth === 0) return false;
        }
    }
    return true;
}

/** 第一个 `{` 或 `[` 的位置；没有则返回 -1 */
function firstJsonStart(text: string): number {
    const obj = text.indexOf("{");
    const arr = text.indexOf("[");
    if (obj >= 0 && arr >= 0) return Math.min(obj, arr);
    return obj >= 0 ? obj : arr;
}

/** 题目数组的抽取结果；path 仅用于诊断信息 */
export interface QuestionArrayHit {
    items: unknown[];
    path: string;
}

/** 模型可能用这些键装题目数组（中英文都见过） */
const QUESTION_KEYS = [
    "questions",
    "question",
    "data",
    "items",
    "list",
    "quiz",
    "result",
    "results",
    "题目",
    "题目列表",
    "试题",
];

/** 单个元素是否像一道题 */
function isQuestionLike(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const o = value as Record<string, unknown>;
    return typeof o.question === "string" || typeof o.type === "string" || "answer" in o;
}

/**
 * 把值当成题目数组来认；不像则返回 null。
 *
 * 允许夹杂少量不合格元素（交给校验层逐题丢弃），
 * 但过半都不像题目时说明这不是题目数组（例如误命中 tags:["a","b"]）。
 */
function asQuestionArray(value: unknown): unknown[] | null {
    if (!Array.isArray(value)) return null;
    if (value.length === 0) return value;
    const like = value.filter(isQuestionLike).length;
    return like * 2 >= value.length ? value : null;
}

function tryParseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/** 在对象里递归找题目数组，取最长的那个（深度上限 3） */
function findQuestionArrayDeep(value: unknown, depth: number, path: string): QuestionArrayHit | null {
    if (depth <= 0 || !value || typeof value !== "object" || Array.isArray(value)) return null;
    let best: QuestionArrayHit | null = null;
    const better = (hit: QuestionArrayHit | null): void => {
        if (hit && hit.items.length > 0 && (!best || hit.items.length > best.items.length)) best = hit;
    };
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const here = `${path}.${key}`;
        better({ items: asQuestionArray(child) ?? [], path: here });
        better(findQuestionArrayDeep(child, depth - 1, here));
        if (typeof child === "string") {
            better({ items: asQuestionArray(tryParseJson(child)) ?? [], path: `${here}(string)` });
        }
    }
    return best;
}

/**
 * 从任意解析结果里找出题目数组。
 *
 * 只认 `parsed.questions` 时，模型把题目放在 `data`/`items`/中文键下、
 * 整条回复就是一道题、或数组被多包了一层，都会变成「缺少 questions 数组」，
 * 而模型其实已经给出了可用的题目。
 */
export function extractQuestionArray(parsed: unknown): QuestionArrayHit | null {
    if (parsed === null || parsed === undefined) return null;

    const top = asQuestionArray(parsed);
    if (top) return { items: top, path: "$" };

    if (typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const obj = parsed as Record<string, unknown>;
    // 先按约定键找；空数组先记下但继续找，避免 {data:[], questions:[…]} 选错
    let emptyHit: QuestionArrayHit | null = null;
    for (const key of QUESTION_KEYS) {
        if (!(key in obj)) continue;
        const hit = asQuestionArray(obj[key]);
        if (hit && hit.length > 0) return { items: hit, path: key };
        if (hit && !emptyHit) emptyHit = { items: hit, path: key };
        if (typeof obj[key] === "string") {
            const fromString = asQuestionArray(tryParseJson(obj[key] as string));
            if (fromString && fromString.length > 0) return { items: fromString, path: `${key}(string)` };
        }
    }
    if (emptyHit) return emptyHit;

    const deep = findQuestionArrayDeep(obj, 3, "$");
    if (deep) return deep;
    // 整条回复就是一道题
    if (isQuestionLike(parsed)) return { items: [parsed], path: "$(single)" };
    return null;
}

/** 顶层形状摘要，用于把「解析不出来」变成可诊断的错误信息 */
export function describeJsonShape(value: unknown): { type: string; keys: string[] } {
    if (value === null) return { type: "null", keys: [] };
    if (Array.isArray(value)) return { type: "array", keys: [`[${value.length}]`] };
    if (typeof value === "object") return { type: "object", keys: Object.keys(value as object).slice(0, 8) };
    return { type: typeof value, keys: [] };
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
