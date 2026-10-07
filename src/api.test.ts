import { describe, expect, it } from "vitest";
import { quoteSqlLiteral, request } from "./api";
import { __resetFetchSyncPost, __setFetchSyncPost } from "@/test/siyuan-stub";

describe("quoteSqlLiteral", () => {
    it("包成单引号字面量", () => {
        expect(quoteSqlLiteral("abc")).toBe("'abc'");
        expect(quoteSqlLiteral("")).toBe("''");
    });

    it("单引号按 SQL 规则双写，注入尝试被中和", () => {
        // 思源 SQL 没有参数绑定，只能拼接，这里是唯一的防线
        expect(quoteSqlLiteral("O'Brien")).toBe("'O''Brien'");
        expect(quoteSqlLiteral("' OR 1=1 --")).toBe("''' OR 1=1 --'");
        expect(quoteSqlLiteral("a'; drop table blocks; --")).toBe("'a''; drop table blocks; --'");
    });

    it("反斜杠不需要转义（SQLite 的字符串字面量里它不是转义符）", () => {
        expect(quoteSqlLiteral("a\\b")).toBe("'a\\b'");
    });

    it("注释与换行不会被破坏成非法 SQL", () => {
        expect(quoteSqlLiteral("a\nb")).toBe("'a\nb'");
        expect(quoteSqlLiteral("-- x")).toBe("'-- x'");
    });
});

describe("request", () => {
    const okResponse = (data: unknown) => ({
        code: 0,
        msg: "",
        data,
    });

    it("默认取 data 字段", async () => {
        __setFetchSyncPost(() => okResponse({ id: "x" }));
        await expect(request("/api/example", {})).resolves.toEqual({ id: "x" });
        __resetFetchSyncPost();
    });

    it("code 非 0 时返回 null（调用方据此走回退路径）", async () => {
        __setFetchSyncPost(() => ({ code: -1, msg: "boom", data: { id: "x" } }));
        await expect(request("/api/example", {})).resolves.toBeNull();
        __resetFetchSyncPost();
    });

    it("returnType=response 时返回完整响应，便于读取 msg", async () => {
        __setFetchSyncPost(() => ({ code: 1, msg: "仅登录用户可用", data: null }));
        const res = (await request("/api/example", {}, "response")) as { code: number; msg: string };
        expect(res.code).toBe(1);
        expect(res.msg).toBe("仅登录用户可用");
        __resetFetchSyncPost();
    });

    it("把 payload 原样透传给内核接口", async () => {
        const seen: unknown[] = [];
        __setFetchSyncPost((url, data) => {
            seen.push([url, data]);
            return okResponse(null);
        });
        await request("/api/query/sql", { stmt: "select 1" });
        expect(seen).toEqual([["/api/query/sql", { stmt: "select 1" }]]);
        __resetFetchSyncPost();
    });
});
