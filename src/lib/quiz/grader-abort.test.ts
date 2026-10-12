import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIError } from "../ai/client";
import { getDefaultConfig } from "@/types/config";
import type { Question, UserAnswer } from "@/types/quiz";

const callLLM = vi.hoisted(() => vi.fn());

vi.mock("../ai/client", async (importOriginal) => {
    const real = await importOriginal<typeof import("../ai/client")>();
    return { ...real, callLLM };
});

import { gradeAll } from "./grader";

const subjective = {
    id: "q-sub",
    type: "subjective",
    difficulty: "medium",
    question: "解释进程与线程",
    explanation: "",
    reference_answer: "进程是资源分配单位",
} as unknown as Question;

const answers: Record<string, UserAnswer> = {
    "q-sub": { type: "subjective", value: "进程拥有资源,线程是调度单位" },
};

describe("gradeAll 取消语义", () => {
    beforeEach(() => {
        callLLM.mockReset();
    });

    it("AI 判分被取消时抛出中止错误,不把它记成 0 分的正式结果", async () => {
        callLLM.mockRejectedValue(new AIError("已取消", undefined, "aborted"));
        const ctrl = new AbortController();
        const config = getDefaultConfig();
        await expect(gradeAll(config, [subjective], answers, undefined, undefined, ctrl.signal)).rejects.toMatchObject({
            kind: "aborted",
        });
    });

    it("非取消类的 AI 失败仍然记为 0 分并附原因,不影响其余题目", async () => {
        callLLM.mockRejectedValue(new AIError("上游 500", 500, "http"));
        const config = getDefaultConfig();
        const results = await gradeAll(config, [subjective], answers);
        expect(results).toEqual([
            expect.objectContaining({ questionId: "q-sub", method: "ai", score: 0, correct: null }),
        ]);
    });
});
