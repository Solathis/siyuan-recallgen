import { describe, expect, it } from "vitest";
import type { Question, UserAnswer } from "@/types/quiz";
import { editorTarget } from "./QuestionView.svelte";

const coding = (starter?: string): Question =>
    ({
        id: "q-1",
        type: "coding",
        difficulty: "easy",
        question: "写一个函数",
        language: "javascript",
        starter_code: starter,
        test_cases: [{ args: [], expected: 1 }],
    }) as unknown as Question;

describe("editorTarget", () => {
    it("未作答时回落到初始代码", () => {
        expect(editorTarget(undefined, coding("function f() {}"))).toBe("function f() {}");
    });

    it("题目没有初始代码时未作答为空串", () => {
        expect(editorTarget(undefined, coding(undefined))).toBe("");
    });

    it("作答被清空后保持为空，不再回填初始代码（回归：|| 会把空串当成未作答）", () => {
        const answer: UserAnswer = { type: "coding", value: "" };
        expect(editorTarget(answer, coding("function f() {}"))).toBe("");
    });

    it("有作答时精确回填作答内容", () => {
        const answer: UserAnswer = { type: "coding", value: "const x = 1" };
        expect(editorTarget(answer, coding("function f() {}"))).toBe("const x = 1");
    });

    it("非编程题返回空串", () => {
        const choice = { id: "q-2", type: "true_false", difficulty: "easy", question: "1=1", answer: true } as Question;
        expect(editorTarget(undefined, choice)).toBe("");
        expect(editorTarget({ type: "single_choice", value: 0 }, choice)).toBe("");
    });
});
