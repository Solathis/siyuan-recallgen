import { differenceInCalendarDays } from "date-fns";
import type { ScoreIndexEntry } from "@/types/quiz";

/**
 * 热力图的统计范围计算。
 * 抽成纯函数模块便于单测：组件内只负责渲染。
 */

/** GitHub 风格最近窗口的周数（约一年）。格子边长由容器宽度反算，见 app.css 的 .rg-heatmap */
export const HEATMAP_WEEKS = 53;

/** 'recent' 为最近 53 周滚动窗口，数字为某个自然年 */
export type HeatmapRange = "recent" | number;

/** 周一为一周第一天时的偏移量 */
export function mondayOffset(date: Date): number {
    return (date.getDay() + 6) % 7;
}

/** 去掉时间部分，返回当天零点 */
export function startOfDay(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * 两个日期相差几个「日历天」，与夏令时无关。
 *
 * 不能用 (a - b) / 86400000 再取整：夏令时切换那天只有 23 小时或 25 小时，
 * 于是同一个星期的列号会整体偏一格——在观测夏令时的时区里
 * （America/New_York 实测 3 月切换后 col 8 应为 9），热力图从 3 月到 11 月
 * 全部画早了一周，格子互相压在一起。中国无夏令时所以本地看不出来，
 * 这正是它一直没被发现的原因。
 * date-fns 的 differenceInCalendarDays 按本地日历日归一后相减，
 * 是这件事的成熟实现，不必自己拿毫秒除以天数。
 */
export function calendarDaysBetween(later: Date, earlier: Date): number {
    return differenceInCalendarDays(later, earlier);
}

/**
 * 某天落在第几周列。
 *
 * 窗口起点恒为周一（见 windowBounds），因此「日历天差 / 7 取整」正好是列号，
 * 不需要再补星期的偏移。
 */
export function weekColumn(day: Date, windowStart: Date): number {
    return Math.floor(calendarDaysBetween(startOfDay(day), startOfDay(windowStart)) / 7);
}

/**
 * 当前范围内的起止日期（含首尾）。
 * - 最近窗口：以今天所在周的周一为终点，向前 53 周
 * - 自然年：1 月 1 日所在周的周一起算；今年止于今天，往年止于 12 月 31 日
 */
export function windowBounds(range: HeatmapRange, now: Date = new Date()): { start: Date; end: Date } {
    const today = startOfDay(now);
    if (range === "recent") {
        const end = new Date(today);
        const start = new Date(today);
        // 起点必须是周一，否则整张图的星期标签会错位一行
        start.setDate(start.getDate() - ((HEATMAP_WEEKS - 1) * 7 + mondayOffset(today)));
        return { start, end };
    }

    const jan1 = new Date(range, 0, 1);
    const start = new Date(jan1);
    start.setDate(start.getDate() - mondayOffset(jan1));
    const lastDay = new Date(range, 11, 31);
    const end = range === today.getFullYear() && today < lastDay ? today : lastDay;
    return { start, end };
}

/** 有记录的自然年 + 今年，倒序去重 */
export function rangeYears(records: ScoreIndexEntry[], now: Date = new Date()): number[] {
    const set = new Set<number>([now.getFullYear()]);
    for (const r of records) set.add(new Date(r.timestamp).getFullYear());
    return [...set].sort((a, b) => b - a);
}
