import { describe, expect, it } from "vitest";
import type { DifficultyDistribution, Question } from "@/types/quiz";
import { dedupeQuestions, MAX_QUESTIONS_PER_CALL, planBatches, renumberQuestions, scaleDistribution } from "./batching";

const dist = (total: number, easy: number, medium: number, hard: number): DifficultyDistribution => ({
    total,
    easy,
    medium,
    hard,
});

const question = (text: string): Question =>
    ({ id: "q-1", type: "true_false", difficulty: "easy", question: text, answer: true }) as Question;

describe("planBatches", () => {
    it("题量为 0 时返回空数组", () => {
        expect(planBatches(dist(0, 0, 0, 0))).toEqual([]);
    });

    it("不超过上限时只返回一批，且与原始分布一致", () => {
        const batches = planBatches(dist(10, 4, 4, 2));
        expect(batches).toHaveLength(1);
        expect(batches[0]).toEqual(dist(10, 4, 4, 2));
    });

    it("恰好等于上限时仍是一批", () => {
        expect(planBatches(dist(12, 5, 5, 2), 12)).toHaveLength(1);
    });

    it("超过上限时按上限拆分", () => {
        const batches = planBatches(dist(50, 20, 20, 10), 12);
        expect(batches.length).toBe(Math.ceil(50 / 12));
    });

    it("每批题量都不超过上限", () => {
        const batches = planBatches(dist(50, 20, 20, 10), 12);
        for (const batch of batches) {
            expect(batch.total).toBeLessThanOrEqual(12);
        }
    });

    it("合并后与原始难度分布完全一致", () => {
        const original = dist(50, 20, 20, 10);
        const merged = planBatches(original, 12).reduce(
            (acc, batch) => ({
                total: acc.total + batch.total,
                easy: acc.easy + batch.easy,
                medium: acc.medium + batch.medium,
                hard: acc.hard + batch.hard,
            }),
            dist(0, 0, 0, 0)
        );
        expect(merged).toEqual(original);
    });

    it("难度分布倾斜时也能正确拆分", () => {
        const original = dist(30, 28, 2, 0);
        const batches = planBatches(original, 10);
        const sumEasy = batches.reduce((s, b) => s + b.easy, 0);
        const sumMedium = batches.reduce((s, b) => s + b.medium, 0);
        expect(sumEasy).toBe(28);
        expect(sumMedium).toBe(2);
        expect(batches.every((b) => b.total <= 10)).toBe(true);
    });

    it("余数分给前几批，使各批难度比例接近", () => {
        // 5 题分 2 批：3 / 2
        const batches = planBatches(dist(5, 5, 0, 0), 3);
        expect(batches.map((b) => b.easy)).toEqual([3, 2]);
    });

    it("题量为 0 但各档有值时不产生空批次", () => {
        // 各档都为 0 的批次会被过滤掉
        const batches = planBatches(dist(2, 2, 0, 0), 2);
        expect(batches).toHaveLength(1);
        expect(batches[0].total).toBe(2);
    });

    it("上限为 0 或负数时按 1 处理，不会死循环", () => {
        const batches = planBatches(dist(3, 1, 1, 1), 0);
        expect(batches.length).toBe(3);
    });

    it("默认上限为 MAX_QUESTIONS_PER_CALL", () => {
        expect(planBatches(dist(MAX_QUESTIONS_PER_CALL * 2, 12, 8, 4)).length).toBe(2);
    });
});

describe("dedupeQuestions", () => {
    it("按题干指纹去重，保留首次出现", () => {
        const result = dedupeQuestions([question("题干 A"), question("题干 B"), question("题干 A")]);
        expect(result).toHaveLength(2);
        expect(result.map((q) => q.question)).toEqual(["题干 A", "题干 B"]);
    });

    it("标点与空白差异视为同一题", () => {
        expect(dedupeQuestions([question("1+1=?"), question("1 + 1 = ？")])).toHaveLength(1);
    });

    it("无重复时原样返回", () => {
        expect(dedupeQuestions([question("A"), question("B")])).toHaveLength(2);
    });

    it("空数组返回空数组", () => {
        expect(dedupeQuestions([])).toEqual([]);
    });
});

describe("renumberQuestions", () => {
    it("按 1..n 连续编号", () => {
        const result = renumberQuestions([question("A"), question("B"), question("C")]);
        expect(result.map((q) => q.id)).toEqual(["q-1", "q-2", "q-3"]);
    });

    it("覆盖已有的不连续编号", () => {
        const input = [
            { ...question("A"), id: "q-7" },
            { ...question("B"), id: "q-2" },
        ];
        expect(renumberQuestions(input).map((q) => q.id)).toEqual(["q-1", "q-2"]);
    });

    it("不修改入参", () => {
        const input = [{ ...question("A"), id: "q-9" }];
        renumberQuestions(input);
        expect(input[0].id).toBe("q-9");
    });

    it("空数组返回空数组", () => {
        expect(renumberQuestions([])).toEqual([]);
    });
});

describe("scaleDistribution", () => {
    it("各档之和精确等于新总数（最大余数法）", () => {
        for (const target of [1, 2, 3, 7, 11, 13, 17, 23, 29]) {
            const out = scaleDistribution(dist(15, 6, 6, 3), target);
            expect(out.total).toBe(target);
            expect(out.easy + out.medium + out.hard, `target=${target}`).toBe(target);
        }
    });

    it("保持原始难度比例（6:6:3 缩放后仍接近 2:2:1）", () => {
        const out = scaleDistribution(dist(15, 6, 6, 3), 10);
        expect(out.easy).toBe(4);
        expect(out.medium).toBe(4);
        expect(out.hard).toBe(2);
    });

    it("总数为 0 时各档都为 0", () => {
        expect(scaleDistribution(dist(15, 6, 6, 3), 0)).toEqual({ total: 0, easy: 0, medium: 0, hard: 0 });
        expect(scaleDistribution(dist(15, 6, 6, 3), -5)).toEqual({ total: 0, easy: 0, medium: 0, hard: 0 });
    });

    it("各档之和为 0 的异常配置按中级兜底（与 planBatches 一致）", () => {
        expect(scaleDistribution(dist(10, 0, 0, 0), 4)).toEqual({ total: 4, easy: 0, medium: 4, hard: 0 });
    });

    it("极端倾斜的分布也不会丢题", () => {
        const out = scaleDistribution(dist(30, 28, 2, 0), 3);
        expect(out.easy + out.medium + out.hard).toBe(3);
        expect(out.easy).toBeGreaterThan(0);
    });

    it("非整数输入会被规整", () => {
        const out = scaleDistribution(dist(15.4, 6.6, 5.5, 3.3), 7.2);
        expect(Number.isInteger(out.total)).toBe(true);
        expect(out.easy + out.medium + out.hard).toBe(out.total);
    });

    it("补题差额能直接交给 planBatches 拆批", () => {
        const scaled = scaleDistribution(dist(15, 6, 6, 3), 20);
        const batches = planBatches(scaled);
        expect(batches.reduce((sum, b) => sum + b.total, 0)).toBe(20);
    });
});
