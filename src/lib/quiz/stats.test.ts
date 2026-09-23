import { describe, expect, it } from "vitest";
import type { GradingResult, Question, ScoreRecord } from "@/types/quiz";
import { PASS_SCORE, aggregateResults, buildIndexEntry, monthKey, scorePercent } from "./stats";

const question = (id: string, type: Question["type"], difficulty: Question["difficulty"], tags?: string[]): Question =>
    ({ id, type, difficulty, question: "题干", tags }) as Question;

const result = (questionId: string, type: Question["type"], score: number, userValue?: unknown): GradingResult =>
    ({
        questionId,
        type,
        method: type === "subjective" ? "ai" : "local",
        correct: type === "subjective" ? null : score >= PASS_SCORE,
        score,
        maxScore: 100,
        userAnswer: userValue === undefined ? undefined : ({ type, value: userValue } as never),
    }) as GradingResult;

describe("aggregateResults", () => {
    const questions = [
        question("q-1", "single_choice", "easy"),
        question("q-2", "single_choice", "hard"),
        question("q-3", "subjective", "easy"),
    ];

    it("按题型聚合题数、通过与分数", () => {
        const { byType } = aggregateResults(
            [result("q-1", "single_choice", 100), result("q-2", "single_choice", 0), result("q-3", "subjective", 80)],
            questions
        );
        expect(byType.single_choice).toEqual({ count: 2, passed: 1, score: 100, maxScore: 200 });
        expect(byType.subjective).toEqual({ count: 1, passed: 1, score: 80, maxScore: 100 });
    });

    it("按难度聚合（仅统计有题目信息的题）", () => {
        const { byDifficulty } = aggregateResults(
            [result("q-1", "single_choice", 100), result("q-2", "single_choice", 0), result("q-3", "subjective", 80)],
            questions
        );
        expect(byDifficulty.easy).toEqual({ count: 2, passed: 2, score: 180, maxScore: 200 });
        expect(byDifficulty.hard).toEqual({ count: 1, passed: 0, score: 0, maxScore: 100 });
    });

    it("passed 的判定门槛与界面一致（≥60）", () => {
        expect(PASS_SCORE).toBe(60);
        const { byType } = aggregateResults([result("q-1", "single_choice", 60)], questions);
        expect(byType.single_choice?.passed).toBe(1);
        const { byType: low } = aggregateResults([result("q-1", "single_choice", 59)], questions);
        expect(low.single_choice?.passed).toBe(0);
    });

    it("没有题目信息时仍能按判分结果自带的 type 统计题型", () => {
        const { byType, byDifficulty } = aggregateResults([result("q-x", "fill_blank", 100)], undefined);
        expect(byType.fill_blank).toEqual({ count: 1, passed: 1, score: 100, maxScore: 100 });
        expect(byDifficulty).toEqual({});
    });

    it("空结果返回空聚合", () => {
        expect(aggregateResults([], questions)).toEqual({ byType: {}, byDifficulty: {}, byTag: {} });
    });
});

describe("buildIndexEntry", () => {
    const questions = [
        question("q-1", "single_choice", "easy"),
        question("q-2", "fill_blank", "medium"),
        question("q-3", "subjective", "easy"),
    ];
    const record: ScoreRecord = {
        id: "s-1",
        quizId: "quiz-1",
        title: "笔记标题",
        timestamp: 1_700_000_000_000,
        totalScore: 120,
        maxScore: 300,
        questionCount: 3,
        detail: [
            result("q-1", "single_choice", 100, 1),
            result("q-2", "fill_blank", 20, ["答案"]),
            result("q-3", "subjective", 0, ""),
        ],
        questions,
        analysis: "薄弱点分析",
        duration: 420,
        sourceDocId: "doc-1",
        sourceTitle: "来源标题",
    };

    it("带上识别与展示字段", () => {
        const entry = buildIndexEntry(record);
        expect(entry).toMatchObject({
            id: "s-1",
            quizId: "quiz-1",
            title: "笔记标题",
            timestamp: 1_700_000_000_000,
            totalScore: 120,
            maxScore: 300,
            questionCount: 3,
            duration: 420,
            sourceDocId: "doc-1",
            sourceTitle: "来源标题",
        });
    });

    it("passedCount 为得分达标的题数", () => {
        expect(buildIndexEntry(record).passedCount).toBe(1);
    });

    it("空字符串答案计为未作答", () => {
        expect(buildIndexEntry(record).unanswered).toBe(1);
    });

    it("数组型答案非空时计为已作答", () => {
        const entry = buildIndexEntry({ ...record, detail: [result("q-2", "fill_blank", 100, ["a"])] });
        expect(entry.unanswered).toBe(0);
    });

    it("缺失 userAnswer 计为未作答", () => {
        const entry = buildIndexEntry({ ...record, detail: [result("q-1", "single_choice", 0)] });
        expect(entry.unanswered).toBe(1);
    });

    it("hasAnalysis 反映是否已有分析文本", () => {
        expect(buildIndexEntry(record).hasAnalysis).toBe(true);
        expect(buildIndexEntry({ ...record, analysis: "" }).hasAnalysis).toBe(false);
        expect(buildIndexEntry({ ...record, analysis: undefined }).hasAnalysis).toBe(false);
    });

    it("包含按题型与难度的聚合", () => {
        const entry = buildIndexEntry(record);
        expect(entry.byType.single_choice?.count).toBe(1);
        expect(entry.byType.fill_blank?.count).toBe(1);
        expect(entry.byDifficulty.easy?.count).toBe(2);
    });

    it("不含题目与判分明细（只保留聚合值）", () => {
        const entry = buildIndexEntry(record) as unknown as Record<string, unknown>;
        expect(entry.detail).toBeUndefined();
        expect(entry.questions).toBeUndefined();
        expect(entry.analysis).toBeUndefined();
        expect(JSON.stringify(entry).length).toBeLessThan(JSON.stringify(record).length);
    });
});

