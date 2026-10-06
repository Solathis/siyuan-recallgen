import { afterEach, describe, expect, it } from "vitest";
import { __resetFetchSyncPost, __setFetchSyncPost } from "@/test/siyuan-stub";
import type { DateGenConfig } from "@/lib/quiz/service";
import { MAX_CONTENT_CHARS, MAX_DOCS_PER_NOTEBOOK } from "./content";
import { dateClause, dayBoundary, fmtTS, loadDateRangeNotes } from "./dateRange";

const cfg = (days: number, baseHour = 4, baseMinute = 0): DateGenConfig => ({ days, baseHour, baseMinute });

/** 构造本地时间，避免受运行环境时区影响 */
const at = (y: number, mo: number, d: number, h: number, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s);

describe("fmtTS", () => {
    it("格式化为 SiYuan created 使用的 YYYYMMDDHHmmss", () => {
        expect(fmtTS(at(2026, 9, 23, 4, 5, 6))).toBe("20260923040506");
    });

    it("各字段补零到两位", () => {
        expect(fmtTS(at(2026, 1, 2, 3, 4, 5))).toBe("20260102030405");
    });
});

describe("dayBoundary", () => {
    it("基点已过时，今日从当天基点开始", () => {
        const { start, end } = dayBoundary(cfg(7), at(2026, 9, 23, 10, 0));
        expect(fmtTS(start)).toBe("20260923040000");
        expect(fmtTS(end)).toBe("20260924040000");
    });

    it("基点未到时，今日从昨天基点开始（深夜写笔记场景）", () => {
        const { start, end } = dayBoundary(cfg(7), at(2026, 9, 23, 2, 0));
        expect(fmtTS(start)).toBe("20260922040000");
        expect(fmtTS(end)).toBe("20260923040000");
    });

    it("基点恰为 00:00 时，凌晨仍归属前一天", () => {
        const { start } = dayBoundary(cfg(7, 0, 0), at(2026, 9, 23, 0, 0));
        // start === now，不满足 start > now，因此取当天 00:00
        expect(fmtTS(start)).toBe("20260923000000");
    });

    it("跨月边界正确回退一天", () => {
        const { start, end } = dayBoundary(cfg(7), at(2026, 9, 1, 1, 0));
        expect(fmtTS(start)).toBe("20260831040000");
        expect(fmtTS(end)).toBe("20260901040000");
    });
});

describe("dateClause", () => {
    it("today 查询区间为基点至今", () => {
        expect(dateClause(cfg(7), "today", at(2026, 9, 23, 10, 30))).toBe(
            "created >= '20260923040000' AND created <= '20260923103000'"
        );
    });

    it("beforeToday 且 days<=0 时查询基点之前的全部笔记", () => {
        expect(dateClause(cfg(0), "beforeToday", at(2026, 9, 23, 10, 0))).toBe("created < '20260923040000'");
        expect(dateClause(cfg(-1), "beforeToday", at(2026, 9, 23, 10, 0))).toBe("created < '20260923040000'");
    });

    it("beforeToday 且 days>0 时区间为 N 天前基点到基点", () => {
        expect(dateClause(cfg(7), "beforeToday", at(2026, 9, 23, 10, 0))).toBe(
            "created >= '20260916040000' AND created < '20260923040000'"
        );
    });

    it("beforeToday 的区间上界是排他的，避免与 today 重叠", () => {
        const now = at(2026, 9, 23, 10, 0);
        const today = dateClause(cfg(0), "today", now);
        const before = dateClause(cfg(7), "beforeToday", now);
        expect(before.endsWith("AND created < '20260923040000'")).toBe(true);
        expect(today).toContain("created >= '20260923040000'");
    });
});

describe("loadDateRangeNotes - 未纳入情况的回报", () => {
    const notebook = { id: "nb-1", name: "笔记本", closed: false };

    /** 按 URL 分派的 handler：lsNotebooks / sql / exportMdContent */
    function serve(docCount: number, options: { content?: (id: string) => string | null | undefined } = {}) {
        __setFetchSyncPost((url, data) => {
            if (url.includes("lsNotebooks")) {
                return { code: 0, msg: "", data: { notebooks: [notebook] } };
            }
            if (url.includes("query/sql")) {
                const rows = Array.from({ length: docCount }, (_, i) => ({ id: `doc-${i}` }));
                return { code: 0, msg: "", data: rows };
            }
            if (url.includes("exportMdContent")) {
                const id = (data as { id: string }).id;
                const content = options.content ? options.content(id) : `内容 ${id}`;
                if (content === null || content === undefined) return { code: -1, msg: "失败", data: null };
                return { code: 0, msg: "", data: { content } };
            }
            return { code: 0, msg: "", data: null };
        });
    }

    afterEach(() => {
        __resetFetchSyncPost();
    });

    it("命中单笔记本上限时报告 capped", async () => {
        serve(MAX_DOCS_PER_NOTEBOOK);
        const loaded = await loadDateRangeNotes(cfg(7), "beforeToday");
        expect(loaded.capped).toBe(true);
    });

    it("未命中上限时不报告 capped", async () => {
        serve(3);
        const loaded = await loadDateRangeNotes(cfg(7), "beforeToday");
        expect(loaded.capped).toBe(false);
    });

    it("标题里的篇数是实际纳入数，而不是命中数", async () => {
        // 命中 3 篇，其中 1 篇导出失败
        serve(3, { content: (id) => (id === "doc-1" ? null : `内容 ${id}`) });
        const loaded = await loadDateRangeNotes(cfg(7), "beforeToday");
        expect(loaded.failed).toBe(1);
        expect(loaded.title).toContain("2");
    });

    it("超出字符预算的文档计入 skipped", async () => {
        const huge = "x".repeat(MAX_CONTENT_CHARS + 10);
        // 首篇超预算会被截断保底，后续超预算的计入 skipped
        serve(3, { content: () => huge });
        const loaded = await loadDateRangeNotes(cfg(7), "beforeToday");
        expect(loaded.skipped).toBe(2);
    });

    it("范围内没有笔记时抛出带范围的提示", async () => {
        serve(0);
        await expect(loadDateRangeNotes(cfg(7), "beforeToday")).rejects.toThrow(/最近 7 天|没有/);
    });
});
