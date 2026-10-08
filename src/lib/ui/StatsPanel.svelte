<script lang="ts">
    import * as Card from "@/lib/components/ui/card";
    import * as Select from "@/lib/components/ui/select";
    import { Skeleton } from "@/lib/components/ui/skeleton";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import {
        accuracyByDifficulty,
        accuracyByTag,
        accuracyByType,
        filterByRange,
        scoreDistribution,
        scoreTrend,
        summarize,
        weakestGroups,
        type RangeDays,
    } from "../quiz/charts";
    import { scorePercent } from "../quiz/stats";
    import { createClock } from "./clock.svelte";
    import { dayKey } from "../quiz/charts";
    import type { HeatmapConfig, QuestionType, ScoreIndexEntry, Difficulty } from "@/types/quiz";
    import DonutChart from "./DonutChart.svelte";
    import Heatmap from "./Heatmap.svelte";
    import LineChart from "./LineChart.svelte";

    let {
        records = [],
        loading = false,
        heatmapConfig = undefined,
        lang = "zh",
        onStartReview = () => {},
        onDayClick,
    }: {
        records?: ScoreIndexEntry[];
        loading?: boolean;
        /** 热力图配色配置；未提供时不渲染热力图 */
        heatmapConfig?: HeatmapConfig;
        lang?: "zh" | "en";
        /** 按知识点开始一次复习；由插件层打开新的答题 Tab */
        onStartReview?: (scope: { tag?: string; type?: QuestionType; difficulty?: Difficulty }) => void;
        /** 点击热力图某天时触发，用于跳转到当天成绩 */
        onDayClick?: (date: string) => void;
    } = $props();

    let range = $state<RangeDays>(30);

    const inRange = $derived(filterByRange(records, range));
    const summary = $derived(summarize(inRange));
    const trend = $derived(scoreTrend(inRange));
    const clock = createClock();

    /** 今天的日期键 */
    const todayKey = $derived(dayKey(clock.now));
    /** 今日交卷次数 */
    const todayQuizCount = $derived(records.filter((r) => dayKey(r.timestamp) === todayKey).length);
    /** 今日已答题目数 */
    const todayQuestions = $derived(
        records.filter((r) => dayKey(r.timestamp) === todayKey).reduce((sum, r) => sum + r.questionCount, 0)
    );

    const byType = $derived(accuracyByType(inRange));
    const byDifficulty = $derived(accuracyByDifficulty(inRange));
    const distribution = $derived(scoreDistribution(inRange));
    const byTag = $derived(accuracyByTag(inRange));
    const weakTypes = $derived(weakestGroups(byType));
    const weakDifficulties = $derived(weakestGroups(byDifficulty));
    /** 知识点排行样本阈值与条数都比其他维度更宽，因为标签基数更大 */
    const weakTags = $derived(weakestGroups(byTag, 2, 8));

    /** 分布直方图的最大值，用于计算柱高比例 */
    const distributionMax = $derived(Math.max(1, ...distribution.map((b) => b.count)));

    /** 难度环形图的数据与配色（成功率与难度档位本身绑定，颜色语义固定） */
    const difficultySlices = $derived(
        byDifficulty.map((group) => ({
            label: t(`diff.${group.key}`),
            value: group.accuracy,
            // 图例原先展示的是「该达标率占三者之和的比例」——这个数没有业务含义，
            // 读者会误当成「该难度占多少题」。改为样本题数，与题型分区口径一致。
            note: t("stats.samples", String(group.count)),
            color:
                group.key === "easy"
                    ? "var(--color-success)"
                    : group.key === "medium"
                      ? "var(--color-warning)"
                      : "var(--color-destructive)",
        }))
    );

    const RANGES: RangeDays[] = [7, 30, 90, 0];

    function rangeLabel(value: RangeDays): string {
        return value === 0 ? t("stats.rangeAll") : t("stats.rangeDays", String(value));
    }

    function pct(value: number): string {
        return `${value.toFixed(0)}%`;
    }

    function typeLabel(type: string): string {
        return t(`type.${type}_short`);
    }
    function difficultyLabel(d: string): string {
        return t(`diff.${d}`);
    }

    /** 达标率对应的语义色，所有图表与列表共用同一口径 */
    function toneClass(accuracy: number): string {
        if (accuracy >= 80) return "bg-success";
        if (accuracy >= 60) return "bg-primary";
        if (accuracy >= 30) return "bg-warning";
        return "bg-destructive";
    }
</script>

