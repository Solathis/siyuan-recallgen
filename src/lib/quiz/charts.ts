import { differenceInCalendarDays, parseISO, startOfDay } from "date-fns";
import type { Difficulty, QuestionType, ScoreIndexEntry } from "@/types/quiz";
import { scorePercent } from "./stats";

/**
 * 统计图表的数据准备。
 *
 * 全部是纯函数，便于单测；不依赖 ECharts 与 DOM——
 * 组件只负责把这里算好的序列交给图表渲染。
 */

/** 题型固定展示顺序 */
export const TYPE_ORDER: QuestionType[] = [
    "single_choice",
    "multiple_choice",
    "fill_blank",
    "true_false",
    "subjective",
    "coding",
];

/** 难度固定展示顺序 */
export const DIFFICULTY_ORDER: Difficulty[] = ["easy", "medium", "hard"];

/** UI 提供的时间范围选项（天），0 表示全部 */
export type RangeDays = 7 | 30 | 90 | 0;

/** 本地日期键 YYYY-MM-DD */
export function dayKey(timestamp: number): string {
    const d = new Date(timestamp);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 按时间范围过滤（按本地日切分，含当天）。
 * days 为 0 表示不限范围；函数本身接受任意天数，UI 只暴露预置档位。
 * 同时排除未来时间戳：导入的数据或系统时钟回拨可能产生这类记录，
 * 不排除的话它们会永远留在任何范围里，让统计结果偏大。
 */
export function filterByRange(entries: ScoreIndexEntry[], days: number, now = Date.now()): ScoreIndexEntry[] {
    const upper = new Date(now);
    upper.setHours(23, 59, 59, 999);
    const until = upper.getTime();
    if (!(days > 0)) return entries.filter((e) => e.timestamp <= until);

    const cutoff = new Date(now);
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    const from = cutoff.getTime();
    return entries.filter((e) => e.timestamp >= from && e.timestamp <= until);
}

/** 总览指标 */
export interface StatsSummary {
    quizCount: number;
    questionCount: number;
    /** 平均得分率（0-100） */
    averagePercent: number;
    /** 最高得分率（0-100） */
    bestPercent: number;
    /** 有答题记录的天数 */
    activeDays: number;
    /** 当前连续打卡天数（截至今天或最近有记录的一天） */
    currentStreak: number;
    /** 历史最长连续打卡天数 */
    longestStreak: number;
    /** 平均每题耗时（秒），无数据时为 null */
    secondsPerQuestion: number | null;
}

/** 计算总览指标 */
export function summarize(entries: ScoreIndexEntry[], now = Date.now()): StatsSummary {
    if (entries.length === 0) {
        return {
            quizCount: 0,
            questionCount: 0,
            averagePercent: 0,
            bestPercent: 0,
            activeDays: 0,
            currentStreak: 0,
            longestStreak: 0,
            secondsPerQuestion: null,
        };
    }

    const percents = entries.map(scorePercent);
    const questionCount = entries.reduce((sum, e) => sum + e.questionCount, 0);
    const totalDuration = entries.reduce((sum, e) => sum + (e.duration ?? 0), 0);
    const totalQuestionsWithDuration = entries
        .filter((e) => (e.duration ?? 0) > 0)
        .reduce((s, e) => s + e.questionCount, 0);
    // 优先用实测的单题耗时：它不含中途离开、思考停顿等空白时间
    /*
     * 单题耗时按「题数」加权，不能对各次记录的单题均值再取平均。
     * 一次 20 题 30 秒/题 与一次 2 题 60 秒/题，简单平均会得出 45 秒，
     * 而真实口径应当是 (20×30 + 2×60) / 22 ≈ 32.7 秒/题。
     */
    const measured = entries.filter(
        (e) => typeof e.avgQuestionSeconds === "number" && e.avgQuestionSeconds > 0 && e.questionCount > 0
    );

    const days = [...new Set(entries.map((e) => dayKey(e.timestamp)))].sort();
    const { current, longest } = streaks(days, now);

    return {
        quizCount: entries.length,
        questionCount,
        averagePercent: percents.reduce((a, b) => a + b, 0) / percents.length,
        bestPercent: Math.max(...percents),
        activeDays: days.length,
        currentStreak: current,
        longestStreak: longest,
        secondsPerQuestion:
            measured.length > 0
                ? weightPerQuestion(measured)
                : totalQuestionsWithDuration > 0
                  ? totalDuration / totalQuestionsWithDuration
                  : null,
    };
}

/** 以题数为权重求「平均每题耗时」，结果保留一位小数 */
function weightPerQuestion(entries: ScoreIndexEntry[]): number {
    let seconds = 0;
    let questions = 0;
    for (const entry of entries) {
        seconds += (entry.avgQuestionSeconds ?? 0) * entry.questionCount;
        questions += entry.questionCount;
    }
    if (questions === 0) return 0;
    return Math.round((seconds / questions) * 10) / 10;
}

/** 'YYYY-MM-DD' 解析成本地当天零点 */
function dayStart(day: string): Date {
    // parseISO 对待「只有日期」的字符串时按本地时间解析，与 dayKey 的口径一致
    return startOfDay(parseISO(day));
}

/**
 * 由有序日期集合计算当前/最长连续天数。
 *
 * 相邻天数用 date-fns 的 differenceInCalendarDays 判断，而不是
 * (a - b) / 86400000 再四舍五入：夏令时切换那天是 23 或 25 小时，
 * 自己除毫秒只是在「恰好差一小时」时侥幸对得上（半小时时差、
 * 历史时区变更都会直接判错），而日历天差是这件事本来的定义。
 */
export function streaks(days: string[], now = Date.now()): { current: number; longest: number } {
    if (days.length === 0) return { current: 0, longest: 0 };

    let longest = 1;
    let run = 1;
    for (let i = 1; i < days.length; i++) {
        const diffDays = differenceInCalendarDays(dayStart(days[i]), dayStart(days[i - 1]));
        run = diffDays === 1 ? run + 1 : 1;
        longest = Math.max(longest, run);
    }

    // 当前连续：从今天（或昨天，容忍今天还没答题）向前数
    const gapFromToday = differenceInCalendarDays(startOfDay(new Date(now)), dayStart(days[days.length - 1]));
    if (gapFromToday > 1) return { current: 0, longest };

    let current = 1;
    for (let i = days.length - 1; i > 0; i--) {
        if (differenceInCalendarDays(dayStart(days[i]), dayStart(days[i - 1])) === 1) current++;
        else break;
    }
    return { current, longest: Math.max(longest, current) };
}

/** 分数趋势序列：按时间升序的得分率 */
export function scoreTrend(entries: ScoreIndexEntry[]): { timestamp: number; percent: number }[] {
    return [...entries]
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((e) => ({
            timestamp: e.timestamp,
            percent: scorePercent(e),
        }));
}

/** 某一维度的正确率 */
export interface GroupAccuracy {
    key: string;
    count: number;
    passed: number;
    accuracy: number;
    /** 平均得分率 */
    percent: number;
}

function accuracyOf(
    entries: ScoreIndexEntry[],
    pick: (entry: ScoreIndexEntry) => { count: number; passed: number; score: number; maxScore: number } | undefined,
    key: string
): GroupAccuracy {
    let count = 0;
    let passed = 0;
    let score = 0;
    let maxScore = 0;
    for (const entry of entries) {
        const agg = pick(entry);
        if (!agg) continue;
        count += agg.count;
        passed += agg.passed;
        score += agg.score;
        maxScore += agg.maxScore;
    }
    return {
        key,
        count,
        passed,
        accuracy: count > 0 ? (passed / count) * 100 : 0,
        percent: Number.isFinite(maxScore) && maxScore > 0 ? (score / maxScore) * 100 : 0,
    };
}

/** 按题型统计正确率，按固定顺序输出且只保留有数据的题型 */
export function accuracyByType(entries: ScoreIndexEntry[]): GroupAccuracy[] {
    // byType 用可选链：导入的旧记录可能没有该聚合字段，直接取值会在统计页抛错
    return TYPE_ORDER.map((type) => accuracyOf(entries, (e) => e.byType?.[type], type)).filter((g) => g.count > 0);
}

/** 按难度统计正确率 */
export function accuracyByDifficulty(entries: ScoreIndexEntry[]): GroupAccuracy[] {
    return DIFFICULTY_ORDER.map((d) => accuracyOf(entries, (e) => e.byDifficulty?.[d], d)).filter((g) => g.count > 0);
}

/**
 * 按知识点标签统计正确率。
 * 标签来自索引中的 byTag 聚合，按样本量倒序输出（样本多的知识点更可信）。
 * 旧记录没有标签时返回空数组。
 */
export function accuracyByTag(entries: ScoreIndexEntry[]): GroupAccuracy[] {
    // 单次遍历累积，而不是对每个标签再遍历一遍全部条目：
    // 标签数与条目数成正比时，原先的 O(标签数 × 条目数) 会变成明显的性能瓶颈
    const acc = new Map<string, { count: number; passed: number; score: number; maxScore: number }>();
    for (const entry of entries) {
        const byTag = entry.byTag;
        if (!byTag) continue;
        for (const [key, agg] of Object.entries(byTag)) {
            if (!agg) continue;
            const cur = acc.get(key);
            if (cur) {
                cur.count += agg.count;
                cur.passed += agg.passed;
                cur.score += agg.score;
                cur.maxScore += agg.maxScore;
            } else {
                acc.set(key, { ...agg });
            }
        }
    }
    return [...acc.entries()]
        .map(([key, agg]) => ({
            key,
            count: agg.count,
            passed: agg.passed,
            accuracy: agg.count > 0 ? (agg.passed / agg.count) * 100 : 0,
            percent: Number.isFinite(agg.maxScore) && agg.maxScore > 0 ? (agg.score / agg.maxScore) * 100 : 0,
        }))
        .filter((group) => group.count > 0)
        .sort((a, b) => b.count - a.count);
}

/** 分数分布直方图：0-59 / 60-69 / 70-79 / 80-89 / 90-100 */
export const SCORE_BUCKETS = [
    { key: "0-59", min: 0, max: 59 },
    { key: "60-69", min: 60, max: 69 },
    { key: "70-79", min: 70, max: 79 },
    { key: "80-89", min: 80, max: 89 },
    { key: "90-100", min: 90, max: 100 },
] as const;

/** 按分数区间统计次数 */
export function scoreDistribution(entries: ScoreIndexEntry[]): { key: string; count: number }[] {
    return SCORE_BUCKETS.map((bucket) => ({
        key: bucket.key,
        count: entries.filter((e) => {
            const p = scorePercent(e);
            return p >= bucket.min && p <= bucket.max;
        }).length,
    }));
}

/**
 * 薄弱环节排行。
 *
 * 索引里只保存了「按题型」与「按难度」两个维度的边际聚合，没有两者的交叉计数，
 * 因此这里只对真实存在的边际数据排序，不凭估算编造「某题型 × 某难度」的精确数字。
 * 带标签的知识点排行需要题目携带标签，将在题库功能落地后补充。
 */
export interface WeakGroup extends GroupAccuracy {
    /** 排序用的正确率（越低越薄弱） */
    rank: number;
}

/** 按给定分组正确率升序（最薄弱的在前），仅保留有样本的分组 */
export function weakestGroups(groups: GroupAccuracy[], minCount = 2, limit = 5): WeakGroup[] {
    return groups
        .filter((g) => g.count >= minCount)
        .map((g) => ({ ...g, rank: g.accuracy }))
        .sort((a, b) => a.accuracy - b.accuracy)
        .slice(0, limit);
}
