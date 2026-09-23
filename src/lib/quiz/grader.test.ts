import { describe, expect, it } from "vitest";
import { AIError } from "@/lib/ai/client";
import type { Question } from "@/types/quiz";
import { checkFillBlank, checkObjective, clampScore, gradeObjective, isObjective, setEqual } from "./grader";

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

describe("checkFillBlank", () => {
    it("忽略首尾空格与大小写", () => {
        expect(checkFillBlank([["Paris"]], ["  paris "])).toBe(true);
    });

    it("任一可接受答案命中即算对", () => {
        expect(checkFillBlank([["巴黎", "Paris"]], ["Paris"])).toBe(true);
    });

    it("空数不同即判错", () => {
        expect(checkFillBlank([["a"], ["b"]], ["a"])).toBe(false);
    });

    it("多空需全部命中", () => {
        expect(checkFillBlank([["a"], ["b"]], ["a", "x"])).toBe(false);
        expect(checkFillBlank([["a"], ["b"]], ["a", "B"])).toBe(true);
    });

    it("用户答案缺失时按空串比较而非崩溃", () => {
        expect(checkFillBlank([["a"]], [])).toBe(false);
    });
});

describe("checkObjective", () => {
    it("单选题索引一致才算对", () => {
        expect(checkObjective(single(1), { type: "single_choice", value: 1 })).toBe(true);
        expect(checkObjective(single(1), { type: "single_choice", value: 0 })).toBe(false);
    });

    it("多选题与顺序无关", () => {
        expect(checkObjective(multi([0, 2]), { type: "multiple_choice", value: [2, 0] })).toBe(true);
        expect(checkObjective(multi([0, 2]), { type: "multiple_choice", value: [0] })).toBe(false);
    });

    it("判断题布尔值一致才算对", () => {
        expect(checkObjective(tf(false), { type: "true_false", value: false })).toBe(true);
        expect(checkObjective(tf(false), { type: "true_false", value: true })).toBe(false);
    });

    it("填空题忽略大小写与空格", () => {
        expect(checkObjective(blank([["Paris"]]), { type: "fill_blank", value: ["paris"] })).toBe(true);
    });

    it("题型不匹配时判错而不是崩溃", () => {
        expect(checkObjective(single(0), { type: "true_false", value: true })).toBe(false);
        expect(checkObjective(multi([0]), { type: "single_choice", value: 0 })).toBe(false);
    });

    it("主观题/编程题不走客观题判分", () => {
        const q = {
            id: "q-1",
            type: "subjective",
            difficulty: "easy",
            question: "?",
            reference_answer: "x",
        } as Question;
        expect(checkObjective(q, { type: "subjective", value: "x" })).toBe(false);
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
