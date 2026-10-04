import { describe, expect, it } from "vitest";
import { AIError } from "./client";
import { describeError, describeHttp } from "./errors";

describe("describeError", () => {
    it("网络类错误标题不带 kind 名（回归：曾显示「网络错误（network）」）", () => {
        const described = describeError(new AIError("boom", undefined, "network"));
        expect(described.title).not.toContain("network");
    });

    it("截断错误给出可操作建议", () => {
        const described = describeError(new AIError("cut", undefined, "truncated"));
        expect(described.title).toContain("截断");
        expect(described.hint).toContain("MaxTokens");
    });

    it("各类 kind 都能给出标题与建议", () => {
        for (const kind of ["config", "timeout", "parse", "network", "truncated"] as const) {
            const described = describeError(new AIError("x", undefined, kind));
            expect(described.title.length, kind).toBeGreaterThan(0);
            expect(described.hint.length, kind).toBeGreaterThan(0);
        }
    });

    it("非 AIError 回落到通用提示", () => {
        expect(describeError(new Error("x")).title).toBeTruthy();
        expect(describeError("字符串错误").detail).toBe("字符串错误");
    });
});

describe("describeHttp", () => {
    it("未特殊处理的状态码按请求失败归类，而不是网络错误", () => {
        const described = describeHttp(404, "model not found");
        expect(described.title).toContain("404");
        expect(described.title).not.toContain("网络");
    });

    it("400 / 401 / 429 / 5xx 保持针对性提示", () => {
        expect(describeHttp(400, "").hint).toContain("JSON Schema");
        expect(describeHttp(401, "").title).toContain("401");
        expect(describeHttp(403, "").title).toContain("403");
        expect(describeHttp(429, "").title).toContain("429");
        expect(describeHttp(503, "").title).toContain("503");
    });

    it("没有状态码时回落到通用提示", () => {
        expect(describeHttp(undefined, "").title).toBeTruthy();
    });
});
