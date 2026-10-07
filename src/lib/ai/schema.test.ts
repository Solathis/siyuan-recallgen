import { describe, expect, it } from "vitest";
import {
    buildJsonObjectResponseFormat,
    buildToolChoice,
    buildTools,
    describeJsonShape,
    extractQuestionArray,
    GRADING_SCHEMA,
    isJsonTruncated,
    parseJsonDetailed,
    parseJsonLoose,
} from "./schema";

describe("parseJsonLoose", () => {
    it("直接解析合法 JSON 对象", () => {
        expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    });

    it("剥离 ```json 代码围栏", () => {
        expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });

    it("剥离无语言标记的代码围栏", () => {
        expect(parseJsonLoose('```\n{"a":1}\n```')).toEqual({ a: 1 });
    });

    it("从带前导说明文字的输出中提取 JSON 对象", () => {
        expect(parseJsonLoose('好的，结果如下：\n{"a":1}\n希望有帮助')).toEqual({ a: 1 });
    });

    it("从带前后文字的输出中提取 JSON 数组", () => {
        expect(parseJsonLoose("结果：[1,2,3] 完毕")).toEqual([1, 2, 3]);
    });

    it("用 jsonrepair 修复尾随逗号", () => {
        expect(parseJsonLoose('{"a":1,}')).toEqual({ a: 1 });
    });

    it("正确跳过字符串字面量内部的括号", () => {
        expect(parseJsonLoose('{"a":"}{"}')).toEqual({ a: "}{" });
    });

    it("正确跳过字符串内部的转义引号", () => {
        expect(parseJsonLoose('{"a":"\\"}"}')).toEqual({ a: '"}' });
    });

    it("无法修复的输入抛出带原文片段的错误", () => {
        expect(() => parseJsonLoose("{{{")).toThrow(/JSON 解析失败/);
    });

    it("纯文本会被 jsonrepair 包装成 JSON 字符串而非抛错", () => {
        // 记录现有行为：jsonrepair 把裸文本变成字符串字面量，
        // 因此调用方必须自行校验结构（例如 parsed.questions 是否存在）
        expect(parseJsonLoose("完全不是 JSON")).toBe("完全不是 JSON");
    });

    it("被截断的对象会被修复为字段缺失的部分对象", () => {
        // 记录现有行为：残缺输入会得到看似合法但字段为 null 的对象
        expect(parseJsonLoose('{"questions":')).toEqual({ questions: null });
    });

    it("顶层 JSON 字面量 null 会被原样返回", () => {
        // 记录现有行为：调用方必须自行判空，否则 `parsed.score` 会抛 TypeError
        expect(parseJsonLoose("null")).toBeNull();
    });
});

describe("isJsonTruncated / parseJsonDetailed", () => {
    it("完整 JSON 不算截断", () => {
        expect(isJsonTruncated('{"questions":[]}')).toBe(false);
        expect(isJsonTruncated('结果：{"a":1} 完毕')).toBe(false);
    });

    it("括号未闭合判为截断（maxTokens 不够的典型形态）", () => {
        expect(isJsonTruncated('{"questions":[{"type":"single_choice","question":"甲"}')).toBe(true);
        expect(isJsonTruncated('{"questions":')).toBe(true);
    });

    it("字符串内部未闭合也算截断", () => {
        expect(isJsonTruncated('{"question":"这句话没写完')).toBe(true);
    });

    it("字符串里的括号不会被误判", () => {
        expect(isJsonTruncated('{"a":"}{[]"}')).toBe(false);
    });

    it("没有 JSON 起始符的纯文本不算截断（形状问题另判）", () => {
        expect(isJsonTruncated("完全不是 JSON")).toBe(false);
    });

    it("parseJsonDetailed 标出「靠修复才解析成功」", () => {
        expect(parseJsonDetailed('{"a":1}')).toMatchObject({ repaired: false, truncated: false });
        expect(parseJsonDetailed('{"a":1,}')).toMatchObject({ repaired: true, truncated: false });
    });

    it("parseJsonDetailed 在被截断的输入上同时给出 repaired 与 truncated", () => {
        const d = parseJsonDetailed('{"questions":');
        expect(d.repaired).toBe(true);
        expect(d.truncated).toBe(true);
    });

    it("parseJsonLoose 仍是 parseJsonDetailed 的取值包装", () => {
        expect(parseJsonLoose('{"a":1,}')).toEqual(parseJsonDetailed('{"a":1,}').value);
    });
});

