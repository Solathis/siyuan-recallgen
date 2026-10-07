// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
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
        sourceDocId: "doc-1",
        sourceTitle: "第三章 · 进程调度算法笔记",
        byType: {} as Partial<Record<QuestionType, never>>,
        byDifficulty: {},
        byTag: {},
        hasAnalysis: true,
        ...over,
    } as ScoreIndexEntry;
}

/** 两条记录：同一来源、不同日期，用来验证「按来源」分组时行内必须带日期 */
const records: ScoreIndexEntry[] = [
    entry("s1", { timestamp: NOW - 3600_000, title: "第三章 · 进程调度算法笔记" }),
    entry("s2", { timestamp: NOW - 3 * DAY, title: "第三章 · 进程调度算法笔记" }),
];

function fakeService(): QuizService {
    return {
        getConfig: () => getDefaultConfig(),
        subscribeConfig: () => () => {},
        listScores: async () => records,
        listBank: async () => [],
        bankSummary: async () => ({ total: 0, due: 0 }),
    } as unknown as QuizService;
}

const MOUNT_TIMEOUT = 60_000;
let cleanup: (() => void) | null = null;

afterEach(() => {
    cleanup?.();
    cleanup = null;
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

function clickTab(host: HTMLElement, label: string): void {
    const tab = [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.trim() === label);
    expect(tab, `没找到标签页「${label}」`).toBeTruthy();
    (tab as HTMLElement).click();
    flushSync();
}

/** 三种视图里删除按钮的文字（用于断言没有渲染出属性字面量） */
function deleteButtons(host: HTMLElement): HTMLElement[] {
    return [...host.querySelectorAll("button")].filter((b) => b.textContent?.includes("✕")) as HTMLElement[];
}

describe("历史记录面板", () => {
    it("三种视图的删除按钮都只渲染 ✕，且带可访问名称", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = await mountPanel();
        for (const view of ["列表", "表格", "缩略图"]) {
            clickTab(host, view);
            const buttons = deleteButtons(host);
            expect(buttons.length, `${view} 视图应有删除按钮`).toBeGreaterThan(0);
            for (const button of buttons) {
                expect(button.getAttribute("aria-label"), `${view} 视图缺少 aria-label`).toBe("删除");
                expect(button.getAttribute("title"), `${view} 视图缺少 title`).toBe("删除");
                // 原 bug：属性写在开始标签之后，被当成文本渲染成
                // 「aria-label=删除 title=删除 ✕」
                expect(button.textContent?.replace(/\s+/g, ""), view).toBe("✕");
            }
        }
    });

    it("按日期分组时行内只显示时刻", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = await mountPanel();
        clickTab(host, "列表");
        // 组标题带了日期，行内不该再重复一遍 MM-DD
        const row = host.querySelector("section div.hover\\:bg-accent");
        expect(row?.textContent).toBeTruthy();
        expect(/\d{2}-\d{2} \d{2}:\d{2}/.test(host.textContent ?? ""), "按日期分组不该在行内出现 MM-DD").toBe(false);
    });

    it("按来源分组时行内必须带日期（组标题只有文档名）", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = await mountPanel();
        clickTab(host, "列表");
        clickTab(host, "按来源");
        // 两条记录同一来源、不同日期，必须能区分出是哪天
        expect(host.textContent).toContain("按来源");
        expect(/\d{2}-\d{2} \d{2}:\d{2}/.test(host.textContent ?? ""), "按来源分组时行内应带上 MM-DD 时刻").toBe(true);
    });
});
