// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import type { GradingResult, Question, SingleChoiceQuestion } from "@/types/quiz";
import type { QuizService } from "../quiz/service";
import ResultPanel from "./ResultPanel.svelte";

const MOUNT_TIMEOUT = 60_000;

function single(id: string, answer: number, options: string[] = ["甲", "乙", "丙", "丁"]): SingleChoiceQuestion {
    return {
        id,
        type: "single_choice",
        difficulty: "easy",
        tags: [],
        question: `${id} 的题干`,
        options,
        answer,
        explanation: "因为如此",
    };
}

function graded(q: Question, over: Partial<GradingResult> = {}): GradingResult {
    return {
        questionId: q.id,
        type: q.type,
        method: "local",
        correct: null,
        score: 100,
        maxScore: 100,
        ...over,
    };
}

/**
 * 一卷五题，刻意覆盖四种状态：
 * 1 完全正确、2 完全正确、3 部分得分（75）、4 答错（0 分但有作答）、5 未答。
 */
const questions: Question[] = [single("q1", 0), single("q2", 1), single("q3", 2), single("q4", 3), single("q5", 0)];
const results: GradingResult[] = [
    graded(questions[0], { userAnswer: { type: "single_choice", value: 0 }, score: 100 }),
    graded(questions[1], { userAnswer: { type: "single_choice", value: 1 }, score: 100 }),
    graded(questions[2], { userAnswer: { type: "single_choice", value: 0 }, score: 75 }),
    graded(questions[3], { userAnswer: { type: "single_choice", value: 1 }, score: 0 }),
    graded(questions[4], { score: 0 }),
];

function fakeService(): QuizService {
    return {
        openDoc: () => {},
        chatGlobal: async () => "好的",
    } as unknown as QuizService;
}

let cleanup: (() => void) | null = null;

afterEach(() => {
    cleanup?.();
    cleanup = null;
});

async function mountPanel() {
    return mountWith(results, questions);
}

async function mountWith(given: GradingResult[], givenQuestions: Question[]) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(ResultPanel, {
        target: host,
        props: { service: fakeService(), results: given, questions: givenQuestions, duration: 300 },
    });
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
    cleanup = () => {
        unmount(app);
        host.remove();
    };
    return host;
}

/** 筛选片文字，如「全部(5)」 */
function chips(host: HTMLElement): string[] {
    return [...host.querySelectorAll('[role="radio"]')].map((b) => (b.textContent ?? "").replace(/\s+/g, ""));
}

describe("成绩与分析面板", () => {
    it("筛选片的题数相加等于总题数，且互不重叠", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = await mountPanel();
        const labels = chips(host);
        expect(labels[0], "第一片应当是全部").toContain("全部(5)");

        const numbers = labels.slice(1).map((label) => Number(label.match(/\((\d+)\)/)?.[1] ?? -1));
        expect(
            numbers.every((n) => n >= 0),
            `筛选片缺少计数：${labels.join(" ")}`
        ).toBe(true);
        // 原 bug：「正确」按达标（>=60 分）计数，而筛选本身用的是「完全正确」，
        // 于是一道 75 分的题同时落进「正确」与「部分得分」，四片之和比总题数还多
        expect(numbers.reduce((a, b) => a + b, 0)).toBe(5);
        expect(labels.join(" ")).toContain("正确(2)");
        expect(labels.join(" ")).toContain("部分得分(1)");
        expect(labels.join(" ")).toContain("错误(1)");
        expect(labels.join(" ")).toContain("未答(1)");
    });

    it("打了字又清空的答案算「未答」，与判分器和统计页同口径", { timeout: MOUNT_TIMEOUT }, async () => {
        // 主观题清空后仍会留下一个 { type: "subjective", value: "" } 条目。
        // 判分器（grader.ts 用 hasAnswer）与统计页的「未答」都把它当未作答，
        // 结果页若按「有值就算作答」会把它算成「错误」——同一道题三种说法。
        const cleared = [
            graded(questions[0], { userAnswer: { type: "subjective", value: "" }, score: 0 }),
            graded(questions[1], { userAnswer: { type: "fill_blank", value: [] }, score: 0 }),
        ] as GradingResult[];
        const filler: Question[] = [
            { ...questions[0], type: "subjective", reference_answer: "要点" } as Question,
            { ...questions[1], type: "fill_blank", answer: [["a"]] } as Question,
        ];
        const host = await mountWith(cleared, filler);

        const labels = chips(host).join(" ");
        expect(labels, "两道都该算未答").toContain("未答(2)");
        expect(labels, "不该算错误").toContain("错误(0)");
        expect((host.textContent ?? "").replace(/\s+/g, " "), "答案区应显示未答").toContain("你的答案： 未答");
    });

    it("顶部指标是达标率而不是正确率", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = await mountPanel();
        // 得分 100 / 100 / 75 / 0 / 未答：三题达到 PASS_SCORE（60）
        expect(host.textContent).toContain("达标率");
        expect(host.textContent).not.toContain("正确率");
        expect(host.textContent).toContain("60%");
        expect(host.textContent).toContain("3/5 题");
    });

    it("选项里同时标出正确答案与用户选错的那一项", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = await mountPanel();
        // 第 4 题：正确答案是 D，用户选了 B
        const strip = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "4");
        expect(strip, "没找到题号条上的第 4 题").toBeTruthy();
        (strip as HTMLElement).click();
        flushSync();

        const marks = [...host.querySelectorAll('[role="img"]')].map((el) => el.getAttribute("aria-label"));
        // 正确项标「正确」，用户选错的那项标「错误」——原先只标正确答案，
        // 回看时看不出自己当初选了哪个
        expect(marks).toContain("正确");
        expect(marks).toContain("错误");
    });

    it("只要还有未达标的题就给出「重做错题」入口", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = await mountPanel();
        // 第 3 题拿 75 分（部分得分、未达标）——按「0 分的错题」判断时这个入口会消失
        expect(host.textContent).toContain("重做错题");
    });

    it("按状态筛选后只显示该状态的题", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = await mountPanel();
        const wrongChip = [...host.querySelectorAll('[role="radio"]')].find((b) =>
            (b.textContent ?? "").includes("错误")
        );
        expect(wrongChip).toBeTruthy();
        (wrongChip as HTMLElement).click();
        flushSync();

        const strip = [...host.querySelectorAll("button")].filter((b) => /^\d+$/.test((b.textContent ?? "").trim()));
        expect(strip.map((b) => b.textContent?.trim())).toEqual(["4"]);
    });
});
