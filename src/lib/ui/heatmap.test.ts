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

/**
 * 格子现在是层图库（layerchart）的 SVG <rect>，不是 HTML button：
 * 读屏名称走 aria-label，点击要用合成 MouseEvent（SVG 元素没有 HTMLElement.click）。
 */
const cells = (host: HTMLElement) => [...host.querySelectorAll<SVGRectElement>("[data-cell-index]")];

function clickCell(cell: SVGRectElement): void {
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

const tipOf = (cell: SVGRectElement) => cell.getAttribute("aria-label") ?? "";
const textOf = (host: HTMLElement) => (host.textContent ?? "").replace(/\s+/g, " ");

describe("热力图", () => {
    it("月份标签按界面语言渲染（中文出现「月」）", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountHeatmap();
        // 标签由图表库的 SVG 文本承担：原先月份是 HTML 盒子，且必须禁止换行，
        // 否则「10月」会折成两行把整行撑高；文本节点不存在折行问题，这个失效方式已经消失
        const labels = [...host.querySelectorAll("text")].filter((node) => node.textContent?.includes("月"));
        expect(labels.length, "至少应有一个月份标签").toBeGreaterThan(0);
    });

    it("星期标签存在且不重复（每行最多一个）", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountHeatmap();
        const labels = [...host.querySelectorAll("text")].filter((node) =>
            /^[日一二三四五六]$/.test(node.textContent ?? "")
        );
        expect(labels.length, "不应缺星期标签").toBeGreaterThan(0);
        const values = labels.map((node) => node.textContent);
        expect(new Set(values).size, "同一天只能出现一次").toBe(values.length);
    });

    it("只有一格可 Tab 聚焦（roving tabindex）", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountHeatmap();
        const all = cells(host);
        expect(all.length).toBeGreaterThan(50);
        const tabbable = all.filter((c) => c.getAttribute("tabindex") === "0");
        // 下标是「周列 × 7 + 星期几」，首格未必是 0：初值取错会让一整张网格都没有可聚焦格
        expect(tabbable, "必须恰好有一格可 Tab 进入").toHaveLength(1);
    });

    it("点击有记录的日期会跳转，点击空白日期不跳转", { timeout: MOUNT_TIMEOUT }, async () => {
        const clicked: string[] = [];
        const host = mountHeatmap((date) => clicked.push(date));
        const all = cells(host);

        const withRecord = all.find((c) => !tipOf(c).includes("无记录"));
        const empty = all.find((c) => tipOf(c).includes("无记录"));
        expect(withRecord, "夹具里应有带记录的日期").toBeTruthy();
        expect(empty, "夹具里应有空白日期").toBeTruthy();

        clickCell(withRecord!);
        flushSync();
        expect(clicked).toHaveLength(1);
        // 提示以日期开头
        expect(clicked[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        clickCell(empty!);
        flushSync();
        // 点空白日期进去是一份空列表，用户还得再清一次筛选，因此不跳转
        expect(clicked).toHaveLength(1);
    });

    it("详情行默认显示记录条数，悬停某天时显示当天得分", { timeout: MOUNT_TIMEOUT }, async () => {
        const host = mountHeatmap();
        expect(textOf(host)).toContain("共 3 条答题记录");

        const withRecord = cells(host).find((c) => !tipOf(c).includes("无记录"));
        withRecord!.dispatchEvent(new Event("mouseenter"));
        flushSync();
        expect(textOf(host)).toContain(tipOf(withRecord!).split(" · ")[0]);
    });
});
