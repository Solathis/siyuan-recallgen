// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Question, UserAnswer } from "@/types/quiz";
import QuestionView from "./QuestionView.svelte";

const subjectiveQuestion = {
    id: "q-sub",
    type: "subjective",
    difficulty: "medium",
    question: "解释进程与线程",
    reference_answer: "进程是资源分配单位",
} as unknown as Question;

const answer: UserAnswer = { type: "subjective", value: "进程拥有资源" };

function previewText(host: HTMLElement): string {
    const contents = [...host.querySelectorAll<HTMLDivElement>('[data-slot="tabs-content"]')];
    const preview = contents.find((c) => (c.getAttribute("data-value") ?? c.id).includes("preview"));
    return preview?.querySelector(".rg-markdown")?.textContent ?? "";
}

const MOUNT_TIMEOUT = 60_000;

describe("主观题预览防抖", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("预览不随每次输入重算:挂载后先为空,防抖窗口过后才渲染", { timeout: MOUNT_TIMEOUT }, () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const app = mount(QuestionView, {
            target: host,
            props: { question: subjectiveQuestion, answer, onchange: () => {} },
        });
        flushSync();

        // 防抖窗口内:预览还没有渲染出内容
        expect(previewText(host)).toBe("");

        vi.advanceTimersByTime(500);
        flushSync();
        // 防抖结束后:预览跟上作答内容
        expect(previewText(host)).toContain("进程");

        unmount(app);
        host.remove();
    });

    it("切到预览标签时立即同步最新内容,不等防抖", { timeout: MOUNT_TIMEOUT }, () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const app = mount(QuestionView, {
            target: host,
            props: { question: subjectiveQuestion, answer, onchange: () => {} },
        });
        flushSync();

        // 切到「预览」标签
        const previewTab = [...host.querySelectorAll<HTMLButtonElement>('[data-slot="tabs-trigger"]')].find(
            (b) => (b.textContent || "").trim() === "预览"
        );
        previewTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        flushSync();

        // 不推进定时器:预览应立即显示当前内容
        expect(previewText(host)).toContain("进程");

        unmount(app);
        host.remove();
    });
});
