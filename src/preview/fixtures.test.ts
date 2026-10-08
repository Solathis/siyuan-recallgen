import { describe, expect, it } from "vitest";

import { questionFingerprint } from "@/lib/quiz/bank";
import { isCardDue } from "@/lib/quiz/bank";
import {
    previewBankItems,
    previewEmptySession,
    previewLatestRecord,
    previewQuestions,
    previewResults,
    previewScoreIndex,
    previewScoreRecords,
    previewSession,
} from "./fixtures";

/**
 * 种子数据的自检。
 *
 * 预览台是「样式改动的唯一评判依据」，而它出错的方式非常隐蔽：
 * 某一屏渲染成空白或停在加载态，看起来像界面坏了，实际只是数据缺一块。
 * 这里把「每屏都依赖的数据形状」钉住，数据被改坏时直接报红。
 */
describe("预览台种子数据", () => {
    it("六种题型各至少一道", () => {
        const types = new Set(previewQuestions.map((q) => q.type));
        expect([...types].sort()).toEqual([
            "coding",
            "fill_blank",
            "multiple_choice",
            "single_choice",
            "subjective",
            "true_false",
        ]);
    });

    it("有两道编程题，其中一道是可直接执行的 JavaScript", () => {
        const coding = previewQuestions.filter((q) => q.type === "coding");
        expect(coding.length).toBeGreaterThanOrEqual(2);
        const runnable = coding.filter((q) => q.language === "javascript");
        expect(runnable.length).toBeGreaterThanOrEqual(1);
        expect(runnable[0].type === "coding" && (runnable[0].test_cases?.length ?? 0)).toBeGreaterThan(0);
    });

    it("每题都有非空的题干与解析", () => {
        for (const question of previewQuestions) {
            expect(question.question.trim().length, `${question.id} 题干为空`).toBeGreaterThan(0);
            expect(question.explanation?.trim().length, `${question.id} 缺少解析`).toBeGreaterThan(0);
        }
    });

    it("进行中的会话同时包含已答、未答与标记", () => {
        const session = previewSession();
        const answered = session.questions.filter((q) => session.answers[q.id]);
        expect(answered.length).toBeGreaterThan(0);
        expect(answered.length).toBeLessThan(session.questions.length);
        expect(Object.values(session.flagged ?? {}).filter(Boolean).length).toBeGreaterThan(0);
    });

    it("空会话真的是空的（用于预览整屏空态）", () => {
        expect(previewEmptySession().questions).toHaveLength(0);
    });

    it("判分结果覆盖正确、部分得分、错误与未答四种状态", () => {
        const has = {
            correct: previewResults.some((r) => r.userAnswer && r.score >= 100),
            partial: previewResults.some((r) => r.userAnswer && r.score > 0 && r.score < 100),
            wrong: previewResults.some((r) => r.userAnswer && r.score === 0),
            unanswered: previewResults.some((r) => !r.userAnswer),
        };
        expect(has).toEqual({ correct: true, partial: true, wrong: true, unanswered: true });
    });

    it("成绩历史非空且都带作答值（否则结果页会把每道题都算成未答）", () => {
        expect(previewScoreRecords.length).toBeGreaterThan(20);
        for (const record of previewScoreRecords) {
            expect(record.detail.length).toBeGreaterThan(0);
            expect(
                record.detail.some((r) => r.userAnswer),
                `记录 ${record.id} 全无作答值`
            ).toBe(true);
        }
    });

    it("成绩索引与明细一一对应（结果页靠 id 反查索引）", () => {
        expect(previewScoreIndex.length).toBe(previewScoreRecords.length);
        for (const record of previewScoreRecords) {
            expect(
                previewScoreIndex.find((entry) => entry.id === record.id),
                `缺少 ${record.id} 的索引`
            ).toBeDefined();
        }
    });

    it("判分结果的 questionId 能在题列表里查到（否则难度与知识点统计全空）", () => {
        for (const record of previewScoreRecords) {
            const ids = new Set((record.questions ?? []).map((q) => q.id));
            for (const result of record.detail) {
                expect(ids.has(result.questionId), `${record.id} 的 ${result.questionId} 查不到题目`).toBe(true);
            }
        }
    });

    it("索引里有难度与知识点聚合（统计页的难度环、薄弱知识点靠它）", () => {
        const withDifficulty = previewScoreIndex.filter((entry) => Object.keys(entry.byDifficulty).length > 0);
        const withTags = previewScoreIndex.filter((entry) => Object.keys(entry.byTag).length > 0);
        expect(withDifficulty.length).toBeGreaterThan(0);
        expect(withTags.length).toBeGreaterThan(0);
    });

    it("结果页默认用的那条记录带薄弱点分析，且索引里能查到", () => {
        expect(previewLatestRecord.analysis?.trim().length ?? 0).toBeGreaterThan(0);
        expect(previewScoreIndex.some((entry) => entry.id === previewLatestRecord.id)).toBe(true);
    });

    it("题库含 12 条，四种到期状态都有样本", () => {
        const items = previewBankItems();
        expect(items.length).toBeGreaterThanOrEqual(12);
        const now = Date.now();
        const due = items.filter((item) => isCardDue(item.card, now)).length;
        expect(due).toBeGreaterThan(0);
        expect(due).toBeLessThan(items.length);
    });

    it("题库条目 id 是题干指纹且互不重复", () => {
        const items = previewBankItems();
        const ids = items.map((item) => item.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const item of items) {
            expect(item.id).toBe(questionFingerprint(item.question));
        }
    });

    it("题库条目带知识点标签（题库页的标签管理依赖它）", () => {
        const tagged = previewBankItems().filter((item) => (item.question.tags?.length ?? 0) > 0);
        expect(tagged.length).toBeGreaterThan(5);
    });
});
