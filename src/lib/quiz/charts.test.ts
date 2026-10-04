import { describe, expect, it } from "vitest";
import type { ScoreIndexEntry } from "@/types/quiz";
import { isSafeCssColor } from "@/types/quiz";
import { scorePercent } from "./stats";
import {
    accuracyByDifficulty,
    accuracyByTag,
    accuracyByType,
    dayKey,
    filterByRange,
    scoreDistribution,
    scoreTrend,
    streaks,
    summarize,
    weakestGroups,
} from "./charts";

/** 构造一条成绩索引记录；percent 为得分率 */
function entry(timestamp: number, percent: number, over: Partial<ScoreIndexEntry> = {}): ScoreIndexEntry {
    const maxScore = 100;
    return {
        id: `s-${timestamp}`,
        quizId: `quiz-${timestamp}`,
        title: "标题",
        timestamp,
        totalScore: percent,
        maxScore,
        questionCount: 4,
        passedCount: 2,
        unanswered: 0,
        duration: 80,
        byType: {},
        byDifficulty: {},
        byTag: {},
        hasAnalysis: false,
        ...over,
    };
}

/** 本地当天 0 点的时间戳偏移 n 天 */
function dayAgo(n: number, base = new Date(2026, 8, 23, 12, 0, 0)): number {
    const d = new Date(base);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d.getTime();
}

const NOW = dayAgo(0);

