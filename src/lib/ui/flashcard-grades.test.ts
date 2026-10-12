import { describe, expect, it } from "vitest";
import type { BankItem } from "../quiz/bank";
import { gradesToResults } from "./flashcard-grades";

function bankItem(id: string, questionId: string): BankItem {
    return {
        id,
        question: { id: questionId, type: "single_choice", difficulty: "medium" } as BankItem["question"],
        sourceDocId: "doc-1",
        sourceTitle: "第三章",
        createdAt: 0,
        updatedAt: 0,
    } as unknown as BankItem;
}

describe("gradesToResults", () => {
    it("自评得分按题目 id 对应到结果,而不是按卡片指纹", () => {
        const items = [bankItem("fp-aaa", "q-1"), bankItem("fp-bbb", "q-2")];
        const grades = [
            { id: "fp-aaa", percent: 100 },
            { id: "fp-bbb", percent: 0 },
        ];
        const results = gradesToResults(items, grades);
        expect(results).toEqual([
            expect.objectContaining({ questionId: "q-1", score: 100, correct: true }),
            expect.objectContaining({ questionId: "q-2", score: 0, correct: false }),
        ]);
    });

    it("未评分的卡片不产生结果", () => {
        const items = [bankItem("fp-aaa", "q-1"), bankItem("fp-bbb", "q-2")];
        const results = gradesToResults(items, [{ id: "fp-bbb", percent: 60 }]);
        expect(results.map((r) => r.questionId)).toEqual(["q-2"]);
    });
});
