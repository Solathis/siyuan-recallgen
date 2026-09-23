import { describe, expect, it } from "vitest";
import { HEATMAP_WEEKS, mondayOffset, rangeYears, startOfDay, windowBounds } from "./heatmap-range";
import type { ScoreIndexEntry } from "@/types/quiz";

function entry(timestamp: number): ScoreIndexEntry {
    return {
        id: `s-${timestamp}`,
        quizId: `q-${timestamp}`,
        title: "t",
        timestamp,
        totalScore: 1,
        maxScore: 2,
        questionCount: 1,
        passedCount: 1,
        unanswered: 0,
        byType: {},
        byDifficulty: {},
        byTag: {},
        hasAnalysis: false,
    };
}

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 15, 30);

describe("mondayOffset", () => {
    it("周一为 0，周日为 6", () => {
        expect(mondayOffset(at(2026, 9, 21))).toBe(0); // 2026-09-21 是周一
        expect(mondayOffset(at(2026, 9, 27))).toBe(6); // 周日
    });
});

describe("startOfDay", () => {
    it("清零时间部分且不修改入参", () => {
        const input = at(2026, 9, 23);
        const result = startOfDay(input);
        expect(result.getHours()).toBe(0);
        expect(input.getHours()).toBe(15);
    });
});

describe("windowBounds - recent", () => {
    it("起点为周一，终点为今天，覆盖 52 整周加本周已过的天数", () => {
        for (const day of [1, 5, 9, 14, 21, 23, 27]) {
            const now = at(2026, 9, day);
            const { start, end } = windowBounds("recent", now);
            expect(end.getTime()).toBe(startOfDay(now).getTime());
            expect(mondayOffset(start)).toBe(0);
            const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
            expect(days).toBe((HEATMAP_WEEKS - 1) * 7 + mondayOffset(now) + 1);
        }
    });
});

describe("windowBounds - 自然年", () => {
    it("起点为 1 月 1 日所在周的周一", () => {
        const { start, end } = windowBounds(2024, at(2026, 9, 23));
        expect(mondayOffset(start)).toBe(0);
        expect(start.getTime()).toBeLessThanOrEqual(new Date(2024, 0, 1).getTime());
        // 最多回退 6 天
        expect(new Date(2024, 0, 1).getTime() - start.getTime()).toBeLessThan(7 * 86400000);
        expect(end.getTime()).toBe(new Date(2024, 11, 31).getTime());
    });

    it("2024 年为闰年，窗口覆盖 366 天", () => {
        const { start, end } = windowBounds(2024, at(2026, 9, 23));
        const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
        expect(days).toBe(366);
    });

    it("今年止于今天而不是 12 月 31 日", () => {
        const now = at(2026, 9, 23);
        const { end } = windowBounds(2026, now);
        expect(end.getTime()).toBe(startOfDay(now).getTime());
    });
});

describe("rangeYears", () => {
    it("总是包含今年，且按倒序排列", () => {
        const now = at(2026, 9, 23);
        const years = rangeYears([entry(at(2024, 3, 1).getTime()), entry(at(2025, 1, 9).getTime())], now);
        expect(years).toEqual([2026, 2025, 2024]);
    });

    it("重复年份只出现一次", () => {
        const now = at(2026, 9, 23);
        const years = rangeYears(
            [entry(at(2026, 1, 2).getTime()), entry(at(2026, 5, 2).getTime()), entry(at(2026, 8, 2).getTime())],
            now
        );
        expect(years).toEqual([2026]);
    });
});