describe("extractQuestionArray", () => {
    const q = { type: "single_choice", question: "题干", difficulty: "easy" };

    it("顶层 questions 数组", () => {
        expect(extractQuestionArray({ questions: [q] })?.items).toEqual([q]);
    });

    it("兼容 questions 为空数组（形状正确，交给上层报空）", () => {
        expect(extractQuestionArray({ questions: [] })?.items).toEqual([]);
    });

    it("兼容 data / items / list / result / 中文键等别名", () => {
        for (const key of ["data", "items", "list", "result", "results", "题目", "题目列表", "试题"]) {
            expect(extractQuestionArray({ [key]: [q] })?.items, key).toEqual([q]);
        }
    });

    it("值为「装着 JSON 的字符串」时能拆开（模型偶发双重编码）", () => {
        const hit = extractQuestionArray({ questions: JSON.stringify([q]) });
        expect(hit?.items).toEqual([q]);
        expect(hit?.path).toContain("string");
    });

    it("数组嵌在更深的层级里也能找到", () => {
        expect(extractQuestionArray({ result: { quiz: { questions: [q] } } })?.items).toEqual([q]);
    });

    it("优先选更长的题目数组，而不是先遇到的杂数组", () => {
        const hit = extractQuestionArray({ meta: { tags: ["a", "b"] }, questions: [q, q, q] });
        expect(hit?.items).toHaveLength(3);
    });

    it("整体就是一道题时包成单元素数组", () => {
        expect(extractQuestionArray(q)?.items).toEqual([q]);
    });

    it("没有题目数组时返回 null", () => {
        for (const bad of [null, undefined, "纯文本", 42, { foo: 1 }, { tags: ["a"] }, [{ foo: 1 }]]) {
            expect(extractQuestionArray(bad), JSON.stringify(bad)).toBeNull();
        }
    });

    it("被截断后修复成 {questions:null} 的对象不再被当成有题目", () => {
        const parsed = parseJsonLoose('{"questions":') as Record<string, unknown>;
        expect(extractQuestionArray(parsed)).toBeNull();
    });
});

describe("describeJsonShape", () => {
    it("报出类型与顶层字段，便于把死胡同变成可诊断信息", () => {
        expect(describeJsonShape({ questions: null, meta: 1 })).toEqual({
            type: "object",
            keys: ["questions", "meta"],
        });
        expect(describeJsonShape([1, 2, 3])).toEqual({ type: "array", keys: ["[3]"] });
        expect(describeJsonShape(null)).toEqual({ type: "null", keys: [] });
        expect(describeJsonShape("x")).toEqual({ type: "string", keys: [] });
    });

    it("顶层字段过多时截断，避免错误信息爆炸", () => {
        const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
        expect(describeJsonShape(many).keys.length).toBeLessThanOrEqual(8);
    });
});

describe("buildTools / buildToolChoice / buildJsonObjectResponseFormat", () => {
    it("将 schema 包装为 function calling 声明", () => {
        const tools = buildTools("recallgen_grading", "判分", GRADING_SCHEMA as object);
        expect(tools).toHaveLength(1);
        expect(tools[0]).toMatchObject({
            type: "function",
            function: { name: "recallgen_grading", description: "判分" },
        });
    });

    it("强制指定工具选择", () => {
        expect(buildToolChoice("f")).toEqual({ type: "function", function: { name: "f" } });
    });

    it("宽松模式仅要求返回合法 JSON 对象", () => {
        expect(buildJsonObjectResponseFormat()).toEqual({ type: "json_object" });
    });
});
