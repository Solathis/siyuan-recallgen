import { describe, expect, it } from "vitest";
import { AIError } from "@/lib/ai/client";
import type { Question, QuestionType } from "@/types/quiz";
import { coerceQuestion, validateQuestions } from "./generator";

const ALL: QuestionType[] = ["single_choice", "multiple_choice", "fill_blank", "true_false", "subjective", "coding"];

const reason = (input: unknown, types: QuestionType[] = ALL) => {
    const r = coerceQuestion(input, "q-1", types);
    return r.ok ? "" : r.reason;
};

describe("coerceQuestion - 题干与题型", () => {
    it("接受完整的单选题", () => {
        const r = coerceQuestion(
            { type: "single_choice", difficulty: "easy", question: "1+1=?", options: ["1", "2"], answer: 1 },
            "q-1",
            ALL
        );
        expect(r.ok).toBe(true);
        expect(r.question).toMatchObject({ type: "single_choice", answer: 1, id: "q-1" });
    });

    it("拒绝未启用的题型", () => {
        const r = coerceQuestion({ type: "coding", question: "写代码" }, "q-1", ["single_choice"]);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/未启用/);
    });

    it("拒绝空题干", () => {
        expect(reason({ type: "true_false", question: "   ", answer: true })).toMatch(/题干为空/);
        expect(reason({ type: "true_false", answer: true })).toMatch(/题干为空/);
    });

    it("拒绝非对象输入", () => {
        expect(reason(null)).toMatch(/不是对象/);
        expect(reason("文本")).toMatch(/不是对象/);
        expect(reason([])).toMatch(/不是对象/);
    });

    it("难度缺失或非法时回落为 medium", () => {
        const r = coerceQuestion({ type: "true_false", question: "x", answer: true, difficulty: "很难" }, "q-1", ALL);
        expect(r.question?.difficulty).toBe("medium");
    });

    it("难度大小写不敏感", () => {
        const r = coerceQuestion({ type: "true_false", question: "x", answer: true, difficulty: "HARD" }, "q-1", ALL);
        expect(r.question?.difficulty).toBe("hard");
    });
});

describe("coerceQuestion - 单选题索引边界", () => {
    it("字母答案被转换为索引", () => {
        const r = coerceQuestion(
            { type: "single_choice", question: "x", options: ["a", "b", "c"], answer: "B" },
            "q-1",
            ALL
        );
        expect(r.question).toMatchObject({ answer: 1 });
    });

    it("拒绝越界索引（曾导致用户永远答不对）", () => {
        expect(reason({ type: "single_choice", question: "x", options: ["a", "b"], answer: 5 })).toMatch(/索引不合法/);
    });

    it("拒绝负数索引", () => {
        expect(reason({ type: "single_choice", question: "x", options: ["a", "b"], answer: -1 })).toMatch(/索引不合法/);
    });

    it("拒绝选项不足两个", () => {
        expect(reason({ type: "single_choice", question: "x", options: ["a"], answer: 0 })).toMatch(/索引不合法/);
    });

    it("拒绝答案缺失", () => {
        expect(reason({ type: "single_choice", question: "x", options: ["a", "b"] })).toMatch(/索引不合法/);
    });
});

describe("coerceQuestion - 多选题索引边界", () => {
    it("去重并排序答案索引", () => {
        const r = coerceQuestion(
            { type: "multiple_choice", question: "x", options: ["a", "b", "c"], answer: [2, 0, 2] },
            "q-1",
            ALL
        );
        expect(r.question).toMatchObject({ answer: [0, 2] });
    });

    it("拒绝任一越界索引", () => {
        expect(reason({ type: "multiple_choice", question: "x", options: ["a", "b"], answer: [0, 7] })).toMatch(
            /索引不合法/
        );
    });

    it("拒绝负数索引", () => {
        expect(reason({ type: "multiple_choice", question: "x", options: ["a", "b"], answer: [-1] })).toMatch(
            /索引不合法/
        );
    });

    it("拒绝空答案", () => {
        expect(reason({ type: "multiple_choice", question: "x", options: ["a", "b"], answer: [] })).toMatch(
            /索引不合法/
        );
    });

    it("接受字母数组答案", () => {
        const r = coerceQuestion(
            { type: "multiple_choice", question: "x", options: ["a", "b", "c"], answer: ["A", "C"] },
            "q-1",
            ALL
        );
        expect(r.question).toMatchObject({ answer: [0, 2] });
    });
});

describe("coerceQuestion - 填空题", () => {
    it("接受二维答案数组", () => {
        const r = coerceQuestion({ type: "fill_blank", question: "x", answer: [["巴黎", "Paris"]] }, "q-1", ALL);
        expect(r.question).toMatchObject({ answer: [["巴黎", "Paris"]] });
    });

    it("把一维答案包成二维", () => {
        const r = coerceQuestion({ type: "fill_blank", question: "x", answer: ["甲", "乙"] }, "q-1", ALL);
        expect(r.question).toMatchObject({ answer: [["甲"], ["乙"]] });
    });

    it("拒绝空答案", () => {
        expect(reason({ type: "fill_blank", question: "x", answer: [] })).toMatch(/答案缺失/);
        expect(reason({ type: "fill_blank", question: "x" })).toMatch(/答案缺失/);
    });

    it("拒绝某一空的可接受答案为空的题目", () => {
        expect(reason({ type: "fill_blank", question: "x", answer: [["a"], []] })).toMatch(/答案缺失/);
    });
});