describe("scorePercent", () => {
    it("按总分与满分计算百分比", () => {
        expect(scorePercent({ totalScore: 80, maxScore: 100 })).toBe(80);
    });

    it("maxScore 为 0 时返回 0 而不是 NaN", () => {
        expect(scorePercent({ totalScore: 0, maxScore: 0 })).toBe(0);
    });
});

describe("monthKey", () => {
    it("按本地时间生成 YYYY-MM", () => {
        expect(monthKey(new Date(2026, 8, 23).getTime())).toBe("2026-09");
        expect(monthKey(new Date(2026, 0, 5).getTime())).toBe("2026-01");
    });

    it("月份补零", () => {
        expect(monthKey(new Date(2026, 11, 31).getTime())).toBe("2026-12");
    });

    it("同月不同日得到相同分片键", () => {
        const a = monthKey(new Date(2026, 5, 1).getTime());
        const b = monthKey(new Date(2026, 5, 30).getTime());
        expect(a).toBe(b);
    });
});

describe("aggregateResults - 知识点标签", () => {
    it("同一道题的多个标签各自累加", () => {
        const { byTag } = aggregateResults(
            [result("q-1", "single_choice", 100)],
            [question("q-1", "single_choice", "easy", ["二叉树", "递归"])]
        );
        expect(byTag["二叉树"]).toEqual({ count: 1, passed: 1, score: 100, maxScore: 100 });
        expect(byTag["递归"]).toEqual({ count: 1, passed: 1, score: 100, maxScore: 100 });
    });

    it("跨题目累加同一标签", () => {
        const { byTag } = aggregateResults(
            [result("q-1", "single_choice", 100), result("q-2", "single_choice", 0)],
            [question("q-1", "single_choice", "easy", ["二叉树"]), question("q-2", "single_choice", "hard", ["二叉树"])]
        );
        expect(byTag["二叉树"]).toEqual({ count: 2, passed: 1, score: 100, maxScore: 200 });
    });

    it("没有标签的题目不出现在 byTag 中", () => {
        const { byTag } = aggregateResults(
            [result("q-1", "single_choice", 80)],
            [question("q-1", "single_choice", "easy")]
        );
        expect(byTag).toEqual({});
    });

    it("标签去重由生成阶段负责，聚合只按题目上的标签计数", () => {
        const { byTag } = aggregateResults(
            [result("q-1", "single_choice", 80)],
            [question("q-1", "single_choice", "easy", ["A"])]
        );
        expect(Object.keys(byTag)).toEqual(["A"]);
    });

    it("缺少题目信息时 byTag 为空（旧数据兼容）", () => {
        const { byTag } = aggregateResults([result("q-1", "single_choice", 80)], undefined);
        expect(byTag).toEqual({});
    });

    it("buildIndexEntry 输出 byTag", () => {
        const record: ScoreRecord = {
            id: "s-1",
            quizId: "quiz-1",
            title: "标题",
            timestamp: 1_700_000_000_000,
            totalScore: 100,
            maxScore: 100,
            questionCount: 1,
            detail: [result("q-1", "subjective", 100)],
            questions: [question("q-1", "subjective", "easy", ["知识点 X"])],
        };
        expect(buildIndexEntry(record).byTag["知识点 X"]).toMatchObject({ count: 1, passed: 1 });
    });

    it("题目缺 tags 字段时 byTag 为空", () => {
        const record: ScoreRecord = {
            id: "s-1",
            quizId: "quiz-1",
            title: "标题",
            timestamp: 1,
            totalScore: 0,
            maxScore: 100,
            questionCount: 1,
            detail: [result("q-1", "subjective", 0)],
            questions: [question("q-1", "subjective", "easy")],
        };
        expect(buildIndexEntry(record).byTag).toEqual({});
    });
});