<div class="@container flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold">{t("stats.title")}</h3>
        <Select.Root type="single" value={String(range)} onValueChange={(v) => (range = Number(v) as RangeDays)}>
            <Select.Trigger class="h-8 w-32" aria-label={t("stats.range")}>
                {rangeLabel(range)}
            </Select.Trigger>
            <Select.Content>
                {#each RANGES as value (value)}
                    <Select.Item value={String(value)}>{rangeLabel(value)}</Select.Item>
                {/each}
            </Select.Content>
        </Select.Root>
    </div>

    {#if loading}
        <div class="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
            {#each [0, 1, 2, 3] as i (i)}
                <Skeleton class="h-20" />
            {/each}
        </div>
    {:else if records.length === 0}
        <div class="text-muted-foreground py-12 text-center text-sm">{t("stats.empty")}</div>
    {:else if inRange.length === 0}
        <div class="text-muted-foreground py-12 text-center text-sm">{t("stats.emptyRange", rangeLabel(range))}</div>
    {:else}
        <!-- 学习轨迹：热力图属于进度视图，放在统计页比放在设置里更符合直觉 -->
        {#if heatmapConfig}
            <Card.Root>
                <Card.Header>
                    <Card.Title class="text-sm">{t("stats.heatmap")}</Card.Title>
                    <Card.Description>{t("stats.heatmapDesc")}</Card.Description>
                </Card.Header>
                <Card.Content>
                    <Heatmap {records} config={heatmapConfig} {lang} {onDayClick} />
                </Card.Content>
            </Card.Root>
        {/if}

        <!-- 总览 -->
        <div class="grid grid-cols-2 gap-3 @xl:grid-cols-3 @4xl:grid-cols-5">
            {#each [{ label: t("stats.quizCount"), value: String(summary.quizCount), sub: t("stats.questionCount", String(summary.questionCount)) }, { label: t("stats.average"), value: pct(summary.averagePercent), sub: t("stats.best", pct(summary.bestPercent)) }, { label: t("stats.streak"), value: t("stats.days", String(summary.currentStreak)), sub: t("stats.longestStreak", String(summary.longestStreak)) }, { label: t("stats.perQuestion"), value: summary.secondsPerQuestion === null ? "--" : `${summary.secondsPerQuestion.toFixed(0)}s`, sub: t("stats.activeDays", String(summary.activeDays)) }, { label: t("stats.todayProgress"), value: String(todayQuizCount), sub: t("stats.todayDone", String(todayQuestions), "—") }] as item (item.label)}
                <Card.Root>
                    <Card.Content class="flex flex-col gap-0.5 pt-4">
                        <span class="text-xl font-bold">{item.value}</span>
                        <span class="text-muted-foreground text-xs">{item.label}</span>
                        <span class="text-muted-foreground text-2xs">{item.sub}</span>
                    </Card.Content>
                </Card.Root>
            {/each}
        </div>

        <!-- 分数趋势 -->
        <Card.Root>
            <Card.Header>
                <Card.Title class="text-sm">{t("stats.trend")}</Card.Title>
                <Card.Description>{t("stats.trendDesc")}</Card.Description>
            </Card.Header>
            <Card.Content>
                {#if trend.length > 1}
                    <LineChart
                        data={trend}
                        ariaLabel={t("stats.trendAria", String(trend.length), pct(summary.averagePercent))}
                    />
                {:else}
                    <!-- 单点画不出趋势，直接给出数值比画一条直线更清楚 -->
                    <p class="text-muted-foreground py-8 text-center text-sm">
                        {t("stats.trendSingle", pct(trend[0]?.percent ?? 0))}
                    </p>
                {/if}
            </Card.Content>
        </Card.Root>

        <div class="grid grid-cols-1 gap-4 @4xl:grid-cols-2">
            <!-- 题型达标率：用 CSS 条形绘制，天然响应式且跟随主题 -->
            <Card.Root>
                <Card.Header>
                    <Card.Title class="text-sm">{t("stats.byType")}</Card.Title>
                    <Card.Description>{t("stats.byTypeDesc")}</Card.Description>
                </Card.Header>
                <Card.Content class="flex flex-col gap-2">
                    {#each byType as group (group.key)}
                        <div class="flex items-center gap-2">
                            <span class="w-14 shrink-0 text-xs">{typeLabel(group.key)}</span>
                            <!-- 条形本身是装饰：达标率与样本量已作为文本渲染，读屏无需重复播报 -->
                            <span class="bg-muted h-2.5 flex-1 overflow-hidden rounded-full" aria-hidden="true">
                                <span
                                    class={cn("block h-full rounded-full", toneClass(group.accuracy))}
                                    style="width: {Math.max(2, Math.min(100, group.accuracy))}%"
                                ></span>
                            </span>
                            <span class="text-muted-foreground w-20 shrink-0 text-right text-xs">
                                {pct(group.accuracy)} · {t("stats.samples", String(group.count))}
                            </span>
                        </div>
                    {/each}
                </Card.Content>
            </Card.Root>

            <!-- 分数分布 -->
            <Card.Root>
                <Card.Header>
                    <Card.Title class="text-sm">{t("stats.distribution")}</Card.Title>
                    <Card.Description>{t("stats.distributionDesc")}</Card.Description>
                </Card.Header>
                <Card.Content>
                    <div class="flex h-40 items-end justify-between gap-2">
                        {#each distribution as bucket, i (bucket.key)}
                            <div class="flex h-full flex-1 flex-col items-center justify-end gap-1">
                                <span class="text-muted-foreground text-2xs">{bucket.count}</span>
                                <div
                                    class={cn(
                                        "w-full rounded-t",
                                        i === 0 ? "bg-destructive" : i < 3 ? "bg-warning" : "bg-success"
                                    )}
                                    style="height: {Math.max(2, (bucket.count / distributionMax) * 100)}%"
                                    title="{bucket.key}: {bucket.count}"
                                    aria-hidden="true"
                                ></div>
                                <span class="text-muted-foreground text-3xs">{bucket.key}</span>
                            </div>
                        {/each}
                    </div>
                </Card.Content>
            </Card.Root>

            <!-- 难度达标率 -->
            <Card.Root>
                <Card.Header>
                    <Card.Title class="text-sm">{t("stats.byDifficulty")}</Card.Title>
                    <Card.Description>{t("stats.byDifficultyDesc")}</Card.Description>
                </Card.Header>
                <Card.Content>
                    <DonutChart slices={difficultySlices} ariaLabel={t("stats.byDifficultyAria")} />
                </Card.Content>
            </Card.Root>

            <!-- 薄弱环节 -->
            <Card.Root>
                <Card.Header>
                    <Card.Title class="text-sm">{t("stats.weak")}</Card.Title>
                    <Card.Description>{t("stats.weakDesc")}</Card.Description>
                </Card.Header>
                <Card.Content class="flex flex-col gap-3">
                    {#if weakTypes.length === 0 && weakDifficulties.length === 0 && weakTags.length === 0}
                        <p class="text-muted-foreground text-xs">{t("stats.weakEmpty")}</p>
                    {:else}
                        <!-- 三个维度都能直接开一次复习：知识点/题型/难度都是题库的筛选键 -->
                        {#each [{ title: t("stats.weakByTag"), groups: weakTags, label: (key: string) => key, wrap: true, hint: (key: string) => t("stats.reviewTagHint", key), action: (key: string) => onStartReview( { tag: key } ) }, { title: t("stats.weakByType"), groups: weakTypes, label: typeLabel, wrap: false, hint: (key: string) => t("stats.reviewTypeHint", typeLabel(key)), action: (key: string) => onStartReview( { type: key as QuestionType } ) }, { title: t("stats.weakByDifficulty"), groups: weakDifficulties, label: difficultyLabel, wrap: false, hint: (key: string) => t("stats.reviewDifficultyHint", difficultyLabel(key)), action: (key: string) => onStartReview( { difficulty: key as Difficulty } ) }] as section (section.title)}
                            {#if section.groups.length > 0}
                                <div class="flex flex-col gap-1.5">
                                    <span class="text-muted-foreground text-xs font-semibold">{section.title}</span>
                                    {#each section.groups as group (group.key)}
                                        <div class="flex items-center gap-2">
                                            <span
                                                class={cn("w-24 shrink-0 text-xs", section.wrap && "truncate")}
                                                title={section.wrap ? group.key : undefined}
                                                >{section.label(group.key)}</span
                                            >
                                            <span class="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                                                <span
                                                    class={cn("block h-full rounded-full", toneClass(group.accuracy))}
                                                    style="width: {Math.max(2, Math.min(100, group.accuracy))}%"
                                                ></span>
                                            </span>
                                            <span class="text-muted-foreground w-20 shrink-0 text-right text-xs">
                                                {pct(group.accuracy)} · {t("stats.samples", String(group.count))}
                                            </span>
                                            <button
                                                type="button"
                                                class="text-primary shrink-0 text-2xs underline-offset-2 hover:underline"
                                                title={section.hint(group.key)}
                                                onclick={() => section.action(group.key)}
                                            >
                                                {t("stats.review")}
                                            </button>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        {/each}
                        <p class="text-muted-foreground text-2xs">{t("stats.weakNote")}</p>
                    {/if}
                </Card.Content>
            </Card.Root>
        </div>

        <!-- 最近记录速览：为图表提供文本等价物 -->
        <Card.Root>
            <Card.Header>
                <Card.Title class="text-sm">{t("stats.recent")}</Card.Title>
            </Card.Header>
            <Card.Content class="flex flex-col gap-1">
                {#each inRange.slice(0, 5) as record (record.id)}
                    <div class="flex items-center justify-between gap-2 text-xs">
                        <span class="truncate">{record.title}</span>
                        <span class="text-muted-foreground shrink-0">{scorePercent(record).toFixed(0)}%</span>
                    </div>
                {/each}
            </Card.Content>
        </Card.Root>
    {/if}
</div>
