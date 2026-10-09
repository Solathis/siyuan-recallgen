import { describe, expect, it } from "vitest";
import type { Question, UserAnswer } from "@/types/quiz";
import { editorTarget } from "./QuestionView.svelte";
import { parseTimeInput, retryAction, swipeDirection } from "./QuizPanel.svelte";

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

describe("retryAction", () => {
    it("复习到期题目失败后重试仍走复习流程（回归：曾改为重新出题）", () => {
        expect(retryAction("reviewDue")).toBe("reviewDue");
    });

    it("按日期范围进入时重试回到日期范围流程", () => {
        expect(retryAction("dateGenerate")).toBe("dateGenerate");
    });

    it("恢复进度失败时重试仍去恢复", () => {
        expect(retryAction("resume")).toBe("resume");
    });

    it("普通出题与未知模式回落到出题流程", () => {
        expect(retryAction("generate")).toBe("generate");
        expect(retryAction(undefined)).toBe("generate");
        expect(retryAction("review")).toBe("generate");
    });
});

describe("parseTimeInput", () => {
    it("解析正常时间", () => {
        expect(parseTimeInput("04:30")).toEqual({ hour: 4, minute: 30 });
        expect(parseTimeInput("00:00")).toEqual({ hour: 0, minute: 0 });
        expect(parseTimeInput("23:59")).toEqual({ hour: 23, minute: 59 });
    });

    it("清空输入得到 0 而不是 NaN（回归：NaN ?? 0 仍是 NaN）", () => {
        const parsed = parseTimeInput("");
        expect(Number.isNaN(parsed.hour)).toBe(false);
        expect(Number.isNaN(parsed.minute)).toBe(false);
        expect(parsed).toEqual({ hour: 0, minute: 0 });
    });

    it("缺省值与畸形输入都回落到 0", () => {
        expect(parseTimeInput(undefined)).toEqual({ hour: 0, minute: 0 });
        expect(parseTimeInput(null)).toEqual({ hour: 0, minute: 0 });
        expect(parseTimeInput("abc")).toEqual({ hour: 0, minute: 0 });
        expect(parseTimeInput(":")).toEqual({ hour: 0, minute: 0 });
    });

    it("越界的时分被收敛为 0（不会生成非法日期）", () => {
        expect(parseTimeInput("99:99")).toEqual({ hour: 0, minute: 0 });
        expect(parseTimeInput("24:00")).toEqual({ hour: 0, minute: 0 });
    });
});

describe("swipeDirection（窄容器左右滑切题）", () => {
    const at = (x: number, y = 0) => ({ x, y });

    it("向左滑是下一题、向右滑是上一题", () => {
        expect(swipeDirection(at(300, 400), at(180, 400))).toBe(1);
        expect(swipeDirection(at(180, 400), at(300, 400))).toBe(-1);
    });

    it("位移不够时不动", () => {
        expect(swipeDirection(at(300, 400), at(280, 400))).toBe(0);
    });

    it("斜着滑（纵向占主导）不动：竖向滚动不能被误判成翻页", () => {
        // 横向 80px、纵向 200px：这是滚动，不是切题
        expect(swipeDirection(at(300, 200), at(220, 400))).toBe(0);
    });

    it("横向位移明显压过纵向时才切题", () => {
        // 横向 150、纵向 60 → 切题
        expect(swipeDirection(at(300, 200), at(150, 260))).toBe(1);
        // 横向 150、纵向 120 → 不切题（差得不够明显）
        expect(swipeDirection(at(300, 200), at(150, 320))).toBe(0);
    });

    it("阈值可调：大幅度拖动在任何阈值下都切题", () => {
        expect(swipeDirection(at(400, 0), at(100, 0), 250)).toBe(1);
    });
});
