import { describe, expect, it } from "vitest";
import { buildJsonObjectResponseFormat, buildToolChoice, buildTools, GRADING_SCHEMA, parseJsonLoose } from "./schema";

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
