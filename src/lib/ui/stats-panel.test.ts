// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import type { Difficulty, QuestionType, ScoreAggregate, ScoreIndexEntry } from "@/types/quiz";
import StatsPanel from "./StatsPanel.svelte";

const DAY = 86_400_000;
const NOW = Date.now();

const agg = (count: number, passed: number): ScoreAggregate => ({
    count,
    passed,
    score: passed * 100,
    maxScore: count * 100,
});

function record(i: number): ScoreIndexEntry {
    return {
        id: `s${i}`,
        quizId: `quiz-${i}`,
        title: `第 ${i + 1} 次复习`,
        timestamp: NOW - i * DAY,
        totalScore: 300,
        maxScore: 400,
        questionCount: 4,
        passedCount: 3,
        unanswered: 0,
        duration: 300,
        sourceDocId: `doc-${i}`,
        sourceTitle: `第 ${i + 1} 章`,
        byType: { single_choice: agg(2, 2), fill_blank: agg(2, 1) } as Partial<Record<QuestionType, ScoreAggregate>>,
        byDifficulty: { easy: agg(2, 2), medium: agg(1, 0), hard: agg(1, 1) } as Partial<
            Record<Difficulty, ScoreAggregate>
        >,
        byTag: { 进程调度: agg(2, 2), 同步: agg(2, 0) },
        hasAnalysis: true,
    } as ScoreIndexEntry;
}

const records = [record(0), record(1), record(2)];

const MOUNT_TIMEOUT = 60_000;
let cleanup: (() => void) | null = null;

afterEach(() => {
    cleanup?.();
    cleanup = null;
});

function mountPanel() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(StatsPanel, { target: host, props: { records, loading: false, lang: "zh" } });
    flushSync();
    cleanup = () => {
        unmount(app);
        host.remove();
    };
    return host;
}

describe("统计面板", () => {
    it("概览区渲染全部 5 张卡片（含今日进度）", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountPanel();
        const text = host.textContent ?? "";
        for (const label of ["答题次数", "平均得分率", "连续打卡", "每题平均耗时", "今日进度"]) {
            expect(text, `缺少概览卡「${label}」`).toContain(label);
        }
        // 5 张卡必须由同一个网格承载，否则第 5 张会单独占一行、右侧空三格
        const grid = [...host.querySelectorAll("div")].find((d) => d.className.toString().includes("grid-cols-5"));
        expect(grid, "没找到概览网格").toBeTruthy();
        expect([...grid!.children]).toHaveLength(5);
    });

    it("难度环形图图例显示样本题数，而不是「占三者之和的比例」", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountPanel();
        const legend = [...host.querySelectorAll("li")]
            .map((li) => li.textContent?.replace(/\s+/g, " ").trim() ?? "")
            .filter((text) => text.includes("%"));
        expect(legend.length, "应有难度图例").toBeGreaterThan(0);
        for (const line of legend) {
            // 括号里必须是「N 题」这种有业务含义的补充信息
            expect(line, `${line} 缺少样本题数`).toMatch(/（\d+ 题）/);
            // 原实现括号里是 value/total 得到的占比（如「89%（52%）」），
            // 这个数没有业务含义，读者会误当成该难度占多少题
            expect(line, `${line} 里的占比没有业务含义`).not.toMatch(/（\d+%）/);
        }
    });

    it("分区标题与指标口径一致（达标率而不是正确率）", { timeout: MOUNT_TIMEOUT }, () => {
        const host = mountPanel();
        const text = host.textContent ?? "";
        expect(text).toContain("题型达标率");
        expect(text).toContain("难度达标率");
        expect(text).not.toContain("正确率");
    });
});
