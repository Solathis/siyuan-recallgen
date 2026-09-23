import { describe, expect, it } from "vitest";
import { AIError } from "@/lib/ai/client";
import type { Question } from "@/types/quiz";
import {
    blankMatches,
    clampScore,
    gradeObjective,
    isObjective,
    PASS_SCORE,
    scoreFillBlank,
    scoreMultipleChoice,
    scoreObjective,
    setEqual,
} from "./grader";

const single = (answer: number): Question =>
    ({
        id: "q-1",
        type: "single_choice",
        difficulty: "easy",
        question: "?",
        options: ["A", "B", "C"],
        answer,
    }) as Question;

const multi = (answer: number[]): Question =>
    ({
        id: "q-1",
        type: "multiple_choice",
        difficulty: "easy",
        question: "?",
        options: ["A", "B", "C"],
        answer,
    }) as Question;

const tf = (answer: boolean): Question =>
    ({ id: "q-1", type: "true_false", difficulty: "easy", question: "?", answer }) as Question;

const blank = (answer: string[][]): Question =>
    ({ id: "q-1", type: "fill_blank", difficulty: "easy", question: "?", answer }) as Question;

describe("isObjective", () => {
    it("单选/多选/填空/判断为客观题", () => {
        expect(isObjective("single_choice")).toBe(true);
        expect(isObjective("multiple_choice")).toBe(true);
        expect(isObjective("fill_blank")).toBe(true);
        expect(isObjective("true_false")).toBe(true);
    });

    it("主观题与编程题不是客观题", () => {
        expect(isObjective("subjective")).toBe(false);
        expect(isObjective("coding")).toBe(false);
    });
});

describe("setEqual", () => {
    it("与顺序无关", () => {
        expect(setEqual([2, 0, 1], [0, 1, 2])).toBe(true);
    });

    it("长度不同即不相等", () => {
        expect(setEqual([1], [1, 2])).toBe(false);
    });

    it("元素不同即不相等", () => {
        expect(setEqual([0, 1], [0, 2])).toBe(false);
    });

    it("重复元素按多重集比较", () => {
        expect(setEqual([1, 1], [1, 2])).toBe(false);
    });

    it("不修改入参数组", () => {
        const a = [2, 0];
        const b = [0, 2];
        setEqual(a, b);
        expect(a).toEqual([2, 0]);
        expect(b).toEqual([0, 2]);
    });
});

describe("blankMatches / scoreFillBlank", () => {
    it("忽略首尾空格与大小写", () => {
        expect(blankMatches(["Paris"], "  paris ")).toBe(true);
    });

    it("任一可接受答案命中即算对", () => {
        expect(blankMatches(["巴黎", "Paris"], "Paris")).toBe(true);
    });

    it("空串不算答对", () => {
        expect(blankMatches(["a"], "")).toBe(false);
        expect(blankMatches(["a"], undefined)).toBe(false);
    });

    it("全部答对得满分", () => {
        expect(scoreFillBlank([["a"], ["b"]], ["a", "B"])).toBe(100);
    });

    it("按答对的空数给部分分", () => {
        expect(scoreFillBlank([["a"], ["b"], ["c"], ["d"]], ["a", "b", "", ""])).toBe(50);
        expect(scoreFillBlank([["a"], ["b"], ["c"]], ["a", "x", "x"])).toBe(33);
    });

    it("一个空都没答对得 0 分", () => {
        expect(scoreFillBlank([["a"], ["b"]], ["x", "y"])).toBe(0);
    });

    it("没有可接受答案时返回 0，不产生 NaN", () => {
        expect(scoreFillBlank([], ["a"])).toBe(0);
    });
});

describe("scoreMultipleChoice", () => {
    it("全对得满分", () => {
        expect(scoreMultipleChoice([0, 2], [0, 2])).toBe(100);
        expect(scoreMultipleChoice([0, 2], [2, 0])).toBe(100);
    });

    it("漏选按命中比例给分", () => {
        // 正确 4 项中选对 3 项：3/4 = 75
        expect(scoreMultipleChoice([0, 1, 2, 3], [0, 1, 2])).toBe(75);
    });

    it("错选扣分，避免全选骗分", () => {
        // 正确 2 项，选了 2 对 + 2 错：(2-2)/2 = 0
        expect(scoreMultipleChoice([0, 1], [0, 1, 2, 3])).toBe(0);
    });

    it("错选多于命中时下限为 0，不出现负分", () => {
        expect(scoreMultipleChoice([0], [1, 2, 3])).toBe(0);
    });

    it("一个都没选得 0 分", () => {
        expect(scoreMultipleChoice([0, 1], [])).toBe(0);
    });

    it("正确项为空时返回 0", () => {
        expect(scoreMultipleChoice([], [0])).toBe(0);
    });

    it("结果始终落在 0-100", () => {
        const cases: [number[], number[]][] = [
            [[0, 1, 2], []],
            [[0], [0, 1]],
            [
                [0, 1, 2, 3, 4],
                [4, 3, 2],
            ],
            [
                [1, 2],
                [1, 2, 3, 4, 5, 6],
            ],
        ];
        for (const [correct, selected] of cases) {
            const score = scoreMultipleChoice(correct, selected);
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(100);
        }
    });
});

