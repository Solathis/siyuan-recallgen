import { describe, expect, it } from "vitest";
import type { GradingResult, Question, ScoreIndexEntry } from "@/types/quiz";
import {
    BACKUP_VERSION,
    buildCsvExport,
    buildExport,
    buildJsonExport,
    buildMarkdownExport,
    buildScoreBackup,
    parseScoreBackup,
    planBackupImport,
    csvCell,
    markdownCell,
    summarizeByType,
} from "./export";

const question = (id: string): Question =>
    ({ id, type: "true_false", difficulty: "easy", question: "题干", answer: true }) as Question;

const result = (questionId: string, type: Question["type"], score: number): GradingResult =>
    ({ questionId, type, method: "local", correct: score >= 60, score, maxScore: 100 }) as GradingResult;

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
    byTag: {},
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

describe("buildScoreBackup / parseScoreBackup", () => {
    it("备份带格式标识与版本号", () => {
        const file = parseScoreBackup(buildScoreBackup([entry()], {}));
        expect(file.app).toBe("recallgen");
        expect(file.kind).toBe("scores");
        expect(file.version).toBe(BACKUP_VERSION);
    });

    it("备份保留明细，因此可再次导入", () => {
        const detail = {
            id: "s-1",
            detail: [result("q-1", "true_false", 100)],
            analysis: "分析",
            questions: [question("q-1")],
        };
        const file = parseScoreBackup(buildScoreBackup([entry()], { "s-1": detail }));
        expect(file.details["s-1"].analysis).toBe("分析");
        expect(file.details["s-1"].questions).toHaveLength(1);
    });

    it("拒绝非 JSON、非本插件文件与过高版本", () => {
        expect(() => parseScoreBackup("{不是 json")).toThrow(/合法 JSON/);
        expect(() => parseScoreBackup('{"app":"other"}')).toThrow(/不是 RecallGen/);
        expect(() => parseScoreBackup(`{"app":"recallgen","kind":"scores","version":${BACKUP_VERSION + 1}}`)).toThrow(
            /高于当前支持/
        );
    });

    it("缺少 entries 时拒绝", () => {
        expect(() => parseScoreBackup('{"app":"recallgen","kind":"scores"}')).toThrow(/缺少 entries/);
    });

    it("缺少必要字段的条目被丢弃", () => {
        const text = JSON.stringify({
            app: "recallgen",
            kind: "scores",
            version: 1,
            entries: [{ id: "ok", timestamp: 123 }, { id: "" }, { timestamp: 1 }, { id: "no-ts" }],
        });
        expect(parseScoreBackup(text).entries.map((e) => e.id)).toEqual(["ok"]);
    });
});

describe("planBackupImport", () => {
    it("全部为新记录时都进入导入计划", () => {
        const backup = parseScoreBackup(buildScoreBackup([entry({ id: "s-1" }), entry({ id: "s-2" })], {}));
        const plan = planBackupImport(backup, []);
        expect(plan.items).toHaveLength(2);
        expect(plan.skipped).toBe(0);
    });

    it("已存在的记录被跳过且不覆盖本机数据", () => {
        const backup = parseScoreBackup(buildScoreBackup([entry({ id: "s-1" }), entry({ id: "s-2" })], {}));
        const plan = planBackupImport(backup, ["s-1"]);
        expect(plan.items.map((i) => i.entry.id)).toEqual(["s-2"]);
        expect(plan.skipped).toBe(1);
        expect(plan.warnings.some((w) => w.includes("已存在"))).toBe(true);
    });

    it("备份内部重复的 id 只取首次", () => {
        const backup = parseScoreBackup(buildScoreBackup([entry({ id: "s-1" }), entry({ id: "s-1" })], {}));
        const plan = planBackupImport(backup, []);
        expect(plan.items).toHaveLength(1);
        expect(plan.skipped).toBe(1);
    });

    it("有明细时以明细重新派生索引，保证聚合一致", () => {
        const stale = entry({ id: "s-1", byType: {}, passedCount: 0, unanswered: 99 });
        const backup = parseScoreBackup(
            buildScoreBackup([stale], {
                // 明细里带作答，重建后的「未作答」应为 0，而不是备份里那个错误的 99
                "s-1": {
                    id: "s-1",
                    detail: [{ ...result("q-1", "true_false", 100), userAnswer: { type: "true_false", value: true } }],
                    questions: [question("q-1")],
                },
            })
        );
        const plan = planBackupImport(backup, []);
        const rebuilt = plan.items[0].entry;
        expect(rebuilt.byType.true_false?.count).toBe(1);
        expect(rebuilt.passedCount).toBe(1);
        expect(rebuilt.unanswered).toBe(0);
    });

    it("没有明细的记录也会导入，但提示无法回看", () => {
        const backup = parseScoreBackup(buildScoreBackup([entry({ id: "s-1" })], {}));
        const plan = planBackupImport(backup, []);
        expect(plan.items).toHaveLength(1);
        expect(plan.items[0].detail).toBeNull();
        expect(plan.warnings.some((w) => w.includes("没有明细"))).toBe(true);
    });

    it("明细结构不合法时按「无明细」处理", () => {
        const text = JSON.stringify({
            app: "recallgen",
            kind: "scores",
            version: 1,
            entries: [entry({ id: "s-1" })],
            details: { "s-1": { id: "s-1", detail: "不是数组" } },
        });
        const plan = planBackupImport(parseScoreBackup(text), []);
        expect(plan.items[0].detail).toBeNull();
    });
});
