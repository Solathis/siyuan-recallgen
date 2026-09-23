import type { Difficulty, QuestionType, ScoreIndexEntry } from "@/types/quiz";
import { PASS_SCORE, scorePercent } from "./stats";

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

/** 按时间范围过滤（按本地日切分，含当天） */
/** days 为 0 表示不限范围；函数本身接受任意天数，UI 只暴露预置档位 */
export function filterByRange(entries: ScoreIndexEntry[], days: number, now = Date.now()): ScoreIndexEntry[] {
    if (days === 0) return entries;
    const cutoff = new Date(now);
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    return entries.filter((e) => e.timestamp >= cutoff.getTime());
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
        secondsPerQuestion: totalQuestionsWithDuration > 0 ? totalDuration / totalQuestionsWithDuration : null,
    };
}

/** 由有序日期集合计算当前/最长连续天数 */
export function streaks(days: string[], now = Date.now()): { current: number; longest: number } {
    if (days.length === 0) return { current: 0, longest: 0 };

    let longest = 1;
    let run = 1;
    for (let i = 1; i < days.length; i++) {
        const prev = new Date(`${days[i - 1]}T00:00:00`).getTime();
        const cur = new Date(`${days[i]}T00:00:00`).getTime();
        const diffDays = Math.round((cur - prev) / 86_400_000);
        run = diffDays === 1 ? run + 1 : 1;
        longest = Math.max(longest, run);
    }

    // 当前连续：从今天（或昨天，容忍今天还没答题）向前数
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const last = new Date(`${days[days.length - 1]}T00:00:00`).getTime();
    const gapFromToday = Math.round((today.getTime() - last) / 86_400_000);
    if (gapFromToday > 1) return { current: 0, longest };

    let current = 1;
    for (let i = days.length - 1; i > 0; i--) {
        const prev = new Date(`${days[i - 1]}T00:00:00`).getTime();
        const cur = new Date(`${days[i]}T00:00:00`).getTime();
        if (Math.round((cur - prev) / 86_400_000) === 1) current++;
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
        percent: maxScore > 0 ? (score / maxScore) * 100 : 0,
    };
}

/** 按题型统计正确率，按固定顺序输出且只保留有数据的题型 */
export function accuracyByType(entries: ScoreIndexEntry[]): GroupAccuracy[] {
    return TYPE_ORDER.map((type) => accuracyOf(entries, (e) => e.byType[type], type)).filter((g) => g.count > 0);
}

/** 按难度统计正确率 */
export function accuracyByDifficulty(entries: ScoreIndexEntry[]): GroupAccuracy[] {
    return DIFFICULTY_ORDER.map((d) => accuracyOf(entries, (e) => e.byDifficulty[d], d)).filter((g) => g.count > 0);
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

/** 得分率是否达到通过线 */
export function isPass(percent: number): boolean {
    return percent >= PASS_SCORE;
}