describe("coerceQuestion - 判断题", () => {
    it("接受布尔答案", () => {
        expect(coerceQuestion({ type: "true_false", question: "x", answer: false }, "q-1", ALL).question).toMatchObject(
            { answer: false }
        );
    });

    it("接受中英文与数字字符串答案", () => {
        const cases: Array<[unknown, boolean]> = [
            ["true", true],
            ["正确", true],
            ["对", true],
            ["1", true],
            ["false", false],
            ["错误", false],
            ["错", false],
            ["0", false],
            [1, true],
            [0, false],
        ];
        for (const [input, expected] of cases) {
            const r = coerceQuestion({ type: "true_false", question: "x", answer: input }, "q-1", ALL);
            expect(r.ok, `answer=${JSON.stringify(input)}`).toBe(true);
            expect((r.question as { answer: boolean }).answer, `answer=${JSON.stringify(input)}`).toBe(expected);
        }
    });

    it("拒绝无法识别的答案", () => {
        expect(reason({ type: "true_false", question: "x", answer: "也许" })).toMatch(/不是布尔值/);
    });
});

describe("coerceQuestion - 主观题与编程题", () => {
    it("主观题需要参考答案", () => {
        expect(reason({ type: "subjective", question: "x" })).toMatch(/缺少参考答案/);
        expect(reason({ type: "subjective", question: "x", reference_answer: "  " })).toMatch(/缺少参考答案/);
    });

    it("编程题接受参考答案", () => {
        const r = coerceQuestion({ type: "coding", question: "x", language: "python", answer: "print(1)" }, "q-1", ALL);
        expect(r.question).toMatchObject({ language: "python", answer: "print(1)" });
    });

    it("编程题仅有测试用例时也接受", () => {
        const r = coerceQuestion(
            { type: "coding", question: "x", test_cases: [{ input: "1", expected: "2" }] },
            "q-1",
            ALL
        );
        expect(r.ok).toBe(true);
    });

    it("编程题既无参考答案也无测试用例时拒绝", () => {
        expect(reason({ type: "coding", question: "x", answer: "" })).toMatch(/缺少参考答案与测试用例/);
    });

    it("编程题语言缺省为 python", () => {
        const r = coerceQuestion({ type: "coding", question: "x", answer: "a" }, "q-1", ALL);
        expect(r.question).toMatchObject({ language: "python" });
    });
});

describe("validateQuestions - 容错而不是整批作废", () => {
    it("丢弃不合格题目并保留其余的", () => {
        const raw = [
            { type: "true_false", question: "好的", answer: true },
            { type: "single_choice", question: "坏的", options: ["a", "b"], answer: 9 },
            { type: "subjective", question: "好的2", reference_answer: "参考答案" },
        ];
        const questions = validateQuestions(raw, ALL);
        expect(questions).toHaveLength(2);
    });

    it("跳过项通过回调上报原因", () => {
        const reasons: string[] = [];
        validateQuestions(
            [
                { type: "true_false", question: "好的", answer: true },
                { type: "single_choice", question: "坏的", options: ["a", "b"], answer: 9 },
            ],
            ALL,
            (r) => reasons.push(r)
        );
        expect(reasons).toHaveLength(1);
        expect(reasons[0]).toMatch(/索引不合法/);
    });

    it("丢弃后重新按 q-1..q-n 连续编号", () => {
        const raw = [
            { type: "true_false", question: "a", answer: true },
            { type: "single_choice", question: "坏的", options: ["a", "b"], answer: 9 },
            { type: "true_false", question: "b", answer: false },
            { type: "true_false", question: "c", answer: true },
        ];
        const ids = validateQuestions(raw, ALL).map((q) => q.id);
        expect(ids).toEqual(["q-1", "q-2", "q-3"]);
    });

    it("全部不合格时抛错，并带上前几条原因", () => {
        const raw = [
            { type: "single_choice", question: "a", options: ["x"], answer: 0 },
            { type: "fill_blank", question: "b", answer: [] },
        ];
        expect(() => validateQuestions(raw, ALL)).toThrow(/全部校验失败/);
    });

    it("空数组同样抛错", () => {
        expect(() => validateQuestions([], ALL)).toThrow(/数组为空/);
    });

    it("抛出的错误归类为错误信息可供上层展示", () => {
        try {
            validateQuestions([{ type: "unknown_type", question: "a" }], ALL);
            throw new Error("应当抛错");
        } catch (e) {
            expect(e).toBeInstanceOf(AIError);
        }
    });

    it("接受全部 6 种题型的混合批次", () => {
        const raw = [
            { type: "single_choice", question: "a", options: ["1", "2"], answer: 0 },
            { type: "multiple_choice", question: "b", options: ["1", "2"], answer: [0, 1] },
            { type: "fill_blank", question: "c", answer: [["x"]] },
            { type: "true_false", question: "d", answer: true },
            { type: "subjective", question: "e", reference_answer: "要点" },
            { type: "coding", question: "f", answer: "print(1)" },
        ];
        const questions: Question[] = validateQuestions(raw, ALL);
        expect(questions.map((q) => q.type)).toEqual([
            "single_choice",
            "multiple_choice",
            "fill_blank",
            "true_false",
            "subjective",
            "coding",
        ]);
    });
});
