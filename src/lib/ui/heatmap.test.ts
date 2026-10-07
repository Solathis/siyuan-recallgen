// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import type { HeatmapConfig, ScoreIndexEntry } from "@/types/quiz";
import Heatmap from "./Heatmap.svelte";

const DAY = 86_400_000;
const NOW = new Date();
const todayStart = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()).getTime();

const config: HeatmapConfig = {
    enabled: true,
    metric: "max",
    ranges: [
        { min: 0, max: 59, color: "#e8b3ad" },
        { min: 60, max: 79, color: "#f0d9a8" },
        { min: 80, max: 100, color: "#b6d7b0" },
    ],
};

/** 今天两条、三天前一条，其余日期留空 */
function makeRecords(): ScoreIndexEntry[] {
    const base = {
        quizId: "q",
        totalScore: 320,
        maxScore: 400,
        questionCount: 4,
        passedCount: 3,
        unanswered: 0,
        duration: 300,
        sourceDocId: "doc-1",
        sourceTitle: "第三章",
        byType: {},
        byDifficulty: {},
        byTag: {},
        hasAnalysis: true,
    };
    return [
        { ...base, id: "a", title: "今天第一次", timestamp: todayStart + 3600_000 },
        { ...base, id: "b", title: "今天第二次", timestamp: todayStart + 7200_000 },
        { ...base, id: "c", title: "三天前", timestamp: todayStart - 3 * DAY + 3600_000 },
    ] as ScoreIndexEntry[];
}

const MOUNT_TIMEOUT = 60_000;
let cleanup: (() => void) | null = null;

afterEach(() => {
    cleanup?.();
    cleanup = null;
});

function mountHeatmap(onDayClick?: (date: string) => void) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(Heatmap, {
        target: host,
        props: { records: makeRecords(), lang: "zh", config, onDayClick },
    });
    flushSync();
    cleanup = () => {
        unmount(app);
        host.remove();
    };
    return host;
}

const cells = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>("[data-cell-index]")];

describe("热力图", () => {
    it("月份标签禁止换行（否则「10月」会折成两行，把整行撑高）", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountHeatmap();
        const monthRow = [...host.querySelectorAll("div")].find(
            (d) => d.className.includes("pb-1") && d.textContent?.includes("月")
        );
        expect(monthRow, "没找到月份标签行").toBeTruthy();
        const spans = [...monthRow!.querySelectorAll("span")].filter((s) => s.textContent?.includes("月"));
        expect(spans.length).toBeGreaterThan(0);
        for (const span of spans) {
            expect(span.className, "月份标签必须 whitespace-nowrap").toContain("whitespace-nowrap");
        }
    });

    it("星期标签列顶部有与月份行等高的占位（不补占位标签会整体上移一行）", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountHeatmap();
        const labelCol = [...host.querySelectorAll("div")].find(
            (d) => d.className.includes("text-3xs") && d.textContent?.includes("一")
        );
        expect(labelCol, "没找到星期标签列").toBeTruthy();
        const spacer = labelCol!.firstElementChild as HTMLElement;
        expect(spacer.getAttribute("aria-hidden"), "占位必须对读屏隐藏").toBe("true");
        expect(spacer.className).toContain("pb-1");
        // 第二个孩子才是第一个标签
        expect(labelCol!.children[1].textContent?.trim()).toBe("一");
    });

    it("只有一格可 Tab 聚焦（roving tabindex）", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountHeatmap();
        const all = cells(host);
        expect(all.length).toBeGreaterThan(50);
        expect(all.filter((c) => c.getAttribute("tabindex") === "0")).toHaveLength(1);
    });

    it("点击有记录的日期会跳转，点击空白日期不跳转", { timeout: MOUNT_TIMEOUT }, async () => {
        const clicked: string[] = [];
        const host = mountHeatmap((date) => clicked.push(date));
        const all = cells(host);

        const withRecord = all.find((c) => !(c.getAttribute("title") ?? "").includes("无记录"));
        const empty = all.find((c) => (c.getAttribute("title") ?? "").includes("无记录"));
        expect(withRecord, "夹具里应有带记录的日期").toBeTruthy();
        expect(empty, "夹具里应有空白日期").toBeTruthy();

        withRecord!.click();
        flushSync();
        expect(clicked).toHaveLength(1);
        // 工具提示以日期开头
        expect(clicked[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        empty!.click();
        flushSync();
        // 点空白日期进去是一份空列表，用户还得再清一次筛选，因此不跳转
        expect(clicked).toHaveLength(1);
    });

    it("详情行默认显示记录条数，聚焦某天时显示当天得分", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = mountHeatmap();
        expect(host.textContent).toContain("共 3 条答题记录");

        const withRecord = cells(host).find((c) => !(c.getAttribute("title") ?? "").includes("无记录"));
        withRecord!.dispatchEvent(new Event("mouseenter"));
        flushSync();
        expect(host.textContent).toContain(withRecord!.getAttribute("aria-label")!.split(" · ")[0]);
    });
});
