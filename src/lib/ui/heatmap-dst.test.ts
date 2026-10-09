// @vitest-environment node
/*
 * 夏令时口径的回归。
 *
 * 热力图的「第几周列」与统计页的「连续打卡天数」原先都用
 * `(a - b) / 86400000` 再取整。夏令时切换那天只有 23 或 25 小时，
 * 于是差值不是天数的整数倍：
 * - 热力图：切换之后的所有格子整体偏一列（实测 America/New_York 下
 *   3 月切换后 col 应为 9 却是 8），从 3 月到 11 月整张图错位；
 * - 连续天数：靠 Math.round 侥幸对得上「正好差一小时」的情况。
 *
 * 这两处必须真的处在观测夏令时的时区里才复现，所以本文件把进程时区切到
 * America/New_York。测试文件各自跑在独立 worker 里，切时区不会影响别的文件。
 * 如果所在环境不支持运行时切时区（TZ 未生效），下面会直接失败而不是静默跳过——
 * 否则这个回归网会在无人察觉的情况下失效。
 */
process.env.TZ = "America/New_York";

import { describe, expect, it } from "vitest";
import { streaks } from "@/lib/quiz/charts";
import { weekColumn, windowBounds } from "@/lib/ui/heatmap-range";

/** 夏令时生效时纽约是 UTC-4（240 分钟），冬令时是 UTC-5（300 分钟） */
const summerOffset = new Date("2026-07-01T12:00:00").getTimezoneOffset();
const winterOffset = new Date("2026-01-15T12:00:00").getTimezoneOffset();

describe("夏令时环境本身可用", () => {
    it("进程时区已切到 America/New_York（否则下面的用例没有意义）", () => {
        expect(summerOffset, "TZ 未生效：本进程不支持运行时切时区").toBe(240);
        expect(winterOffset).toBe(300);
    });
});

describe("热力图列号跨夏令时不错位", () => {
    it("每个周一恰好比上一个周一多一列", () => {
        const { start } = windowBounds("recent", new Date("2026-12-28T12:00:00"));
        // 起点是周一；连续 53 周的周一，列号必须是 0,1,2,…,52
        // 旧实现用毫秒除以 7 天，3 月 8 日（切换日）之后会整体少 1
        for (let week = 0; week < 53; week++) {
            const monday = new Date(start);
            monday.setDate(monday.getDate() + week * 7);
            expect(weekColumn(monday, start), `${monday.toDateString()} 应是第 ${week} 列`).toBe(week);
        }
    });

    it("切换那一周的同一列仍在同一列（跨过 3 月切换）", () => {
        const { start } = windowBounds("recent", new Date("2026-12-28T12:00:00"));
        const before = new Date("2026-03-02T00:00:00"); // 切换前，周一
        const after = new Date("2026-03-09T00:00:00"); // 切换后，周一
        expect(weekColumn(after, start) - weekColumn(before, start)).toBe(1);
    });
});

describe("连续打卡天数跨夏令时不断", () => {
    it("跨越 3 月切换日的连续日期算作连续", () => {
        // 2026-03-08 是纽约的夏令时切换日
        const days = ["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"];
        const { longest } = streaks(days, new Date("2026-03-10T12:00:00").getTime());
        expect(longest, "切换日不该把连续打断").toBe(5);
    });

    it("跨越 11 月切换日的连续日期算作连续", () => {
        const days = ["2026-10-31", "2026-11-01", "2026-11-02"];
        const { current, longest } = streaks(days, new Date("2026-11-02T12:00:00").getTime());
        expect(longest).toBe(3);
        expect(current).toBe(3);
    });

    it("中间真的断了一天就不算连续", () => {
        const days = ["2026-03-06", "2026-03-08"];
        expect(streaks(days, new Date("2026-03-08T12:00:00").getTime()).longest).toBe(1);
    });
});