describe("scoreObjective", () => {
    it("单选题索引一致才得分", () => {
        expect(scoreObjective(single(1), { type: "single_choice", value: 1 })).toBe(100);
        expect(scoreObjective(single(1), { type: "single_choice", value: 0 })).toBe(0);
    });

    it("多选题允许部分得分", () => {
        expect(scoreObjective(multi([0, 1, 2, 3]), { type: "multiple_choice", value: [0, 1, 2] })).toBe(75);
    });

    it("判断题布尔值一致才得分", () => {
        expect(scoreObjective(tf(false), { type: "true_false", value: false })).toBe(100);
        expect(scoreObjective(tf(false), { type: "true_false", value: true })).toBe(0);
    });

    it("填空题按空计分并忽略大小写与空格", () => {
        expect(scoreObjective(blank([["Paris"], ["France"]]), { type: "fill_blank", value: ["paris", "x"] })).toBe(50);
    });

    it("题型不匹配时得 0 分而不是崩溃", () => {
        expect(scoreObjective(single(0), { type: "true_false", value: true })).toBe(0);
        expect(scoreObjective(multi([0]), { type: "single_choice", value: 0 })).toBe(0);
    });

    it("主观题/编程题不走客观题判分", () => {
        const q = {
            id: "q-1",
            type: "subjective",
            difficulty: "easy",
            question: "?",
            reference_answer: "x",
        } as Question;
        expect(scoreObjective(q, { type: "subjective", value: "x" })).toBe(0);
    });
});

describe("gradeObjective", () => {
    it("未作答得 0 分且不计为正确", () => {
        const r = gradeObjective(single(1), undefined);
        expect(r).toMatchObject({ method: "local", correct: false, score: 0, maxScore: 100, userAnswer: undefined });
    });

    it("答对得满分", () => {
        expect(gradeObjective(multi([0, 1]), { type: "multiple_choice", value: [1, 0] })).toMatchObject({
            correct: true,
            score: 100,
        });
    });

    it("答错得 0 分", () => {
        expect(gradeObjective(tf(true), { type: "true_false", value: false })).toMatchObject({
            correct: false,
            score: 0,
        });
    });

    it("部分得分时 correct 为 false，但分数不为 0", () => {
        const result = gradeObjective(multi([0, 1, 2, 3]), { type: "multiple_choice", value: [0, 1, 2] });
        expect(result.correct).toBe(false);
        expect(result.score).toBe(75);
    });

    it("完全正确时 correct 为 true", () => {
        expect(gradeObjective(multi([0, 1]), { type: "multiple_choice", value: [1, 0] }).correct).toBe(true);
    });
});

describe("clampScore", () => {
    it("在 0-100 区间内原样返回", () => {
        expect(clampScore(85)).toBe(85);
    });

    it("数字字符串会被转换", () => {
        expect(clampScore("70")).toBe(70);
    });

    it("越界值被夹紧", () => {
        expect(clampScore(120)).toBe(100);
        expect(clampScore(-5)).toBe(0);
    });

    it("undefined 视为缺失并抛错", () => {
        expect(() => clampScore(undefined)).toThrow(/缺少有效的 score/);
    });

    it("非数字字符串抛错", () => {
        expect(() => clampScore("abc")).toThrow(/缺少有效的 score/);
    });

    it("null 视为缺失并抛错（回归：Number(null) 曾得到 0 被静默判为 0 分）", () => {
        expect(() => clampScore(null)).toThrow(/缺少有效的 score/);
    });

    it("空字符串与 NaN 视为缺失并抛错", () => {
        expect(() => clampScore("")).toThrow(/缺少有效的 score/);
        expect(() => clampScore(Number.NaN)).toThrow(/缺少有效的 score/);
    });

    it("抛出的错误归类为 parse，便于上层区分", () => {
        try {
            clampScore(undefined);
            throw new Error("应当抛错");
        } catch (e) {
            expect(e).toBeInstanceOf(AIError);
            expect((e as AIError).kind).toBe("parse");
        }
    });
});

describe("PASS_SCORE", () => {
    it("通过线为 60，与统计口径一致", () => {
        expect(PASS_SCORE).toBe(60);
    });
});
