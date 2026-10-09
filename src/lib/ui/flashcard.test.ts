// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { State } from "ts-fsrs";
import type { BankItem } from "../quiz/bank";
import FlashcardPanel from "./FlashcardPanel.svelte";

const DAY = 86_400_000;
const NOW = Date.now();

function item(id: string, question: Partial<BankItem["question"]>): BankItem {
    return {
        id,
        question: { id: `q-${id}`, difficulty: "medium", explanation: "解析", ...question } as BankItem["question"],
        sourceDocId: "doc-1",
        sourceTitle: "第三章",
        createdAt: NOW - 5 * DAY,
        updatedAt: NOW - DAY,
        card: {
            due: NOW,
            stability: 10,
            difficulty: 5,
            elapsed_days: 2,
            scheduled_days: 4,
            learning_steps: 0,
            reps: 3,
            lapses: 1,
            state: State.Review,
        },
        timesSeen: 3,
        timesPassed: 2,
    };
}

const items: BankItem[] = [
    item("b1", {
        type: "single_choice",
        difficulty: "medium",
        question: "时间片过小的主要代价？",
        options: ["切换开销上升", "饥饿"],
        answer: 0,
    } as Partial<BankItem["question"]>),
    item("b2", {
        type: "fill_blank",
        difficulty: "hard",
        question: "就绪态、运行态和______态。",
        answer: [["阻塞"]],
    } as Partial<BankItem["question"]>),
];

const MOUNT_TIMEOUT = 60_000;
let cleanup: (() => void) | null = null;

afterEach(() => {
    cleanup?.();
    cleanup = null;
});

function mountPanel(list: BankItem[], onDone?: (grades: Array<{ id: string; percent: number }>) => void) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(FlashcardPanel, { target: host, props: { items: list, onDone } });
    flushSync();
    cleanup = () => {
        unmount(app);
        host.remove();
    };
    return host;
}

const buttonWith = (host: HTMLElement, text: string) =>
    [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

describe("闪卡面板", () => {
    it("进度文案与卡片标题同口径（都是第几张 / 共几张）", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountPanel(items);
        const text = (host.textContent ?? "").replace(/\s+/g, " ");
        // 进度条与卡片标题都应为「1 / 2」；原先进度条传 0 基下标，显示成 0 / 2
        expect(text).toContain("1 / 2");
        expect(text, "不该出现 0 基下标").not.toContain("0 / 2");
    });

    it("卡片标题显示本地化的题型与难度", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountPanel(items);
        const text = host.textContent ?? "";
        expect(text).toContain("单选");
        expect(text).toContain("中级");
        // 不该把枚举值直接显示出来
        expect(text).not.toContain("medium");
        expect(text).not.toContain("single_choice");
    });

    /** 在 window 上派发一次按键（面板的监听挂在那里，模拟真实焦点不在面板内） */
    const press = (key: string, target: EventTarget = window) => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        flushSync();
    };

    it("空格揭示答案、数字键自评", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountPanel(items);
        // 自评按钮只在揭示后出现，用它判断是否已揭示
        expect(buttonWith(host, "显示答案"), "未揭示时应有揭示按钮").toBeTruthy();
        expect(buttonWith(host, "忘了"), "未揭示时不该有自评按钮").toBeUndefined();

        press(" ");
        expect(buttonWith(host, "显示答案"), "揭示后揭示按钮应消失").toBeUndefined();
        expect(buttonWith(host, "忘了"), "揭示后应有自评按钮").toBeTruthy();

        // 1 → 忘了（与按钮顺序一致）
        press("1");
        const text = (host.textContent ?? "").replace(/\s+/g, " ");
        expect(text).toContain("2 / 2");
        expect(text).toContain("忘了 1");
    });

    it("未揭示答案时数字键不生效（避免盲评）", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountPanel(items);
        press("1");
        expect((host.textContent ?? "").replace(/\s+/g, " ")).toContain("1 / 2");
        expect(buttonWith(host, "显示答案"), "仍应停在未揭示状态").toBeTruthy();
    });

    it("焦点在输入控件里时不劫持按键", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountPanel(items);
        const input = document.createElement("input");
        host.appendChild(input);
        press(" ", input);
        expect(buttonWith(host, "显示答案"), "输入框里的空格不该揭示答案").toBeTruthy();
    });

    it("空列表给出说明而不是整块空白", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountPanel([]);
        expect(host.textContent).toContain("没有可复习的题目");
        // 下标要收口，不能出现 1 / 0
        expect(host.textContent).not.toContain("1 / 0");
    });

    it("自评后进入下一张，进度推进", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountPanel(items);
        buttonWith(host, "显示答案")!.click();
        flushSync();
        buttonWith(host, "记住了")!.click();
        flushSync();

        const text = (host.textContent ?? "").replace(/\s+/g, " ");
        expect(text).toContain("2 / 2");
        // 已自评的计数显示在卡片下方
        expect(text).toContain("记住 1");
    });

    it("最后一张自评后回调全部得分率", { timeout: MOUNT_TIMEOUT }, () => {
        const onDone = vi.fn();
        const host = mountPanel(items, onDone);
        // 第一张：忘了（0 分）
        buttonWith(host, "显示答案")!.click();
        flushSync();
        buttonWith(host, "忘了")!.click();
        flushSync();
        // 第二张：轻松（100 分）
        buttonWith(host, "显示答案")!.click();
        flushSync();
        buttonWith(host, "轻松")!.click();
        flushSync();

        expect(onDone).toHaveBeenCalledTimes(1);
        expect(onDone.mock.calls[0][0]).toEqual([
            { id: "b1", percent: 0 },
            { id: "b2", percent: 100 },
        ]);
        expect(host.textContent).toContain("复习完成");
    });

    it("提前结束只提交已自评的卡片", { timeout: MOUNT_TIMEOUT }, () => {
        const onDone = vi.fn();
        const host = mountPanel(items, onDone);
        buttonWith(host, "显示答案")!.click();
        flushSync();
        buttonWith(host, "模糊")!.click();
        flushSync();

        // 第二张还没自评，此时可以提前结束
        const finish = buttonWith(host, "结束复习");
        expect(finish, "第一张之后应出现结束复习").toBeTruthy();
        finish!.click();
        flushSync();

        expect(onDone).toHaveBeenCalledTimes(1);
        expect(onDone.mock.calls[0][0]).toEqual([{ id: "b1", percent: 50 }]);
    });

    it("尚未自评任何卡片时不能提前结束（避免提交空结果）", { timeout: MOUNT_TIMEOUT }, () => {
        const onDone = vi.fn();
        const host = mountPanel(items, onDone);
        // 第一张、未揭晓：没有结束复习按钮
        expect(buttonWith(host, "结束复习")).toBeUndefined();
        expect(onDone).not.toHaveBeenCalled();
    });
});
