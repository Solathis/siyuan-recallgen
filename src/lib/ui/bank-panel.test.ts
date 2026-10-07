// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { State } from "ts-fsrs";
import { getDefaultConfig } from "@/types/config";
import type { BankItem } from "../quiz/bank";
import type { QuizService } from "../quiz/service";
import BankPanel from "./BankPanel.svelte";

const DAY = 86_400_000;
const NOW = Date.now();

function card(dueOffsetDays: number, over: Partial<BankItem["card"]> = {}): BankItem["card"] {
    return {
        due: NOW + dueOffsetDays * DAY,
        stability: 12.5,
        difficulty: 5.2,
        elapsed_days: 3,
        scheduled_days: 6,
        learning_steps: 0,
        reps: 4,
        lapses: 1,
        state: State.Review,
        last_review: NOW - 2 * DAY,
        ...over,
    };
}

const items: BankItem[] = [
    {
        id: "b1",
        question: {
            id: "q1",
            type: "single_choice",
            difficulty: "medium",
            question: "时间片过小的主要代价是什么？",
            options: ["上下文切换开销上升", "长作业饥饿"],
            answer: 0,
            explanation: "切换次数变多。",
            tags: ["进程调度"],
        },
        sourceDocId: "doc-1",
        sourceTitle: "第三章",
        createdAt: NOW - 30 * DAY,
        updatedAt: NOW - 2 * DAY,
        card: card(-1),
        timesSeen: 5,
        timesPassed: 4,
        history: [
            { at: NOW - 7 * DAY, percent: 60 },
            { at: NOW - 2 * DAY, percent: 100 },
        ],
    },
    {
        id: "b2",
        question: {
            id: "q2",
            type: "fill_blank",
            difficulty: "easy",
            question: "进程的三种基本状态是就绪、运行和______。",
            answer: [["阻塞"]],
            explanation: "等待资源。",
            tags: ["进程状态"],
        },
        sourceDocId: "doc-2",
        sourceTitle: "第二章",
        createdAt: NOW - 12 * DAY,
        updatedAt: NOW - 12 * DAY,
        card: card(9),
        timesSeen: 2,
        timesPassed: 2,
    },
];

function fakeService(): QuizService {
    return {
        getConfig: () => getDefaultConfig(),
        subscribeConfig: () => () => {},
        listBank: async () => items,
        bankSummary: async () => ({ total: items.length, due: 1 }),
    } as unknown as QuizService;
}

/** 挂载并等 load() 落地 */
async function mountPanel() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(BankPanel, { target: host, props: { service: fakeService(), lang: "zh" } });
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
    return {
        host,
        destroy() {
            unmount(app);
            host.remove();
        },
    };
}

const MOUNT_TIMEOUT = 60_000;
let cleanup: (() => void) | null = null;

afterEach(() => {
    cleanup?.();
    cleanup = null;
});

describe("题库面板", () => {
    it("每行的删除按钮只渲染一个 ✕，不把 aria-label 当文本渲染出来", { timeout: MOUNT_TIMEOUT }, async () => {
        const { host, destroy } = await mountPanel();
        cleanup = destroy;

        const buttons = [...host.querySelectorAll("tbody button")].filter((b) => b.textContent?.includes("✕"));
        expect(buttons.length, "每题应该有一个删除按钮").toBe(items.length);
        for (const button of buttons) {
            // 属性必须真的落成属性
            expect(button.getAttribute("aria-label")).toBe("删除");
            expect(button.getAttribute("title")).toBe("删除");
            // 原 bug：属性写在开始标签之后，被当成文本，渲染出
            // 「aria-label=删除 title=删除 ✕」
            expect(button.textContent?.replace(/\s+/g, "")).toBe("✕");
            expect(button.textContent).not.toContain("aria-label=");
            expect(button.textContent).not.toContain("title=");
        }
    });

    it("列表渲染出全部题目，并按到期时间升序排列", { timeout: MOUNT_TIMEOUT }, async () => {
        const { host, destroy } = await mountPanel();
        cleanup = destroy;

        const rows = [...host.querySelectorAll("tbody tr")];
        expect(rows).toHaveLength(items.length);
        // 到期的那道题（-1 天）应排在 9 天后的前面
        expect(rows[0].textContent).toContain("时间片过小的主要代价是什么？");
        expect(rows[0].textContent).toContain("已到期");
        expect(rows[1].textContent).toContain("9 天后");
    });

    it("头部徽标的到期数与该题的到期文本口径一致", { timeout: MOUNT_TIMEOUT }, async () => {
        const { host, destroy } = await mountPanel();
        cleanup = destroy;

        expect(host.textContent).toContain("到期 1");
        const overdueCells = [...host.querySelectorAll("tbody tr")].filter((r) => r.textContent?.includes("已到期"));
        expect(overdueCells).toHaveLength(1);
    });

    it("点击题干可展开复习历史与排程详情，再点收起", { timeout: MOUNT_TIMEOUT }, async () => {
        const { host, destroy } = await mountPanel();
        cleanup = destroy;

        const toggle = host.querySelector<HTMLButtonElement>("tbody button[aria-expanded]");
        expect(toggle).toBeTruthy();
        expect(toggle!.getAttribute("aria-expanded")).toBe("false");

        toggle!.click();
        flushSync();
        expect(host.querySelector("tbody button[aria-expanded]")!.getAttribute("aria-expanded")).toBe("true");
        expect(host.textContent).toContain("复习排程（FSRS）");
        // 平均分文案要显示实际参与平均的次数（这里只有 2 条历史）
        expect(host.textContent).toContain("最近 2 次平均 80 分");

        host.querySelector<HTMLButtonElement>("tbody button[aria-expanded]")!.click();
        flushSync();
        expect(host.querySelector("tbody button[aria-expanded]")!.getAttribute("aria-expanded")).toBe("false");
    });

    it("到期题在池中时给出直接开始复习的入口", { timeout: MOUNT_TIMEOUT }, async () => {
        const started: unknown[] = [];
        const host = document.createElement("div");
        document.body.appendChild(host);
        const app = mount(BankPanel, {
            target: host,
            props: { service: fakeService(), lang: "zh", onStartReview: (scope: unknown) => started.push(scope) },
        });
        await new Promise((r) => setTimeout(r, 0));
        flushSync();
        cleanup = () => {
            unmount(app);
            host.remove();
        };

        expect(host.textContent).toContain("共 2 题中有 1 题已到期");
        const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "复习到期题目");
        expect(button, "应有一个直接复习到期题的按钮").toBeTruthy();
        button!.click();
        // 空 scope 表示「全部到期题」，由插件层展开为复习到期题目 Tab
        expect(started).toEqual([{}]);
    });
});
