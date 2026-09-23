import { afterEach, describe, expect, it } from "vitest";
import { __resetFetchSyncPost, __setFetchSyncPost } from "@/test/siyuan-stub";
import { exportDocsMarkdown, MAX_CONTENT_CHARS } from "./content";

/** 按文档 id 返回导出内容的 handler；返回 null 表示该文档导出失败 */
function serveExports(contentById: Record<string, string | null>, delays: Record<string, number> = {}) {
    __setFetchSyncPost(async (_url, data) => {
        const id = (data as { id: string }).id;
        const delay = delays[id] ?? 0;
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
        const content = contentById[id];
        if (content === null || content === undefined) {
            return { code: -1, msg: "导出失败", data: null };
        }
        return { code: 0, msg: "", data: { content } };
    });
}

afterEach(() => {
    __resetFetchSyncPost();
});

describe("exportDocsMarkdown", () => {
    it("拼接多个文档的内容", async () => {
        serveExports({ a: "内容 A", b: "内容 B" });
        const result = await exportDocsMarkdown(["a", "b"]);
        expect(result.content).toContain("内容 A");
        expect(result.content).toContain("内容 B");
        expect(result.exported).toBe(2);
    });

    it("并发导出后仍按传入顺序拼接", async () => {
        // 让先到的文档反而更慢，验证结果按 index 而非完成顺序排列
        serveExports({ a: "第一", b: "第二", c: "第三" }, { a: 30, b: 10, c: 1 });
        const result = await exportDocsMarkdown(["a", "b", "c"]);
        expect(result.content.indexOf("第一")).toBeLessThan(result.content.indexOf("第二"));
        expect(result.content.indexOf("第二")).toBeLessThan(result.content.indexOf("第三"));
    });

    it("单个文档导出失败不影响其余文档", async () => {
        serveExports({ a: "内容 A", b: null, c: "内容 C" });
        const result = await exportDocsMarkdown(["a", "b", "c"]);
        expect(result.content).toContain("内容 A");
        expect(result.content).toContain("内容 C");
        expect(result.failed).toBe(1);
        expect(result.exported).toBe(2);
    });

    it("跳过空白内容的文档", async () => {
        serveExports({ a: "内容 A", b: "   \n  " });
        const result = await exportDocsMarkdown(["a", "b"]);
        expect(result.exported).toBe(1);
        expect(result.failed).toBe(0);
    });

    it("空文档列表返回空结果", async () => {
        const result = await exportDocsMarkdown([]);
        expect(result).toMatchObject({ content: "", exported: 0, skipped: 0, failed: 0, truncated: false });
    });

    it("超出字符预算的文档被整体跳过而不是被切断", async () => {
        // 预算 100：甲(30) + 分隔线 + 乙(60) = 97 刚好放下，丙(30) 会被整体跳过
        serveExports({ a: "甲".repeat(30), b: "x".repeat(60), c: "丙".repeat(30) });
        const result = await exportDocsMarkdown(["a", "b", "c"], 100);
        expect(result.content).toContain("甲");
        expect(result.content).toContain("x".repeat(60));
        expect(result.content).not.toContain("丙");
        expect(result.exported).toBe(2);
        expect(result.skipped).toBe(1);
        expect(result.truncated).toBe(false);
    });

    it("首篇文档即超出预算时截断保底，避免完全无法生成", async () => {
        serveExports({ a: "y".repeat(500) });
        const result = await exportDocsMarkdown(["a"], 100);
        expect(result.content).toHaveLength(100);
        expect(result.truncated).toBe(true);
        expect(result.exported).toBe(1);
    });

    it("文档之间用分隔线连接", async () => {
        serveExports({ a: "A", b: "B" });
        const result = await exportDocsMarkdown(["a", "b"]);
        expect(result.content).toContain("---");
    });

    it("默认预算为 200k 字符", () => {
        expect(MAX_CONTENT_CHARS).toBe(200_000);
    });
});
