// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { expect, it } from "vitest";
import { getDefaultConfig } from "@/types/config";
import type { QuizService } from "../quiz/service";
import type { ScoreIndexEntry } from "@/types/quiz";
import { PAGE_SIZE } from "../quiz/paging";
import HistoryPanel from "./HistoryPanel.svelte";

/**
 * 答题记录页在大量记录下的渲染上限。
 *
 * 分段渲染本来就有，但原先只有搜索与分数筛选会把已渲染条数收回一页：
 * 滚远之后再切视图或分组，会一次渲染出所有已加载的行；每行还各带一套删除确认框。
 * 设置环境变量 RG_HISTORY_METRICS=1 时在测试输出里打印量测数字，用于改版前后对比。
 */
const N = 2000;
const DAY = 86_400_000;
const NOW = Date.now();

function records(): ScoreIndexEntry[] {
    return Array.from({ length: N }, (_, i) => ({
        id: `s-${i}`,
        quizId: `q-${i}`,
        title: `练习 #${i}`,
        timestamp: NOW - Math.floor(i / 17) * DAY - (i % 17) * 60_000,
        totalScore: (i * 37) % 101,
        maxScore: 100,
        questionCount: 8,
        passedCount: 5,
        unanswered: i % 3,
        duration: 400,
        sourceDocId: i % 2 ? "doc-a" : "doc-b",
        sourceTitle: i % 2 ? "第三章" : "第四章",
        byType: {},
        byDifficulty: {},
        byTag: {},
        hasAnalysis: i % 5 === 0,
    })) as ScoreIndexEntry[];
}

const service = {
    getConfig: () => getDefaultConfig(),
    subscribeConfig: () => () => {},
    listScores: async () => records(),
    listBank: async () => [],
    bankSummary: async () => ({ total: 0, due: 0 }),
} as unknown as QuizService;

/** 页面上出现了几条不同的记录（按标题去重，与视图无关） */
const rendered = (host: HTMLElement) =>
    new Set([...(host.textContent ?? "").matchAll(/练习 #(\d+)/g)].map((m) => m[1])).size;
const metrics = (host: HTMLElement) => ({
    elements: host.querySelectorAll("*").length,
    slots: host.querySelectorAll("[data-slot]").length,
    dialogTriggers: host.querySelectorAll('[data-slot="alert-dialog-trigger"]').length,
    rendered: rendered(host),
});

/** 分段控件：旧版是 Tabs，新版是 ToggleGroup；按文字找，两边都能点到 */
function choose(host: HTMLElement, label: string): void {
    const target = [...host.querySelectorAll<HTMLElement>('[role="tab"], [data-slot="toggle-group-item"]')].find(
        (el) => el.textContent?.trim() === label
    );
    expect(target, `没找到「${label}」`).toBeTruthy();
    target!.click();
    flushSync();
}

it("2000 条记录：首屏、加载更多、切换视图后渲染的行数都有上限", { timeout: 120_000 }, async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const started = performance.now();
    const app = mount(HistoryPanel, { target: host, props: { service, onOpenReview: () => {} } });
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
    const mountMs = Math.round(performance.now() - started);
    const first = metrics(host);

    for (let i = 0; i < 10; i++) {
        [...host.querySelectorAll("button")].find((b) => /加载更多/.test(b.textContent ?? ""))?.click();
        flushSync();
    }
    const expanded = metrics(host);

    choose(host, "表格");
    const afterSwitch = metrics(host);

    if (process.env.RG_HISTORY_METRICS === "1") {
        console.info("RG_HISTORY_METRICS", JSON.stringify({ mountMs, first, expanded, afterSwitch }));
    }

    expect(first.rendered).toBeLessThanOrEqual(PAGE_SIZE);
    expect(expanded.rendered, "加载更多没有生效").toBeGreaterThan(PAGE_SIZE);
    expect(afterSwitch.rendered, "切换视图后应回到一页").toBeLessThanOrEqual(PAGE_SIZE);
    expect(afterSwitch.dialogTriggers, "删除确认框应整页共用一个，而不是每行一个").toBe(0);

    unmount(app);
    host.remove();
});
