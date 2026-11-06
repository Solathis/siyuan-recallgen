// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDefaultConfig } from "@/types/config";
import type { QuizService } from "../quiz/service";
import type { QuestionType, ScoreIndexEntry } from "@/types/quiz";
import HistoryPanel from "./HistoryPanel.svelte";

const DAY = 86_400_000;
const NOW = Date.now();

function entry(id: string, over: Partial<ScoreIndexEntry> = {}): ScoreIndexEntry {
    return {
        id,
        quizId: `quiz-${id}`,
        title: "第三章 · 进程调度算法笔记",
        timestamp: NOW - 3 * DAY,
        totalScore: 300,
        maxScore: 400,
        questionCount: 4,
        passedCount: 3,
        unanswered: 0,
        duration: 400,
        sourceDocId: "20261008120000-abcdefg",
        sourceTitle: "第三章 · 进程调度算法笔记",
        byType: {} as Partial<Record<QuestionType, never>>,
        byDifficulty: {},
        byTag: {},
        hasAnalysis: true,
        ...over,
    } as ScoreIndexEntry;
}

/**
 * 前两条同一来源、不同日期（验证「按来源」分组时行内必须带日期）；
 * 第三条是粘贴材料出的题（占位的 sourceDocId，不能跳回原笔记），分数也最低。
 */
const records: ScoreIndexEntry[] = [
    entry("s1", { timestamp: NOW - 3600_000, title: "第三章 · 进程调度算法笔记" }),
    entry("s2", { timestamp: NOW - 3 * DAY, title: "第三章 · 进程调度算法笔记" }),
    entry("s3", {
        timestamp: NOW - 5 * DAY,
        title: "临时讲义",
        sourceTitle: "临时讲义",
        sourceDocId: "manual-1730000000000",
        totalScore: 100,
        passedCount: 1,
    }),
];

let removeScore = vi.fn(async (_id: string) => {});
let openDoc = vi.fn((_id: string) => {});

function fakeService(): QuizService {
    return {
        getConfig: () => getDefaultConfig(),
        subscribeConfig: () => () => {},
        listScores: async () => records,
        listBank: async () => [],
        bankSummary: async () => ({ total: 0, due: 0 }),
        removeScore,
        openDoc,
    } as unknown as QuizService;
}

const MOUNT_TIMEOUT = 60_000;
let cleanup: (() => void) | null = null;

afterEach(() => {
    cleanup?.();
    cleanup = null;
    removeScore = vi.fn(async () => {});
    openDoc = vi.fn(() => {});
});

async function mountPanel() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(HistoryPanel, {
        target: host,
        props: { service: fakeService(), onOpenReview: () => {} },
    });
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
    cleanup = () => {
        unmount(app);
        host.remove();
    };
    return host;
}

/** 分段控件（顶层子页是 Tabs，分组/视图/分数区间是 ToggleGroup）：按文字或无障碍名称找 */
function choose(host: HTMLElement, label: string): void {
    const target = [...host.querySelectorAll<HTMLElement>('[role="tab"], [data-slot="toggle-group-item"]')].find(
        (el) => el.textContent?.trim() === label || el.getAttribute("aria-label") === label
    );
    expect(target, `没找到「${label}」`).toBeTruthy();
    target!.click();
    flushSync();
}

/**
 * 打开 bits-ui 的下拉菜单：它在 pointerdown 时切换开合。
 * 不能再补一个 click——detail 为 0 的 click 会被当成读屏软件的点击，再切换一次，菜单又关上了。
 */
function press(el: HTMLElement): void {
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    flushSync();
}

const menuTriggers = (host: HTMLElement) =>
    [...host.querySelectorAll<HTMLElement>("button")].filter((b) => b.getAttribute("aria-label") === "更多操作");
/** 只取当前打开的菜单：jsdom 里收起的菜单等不到 animationend，会一直留在 DOM 里 */
const menuItems = () => [
    ...document.body.querySelectorAll<HTMLElement>(
        '[data-slot="dropdown-menu-content"][data-state="open"] [data-slot="dropdown-menu-item"]'
    ),
];
const kpi = (host: HTMLElement, label: string) =>
    [...host.querySelectorAll("dl > div")]
        .find((cell) => cell.querySelector("dt")?.textContent?.trim() === label)
        ?.querySelector("dd")
        ?.textContent?.trim();

