import { describe, expect, it } from "vitest";
import type { ScoreIndexEntry } from "@/types/quiz";
import {
    buildCsvExport,
    buildExport,
    buildJsonExport,
    buildMarkdownExport,
    csvCell,
    markdownCell,
    summarizeByType,
} from "./export";

const entry = (over: Partial<ScoreIndexEntry> = {}): ScoreIndexEntry => ({
    id: "s-1",
    quizId: "quiz-1",
    title: "笔记标题",
    timestamp: new Date(2026, 8, 23, 14, 5, 0).getTime(),
    totalScore: 80,
    maxScore: 100,
    questionCount: 2,
    passedCount: 1,
    unanswered: 0,
    duration: 90,
    sourceDocId: "doc-1",
    sourceTitle: "来源",
    byType: {
        single_choice: { count: 1, passed: 1, score: 60, maxScore: 60 },
        subjective: { count: 1, passed: 0, score: 20, maxScore: 40 },
    },
    byDifficulty: {},
    hasAnalysis: false,
    ...over,
});

describe("csvCell", () => {
    it("普通值原样输出", () => {
        expect(csvCell("abc")).toBe("abc");
        expect(csvCell(12)).toBe("12");
    });

    it("含逗号时加引号", () => {
        expect(csvCell("a,b")).toBe('"a,b"');
    });

    it("含双引号时转义为两个双引号", () => {
        expect(csvCell('他说的"话"')).toBe('"他说的""话"""');
    });

    it("含换行时加引号", () => {
        expect(csvCell("a\nb")).toBe('"a\nb"');
    });

    it("null/undefined 输出空串", () => {
        expect(csvCell(null)).toBe("");
        expect(csvCell(undefined)).toBe("");
    });
});

describe("markdownCell", () => {
    it("转义竖线以免破坏表格", () => {
        expect(markdownCell("a|b")).toBe("a\\|b");
    });

    it("换行替换为空格", () => {
        expect(markdownCell("a\nb")).toBe("a b");
        expect(markdownCell("a\r\nb")).toBe("a b");
    });
});

describe("summarizeByType", () => {
    it("按固定题型顺序输出得分比", () => {
        expect(summarizeByType(entry())).toBe("single_choice:60/60 subjective:20/40");
    });

    it("没有分组数据时输出空串", () => {
        expect(summarizeByType(entry({ byType: {} }))).toBe("");
    });
});

describe("buildJsonExport", () => {
    it("包含导出时间、条数与完整记录", () => {
        const parsed = JSON.parse(buildJsonExport([entry(), entry({ id: "s-2" })]));
        expect(parsed.count).toBe(2);
        expect(parsed.records).toHaveLength(2);
        expect(parsed.records[0].id).toBe("s-1");
        expect(typeof parsed.exportedAt).toBe("string");
    });

    it("空列表导出为空 records", () => {
        expect(JSON.parse(buildJsonExport([])).records).toEqual([]);
    });
});

describe("buildCsvExport", () => {
    it("首行为表头，行数与记录数一致", () => {
        const lines = buildCsvExport([entry(), entry({ id: "s-2" })]).split("\n");
        expect(lines).toHaveLength(3);
        expect(lines[0]).toContain("id,timestamp,datetime,title");
    });

    it("输出可读的本地时间与百分比", () => {
        const csv = buildCsvExport([entry()]);
        expect(csv).toContain("2026-09-23 14:05");
        expect(csv).toContain("80.0");
    });

    it("标题含逗号时被正确转义（列数不被打乱）", () => {
        const csv = buildCsvExport([entry({ title: "a,b" })]);
        expect(csv).toContain('"a,b"');
        // 表头 13 列，数据行也应为 13 列
        const [header, row] = csv.split("\n");
        expect(header.split(",")).toHaveLength(13);
        expect(row.match(/[^,]*("[^"]*")?/g)?.filter((s) => s.length > 0).length).toBeGreaterThanOrEqual(13);
    });

    it("缺失的可选字段输出空值而不是 undefined", () => {
        const csv = buildCsvExport([entry({ duration: undefined, sourceTitle: undefined })]);
        expect(csv).not.toContain("undefined");
    });
});

describe("buildMarkdownExport", () => {
    it("包含标题、表头与数据行", () => {
        const md = buildMarkdownExport([entry()], "我的成绩");
        expect(md).toContain("# 我的成绩");
        expect(md).toContain("| 时间 | 标题 |");
        expect(md).toContain("| --- |");
        expect(md).toContain("2026-09-23 14:05");
    });

    it("标题中的竖线被转义", () => {
        expect(buildMarkdownExport([entry({ title: "a|b" })])).toContain("a\\|b");
    });

    it("空列表仍输出表头", () => {
        const md = buildMarkdownExport([]);
        expect(md).toContain("| 时间 |");
    });
});

describe("buildExport", () => {
    it("按格式分派", () => {
        expect(buildExport([entry()], "json")).toContain('"records"');
        expect(buildExport([entry()], "csv")).toContain("id,timestamp");
        expect(buildExport([entry()], "markdown")).toContain("# RecallGen");
    });

    it("markdown 格式可使用自定义标题", () => {
        expect(buildExport([entry()], "markdown", "标题")).toContain("# 标题");
    });
});