describe("dayKey", () => {
    it("按本地时间生成 YYYY-MM-DD", () => {
        expect(dayKey(new Date(2026, 8, 23, 0, 30).getTime())).toBe("2026-09-23");
        expect(dayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe("2026-01-05");
    });
});

describe("filterByRange", () => {
    const entries = [entry(dayAgo(0), 80), entry(dayAgo(3), 70), entry(dayAgo(10), 60), entry(dayAgo(40), 50)];

    it("days=0 返回全部", () => {
        expect(filterByRange(entries, 0, NOW)).toHaveLength(4);
    });

    it("近 7 天包含今天与 6 天前，不含 10 天前", () => {
        const result = filterByRange(entries, 7, NOW);
        expect(result.map((e) => e.timestamp)).toEqual([dayAgo(0), dayAgo(3)]);
    });

    it("近 30 天包含 10 天前但不含 40 天前", () => {
        expect(filterByRange(entries, 30, NOW)).toHaveLength(3);
    });

    it("按本地日边界切分，而不是按小时数", () => {
        // 昨天 23:30 在「近 2 天」范围内（今天是第 1 天，昨天是第 2 天）
        const late = new Date(dayAgo(1));
        late.setHours(23, 30, 0, 0);
        expect(filterByRange([entry(late.getTime(), 80)], 2, NOW)).toHaveLength(1);
    });
});

describe("streaks", () => {
    it("空列表返回 0", () => {
        expect(streaks([], NOW)).toEqual({ current: 0, longest: 0 });
    });

    it("连续三天计算为 3", () => {
        const days = [dayKey(dayAgo(2)), dayKey(dayAgo(1)), dayKey(dayAgo(0))];
        expect(streaks(days, NOW)).toEqual({ current: 3, longest: 3 });
    });

    it("中断后重新开始，最长连续记录保留", () => {
        const days = [
            dayKey(dayAgo(7)),
            dayKey(dayAgo(6)),
            dayKey(dayAgo(5)),
            dayKey(dayAgo(4)),
            dayKey(dayAgo(1)),
            dayKey(dayAgo(0)),
        ];
        expect(streaks(days, NOW)).toEqual({ current: 2, longest: 4 });
    });

    it("今天还没答题但昨天答过，当前连续仍保留", () => {
        const days = [dayKey(dayAgo(2)), dayKey(dayAgo(1))];
        const result = streaks(days, NOW);
        expect(result.current).toBe(2);
    });

    it("超过一天未答题则当前连续归零", () => {
        const days = [dayKey(dayAgo(3)), dayKey(dayAgo(2))];
        expect(streaks(days, NOW).current).toBe(0);
    });
});

describe("summarize", () => {
    it("空数据返回全零，且不返回假的每题耗时", () => {
        const result = summarize([], NOW);
        expect(result).toMatchObject({ quizCount: 0, averagePercent: 0, secondsPerQuestion: null });
    });

    it("统计次数、平均分与最高分", () => {
        const result = summarize([entry(dayAgo(0), 80), entry(dayAgo(1), 60)], NOW);
        expect(result.quizCount).toBe(2);
        expect(result.questionCount).toBe(8);
        expect(result.averagePercent).toBe(70);
        expect(result.bestPercent).toBe(80);
    });

    it("统计活跃天数与连续天数", () => {
        const result = summarize([entry(dayAgo(0), 80), entry(dayAgo(1), 60), entry(dayAgo(5), 70)], NOW);
        expect(result.activeDays).toBe(3);
        expect(result.currentStreak).toBe(2);
    });

    it("同一天多条记录只算一个活跃日", () => {
        const result = summarize([entry(dayAgo(0), 80), entry(dayAgo(0) + 3600_000, 60)], NOW);
        expect(result.activeDays).toBe(1);
    });

    it("每题平均耗时只统计有耗时的记录", () => {
        const withDuration = entry(dayAgo(0), 80, { duration: 120, questionCount: 4 });
        const without = entry(dayAgo(1), 80, { duration: 0, questionCount: 4 });
        expect(summarize([withDuration, without], NOW).secondsPerQuestion).toBe(30);
    });

    it("全部记录都没有耗时时返回 null 而不是 0", () => {
        expect(summarize([entry(dayAgo(0), 80, { duration: undefined })], NOW).secondsPerQuestion).toBeNull();
    });
});

describe("scoreTrend", () => {
    it("按时间升序输出得分率", () => {
        const trend = scoreTrend([entry(dayAgo(0), 80), entry(dayAgo(2), 60), entry(dayAgo(1), 70)]);
        expect(trend.map((p) => p.percent)).toEqual([60, 70, 80]);
    });

    it("不修改入参数组顺序", () => {
        const input = [entry(dayAgo(0), 80), entry(dayAgo(2), 60)];
        scoreTrend(input);
        expect(input[0].timestamp).toBeGreaterThan(input[1].timestamp);
    });
});

describe("accuracyByType / accuracyByDifficulty", () => {
    const withType = entry(dayAgo(0), 75, {
        byType: {
            single_choice: { count: 2, passed: 2, score: 200, maxScore: 200 },
            fill_blank: { count: 2, passed: 0, score: 60, maxScore: 200 },
        },
        byDifficulty: { easy: { count: 2, passed: 2, score: 200, maxScore: 200 } },
    });

    it("按固定题型顺序输出且只保留有样本的题型", () => {
        const groups = accuracyByType([withType]);
        expect(groups.map((g) => g.key)).toEqual(["single_choice", "fill_blank"]);
    });

    it("正确率与平均得分率分别计算", () => {
        const blank = accuracyByType([withType]).find((g) => g.key === "fill_blank")!;
        expect(blank.accuracy).toBe(0);
        expect(blank.percent).toBe(30);
    });

    it("多份记录累加同一题型", () => {
        const second = entry(dayAgo(1), 50, {
            byType: { single_choice: { count: 2, passed: 1, score: 100, maxScore: 200 } },
        });
        const sc = accuracyByType([withType, second]).find((g) => g.key === "single_choice")!;
        expect(sc.count).toBe(4);
        expect(sc.accuracy).toBe(75);
    });

    it("难度顺序为 easy/medium/hard", () => {
        const groups = accuracyByDifficulty([
            entry(dayAgo(0), 50, {
                byDifficulty: {
                    hard: { count: 1, passed: 0, score: 0, maxScore: 100 },
                    easy: { count: 1, passed: 1, score: 100, maxScore: 100 },
                    medium: { count: 1, passed: 0, score: 40, maxScore: 100 },
                },
            }),
        ]);
        expect(groups.map((g) => g.key)).toEqual(["easy", "medium", "hard"]);
    });

    it("无分组数据时返回空数组", () => {
        expect(accuracyByType([entry(dayAgo(0), 80)])).toEqual([]);
    });
});

describe("scoreDistribution", () => {
    it("按五个区间分桶", () => {
        const buckets = scoreDistribution([
            entry(dayAgo(0), 95),
            entry(dayAgo(1), 85),
            entry(dayAgo(2), 75),
            entry(dayAgo(3), 65),
            entry(dayAgo(4), 30),
            entry(dayAgo(5), 59),
            entry(dayAgo(6), 100),
        ]);
        expect(buckets.map((b) => b.key)).toEqual(["0-59", "60-69", "70-79", "80-89", "90-100"]);
        expect(buckets.map((b) => b.count)).toEqual([2, 1, 1, 1, 2]);
    });

    it("区间边界归属明确：59 落在最低桶，100 落在最高桶", () => {
        expect(scoreDistribution([entry(dayAgo(0), 59)])[0].count).toBe(1);
        expect(scoreDistribution([entry(dayAgo(0), 100)])[4].count).toBe(1);
    });

    it("空数据每桶为 0", () => {
        expect(scoreDistribution([]).every((b) => b.count === 0)).toBe(true);
    });
});

describe("weakestGroups", () => {
    const groups = [
        { key: "a", count: 4, passed: 4, accuracy: 100, percent: 100 },
        { key: "b", count: 4, passed: 1, accuracy: 25, percent: 30 },
        { key: "c", count: 1, passed: 0, accuracy: 0, percent: 10 },
    ];

    it("按正确率升序，最薄弱的在前", () => {
        expect(weakestGroups(groups).map((g) => g.key)).toEqual(["b", "a"]);
    });

    it("样本量不足的分组被排除，避免小样本得出极端结论", () => {
        expect(weakestGroups(groups).map((g) => g.key)).not.toContain("c");
    });

    it("minCount 可调整", () => {
        expect(weakestGroups(groups, 1).map((g) => g.key)).toEqual(["c", "b", "a"]);
    });

    it("limit 限制返回条数", () => {
        expect(weakestGroups(groups, 1, 2)).toHaveLength(2);
    });

    it("空输入返回空数组", () => {
        expect(weakestGroups([])).toEqual([]);
    });
});

describe("accuracyByTag", () => {
    const withTags = (byTag: ScoreIndexEntry["byTag"]) => entry(dayAgo(0), 75, { byTag });

    it("按标签输出正确率，样本多的在前", () => {
        const groups = accuracyByTag([
            withTags({
                "知识点 A": { count: 4, passed: 3, score: 300, maxScore: 400 },
                "知识点 B": { count: 2, passed: 0, score: 20, maxScore: 200 },
            }),
        ]);
        expect(groups.map((g) => g.key)).toEqual(["知识点 A", "知识点 B"]);
        expect(groups[0].accuracy).toBe(75);
        expect(groups[1].accuracy).toBe(0);
    });

    it("跨记录累加同一标签", () => {
        const groups = accuracyByTag([
            withTags({ X: { count: 2, passed: 2, score: 200, maxScore: 200 } }),
            withTags({ X: { count: 2, passed: 0, score: 0, maxScore: 200 } }),
        ]);
        expect(groups[0]).toMatchObject({ key: "X", count: 4, accuracy: 50 });
    });

    it("没有标签时返回空数组（旧记录兼容）", () => {
        expect(accuracyByTag([entry(dayAgo(0), 80)])).toEqual([]);
    });

    it("byTag 缺失时不抛错", () => {
        const legacy = { ...entry(dayAgo(0), 80), byTag: undefined } as unknown as ScoreIndexEntry;
        expect(() => accuracyByTag([legacy])).not.toThrow();
    });

    it("空输入返回空数组", () => {
        expect(accuracyByTag([])).toEqual([]);
    });
});

describe("统计容错（导入的脏数据不应让统计页崩掉）", () => {
    const legacy = { id: "s-legacy", timestamp: NOW, totalScore: 80, maxScore: 100, questionCount: 5 } as never;

    it("缺少 byType / byDifficulty 聚合的旧记录不会抛错", () => {
        expect(() => accuracyByType([legacy])).not.toThrow();
        expect(() => accuracyByDifficulty([legacy])).not.toThrow();
        expect(accuracyByType([legacy])).toEqual([]);
        expect(accuracyByDifficulty([legacy])).toEqual([]);
    });

    it("maxScore 为 0 / 负数 / NaN 时百分比为 0 而不是 NaN", () => {
        expect(scorePercent({ totalScore: 10, maxScore: 0 })).toBe(0);
        expect(scorePercent({ totalScore: 10, maxScore: -5 })).toBe(0);
        expect(scorePercent({ totalScore: 10, maxScore: NaN })).toBe(0);
    });

    it("未来时间戳不会留在任何范围内", () => {
        const future = {
            id: "s-future",
            timestamp: NOW + 30 * 24 * 3600 * 1000,
            totalScore: 100,
            maxScore: 100,
            questionCount: 1,
        } as never;
        expect(filterByRange([future], 7, NOW)).toHaveLength(0);
        expect(filterByRange([future], 0, NOW)).toHaveLength(0);
    });

    it("负数天数按不限范围处理，而不是把 cutoff 推到未来", () => {
        const past = { id: "s-past", timestamp: NOW - 40 * 24 * 3600 * 1000 } as never;
        // 负数与 0 一样视为不限下界，但未来记录仍被排除
        expect(filterByRange([past], -5, NOW)).toHaveLength(1);
        expect(filterByRange([past], 0, NOW)).toHaveLength(1);
    });
});

describe("isSafeCssColor", () => {
    it("接受常见颜色写法", () => {
        for (const color of ["#fff", "#ffffff", "#ffffffcc", "rgb(1,2,3)", "rgba(1,2,3,.5)", "hsl(120, 50%, 50%)"]) {
            expect(isSafeCssColor(color), color).toBe(true);
        }
    });

    it("接受思源主题变量", () => {
        expect(isSafeCssColor("var(--b3-card-success-color)")).toBe(true);
    });

    it("拒绝可注入额外 CSS 声明的写法", () => {
        for (const color of [
            "red;background-image:url(https://evil.example/x)",
            "}body{display:none",
            "url(https://evil.example/x)",
            "expression(alert(1))",
            "#fff /* 注释 */",
        ]) {
            expect(isSafeCssColor(color), color).toBe(false);
        }
    });

    it("拒绝空串、非字符串与超长输入", () => {
        expect(isSafeCssColor("")).toBe(false);
        expect(isSafeCssColor("   ")).toBe(false);
        expect(isSafeCssColor(null)).toBe(false);
        expect(isSafeCssColor(123)).toBe(false);
        expect(isSafeCssColor("#" + "a".repeat(80))).toBe(false);
    });
});