describe("历史记录面板", () => {
    it(
        "三种视图每行都有一个「更多操作」按钮，带可访问名称且不把属性当文本渲染",
        { timeout: MOUNT_TIMEOUT },
        async () => {
            const host = await mountPanel();
            for (const view of ["列表", "表格", "卡片"]) {
                choose(host, view);
                const buttons = menuTriggers(host);
                expect(buttons.length, `${view} 视图每条记录一个`).toBe(records.length);
                for (const button of buttons) {
                    expect(button.getAttribute("title"), view).toBe("更多操作");
                    // 原 bug：属性写在开始标签之后，被当成文本渲染成「aria-label=删除 title=删除 ✕」
                    expect(button.textContent ?? "", view).not.toContain("aria-label=");
                }
            }
        }
    );

    it("按日期分组时行内只显示时刻", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = await mountPanel();
        const row = host.querySelector('section [data-slot="item"]');
        expect(row?.textContent).toBeTruthy();
        // 组标题带了日期，行内不该再重复一遍 MM-DD
        expect(/\d{2}-\d{2} \d{2}:\d{2}/.test(host.textContent ?? ""), "按日期分组不该在行内出现 MM-DD").toBe(false);
    });

    it("按来源分组时行内必须带日期（组标题只有文档名）", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = await mountPanel();
        choose(host, "按来源");
        expect(/\d{2}-\d{2} \d{2}:\d{2}/.test(host.textContent ?? ""), "按来源分组时行内应带上 MM-DD 时刻").toBe(true);
        // 同一篇文档的两条归为一组，粘贴材料那条单独一组
        expect(host.querySelectorAll("section")).toHaveLength(2);
    });

    it("四格汇总跟随筛选，达标率按题数加权，每题用时与统计页同一口径", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = await mountPanel();
        // 75 / 75 / 25 分；达标题 3+3+1 / 题数 4+4+4；用时 400×3 / 12 题
        expect(kpi(host, "记录数")).toBe("3");
        expect(kpi(host, "平均分")).toBe("58.3");
        expect(kpi(host, "达标率")).toBe("58%");
        expect(kpi(host, "每题用时")).toBe("100s");

        choose(host, "60 分以下");
        expect(kpi(host, "记录数")).toBe("1");
        expect(kpi(host, "平均分")).toBe("25.0");
        expect(host.textContent).toContain("临时讲义");
        expect(host.textContent).not.toContain("进程调度");

        choose(host, "60-79 分");
        expect(kpi(host, "记录数")).toBe("2");
        expect(host.textContent).not.toContain("临时讲义");
    });

    it("搜索没有结果时给出空态与「清除筛选」，点了恢复全部", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = await mountPanel();
        const input = host.querySelector<HTMLInputElement>('input[aria-label="搜索标题或来源"]')!;
        input.value = "临时";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        flushSync();
        expect(kpi(host, "记录数")).toBe("1");

        input.value = "不存在的标题";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        flushSync();
        expect(host.textContent).toContain("没有符合筛选条件的记录");
        [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "清除筛选")!.click();
        flushSync();
        expect(kpi(host, "记录数")).toBe("3");
    });

    it(
        "删除走整页共用的确认框：行内没有各自的确认框，确认后调用服务并移除该行",
        { timeout: MOUNT_TIMEOUT },
        async () => {
            const host = await mountPanel();
            expect(host.querySelectorAll('[data-slot="alert-dialog-trigger"]')).toHaveLength(0);

            press(menuTriggers(host)[0]);
            const remove = menuItems().find((item) => item.textContent?.includes("删除"));
            expect(remove, "菜单里应有删除").toBeTruthy();
            remove!.click();
            flushSync();
            await new Promise((r) => setTimeout(r, 0));
            flushSync();

            const dialog = document.body.querySelector('[data-slot="alert-dialog-content"]');
            expect(dialog?.textContent).toContain("第三章 · 进程调度算法笔记");
            const confirm = [...dialog!.querySelectorAll<HTMLElement>("button")].find(
                (b) => b.textContent?.trim() === "删除"
            );
            confirm!.click();
            await vi.waitFor(() => {
                flushSync();
                expect(kpi(host, "记录数")).toBe("2");
            });
            expect(removeScore).toHaveBeenCalledWith("s1");
        }
    );

    it("「跳回原笔记」只给真实文档；粘贴材料出的题没有这一项", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = await mountPanel();
        press(menuTriggers(host)[0]);
        const open = menuItems().find((item) => item.textContent?.includes("跳回原笔记"));
        expect(open, "真实文档应能跳回").toBeTruthy();
        open!.click();
        flushSync();
        expect(openDoc).toHaveBeenCalledWith("20261008120000-abcdefg");

        const manualRow = [...host.querySelectorAll<HTMLElement>('[data-slot="item"]')].find((row) =>
            row.textContent?.includes("临时讲义")
        );
        press(manualRow!.querySelector<HTMLElement>('button[aria-label="更多操作"]')!);
        const items = menuItems().map((item) => item.textContent?.trim());
        expect(items.some((text) => text?.includes("查看"))).toBe(true);
        expect(items.some((text) => text?.includes("跳回原笔记"))).toBe(false);
    });
});
