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
    import type { ScoreIndexEntry } from "@/types/quiz";
    import EChart from "./EChart.svelte";

    let { records = [], loading = false }: { records?: ScoreIndexEntry[]; loading?: boolean } = $props();

    let range = $state<RangeDays>(30);

    const inRange = $derived(filterByRange(records, range));
    const summary = $derived(summarize(inRange));
    const trend = $derived(scoreTrend(inRange));
    const byType = $derived(accuracyByType(inRange));
    const byDifficulty = $derived(accuracyByDifficulty(inRange));
    const distribution = $derived(scoreDistribution(inRange));
    const byTag = $derived(accuracyByTag(inRange));
    const weakTypes = $derived(weakestGroups(byType));
    const weakDifficulties = $derived(weakestGroups(byDifficulty));
    /** 知识点排行：样本 ≥2 的按正确率升序取前 8 */
    const weakTags = $derived(weakestGroups(byTag, 2, 8));

    /** 时间范围下拉的选项文案由各 range 值拼出 */
    function rangeLabel(value: RangeDays): string {
        return value === 0 ? t("stats.rangeAll") : t("stats.rangeDays", String(value));
    }

    const RANGES: RangeDays[] = [7, 30, 90, 0];

    /** 把百分制得分率格式化为统一小数位 */
    function pct(value: number): string {
        return `${value.toFixed(0)}%`;
    }

    function typeLabel(type: string): string {
        return t(`type.${type}_short`);
    }
    function difficultyLabel(d: string): string {
        return t(`diff.${d}`);
    }
</script>

<div class="flex flex-col gap-4">
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
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {#each [0, 1, 2, 3] as i (i)}
                <Skeleton class="h-20" />
            {/each}
        </div>
    {:else if records.length === 0}
        <div class="text-muted-foreground py-12 text-center text-sm">{t("stats.empty")}</div>
    {:else if inRange.length === 0}
        <div class="text-muted-foreground py-12 text-center text-sm">{t("stats.emptyRange", rangeLabel(range))}</div>
    {:else}
        <!-- 总览 -->
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {#each [{ label: t("stats.quizCount"), value: String(summary.quizCount), sub: t("stats.questionCount", String(summary.questionCount)) }, { label: t("stats.average"), value: pct(summary.averagePercent), sub: t("stats.best", pct(summary.bestPercent)) }, { label: t("stats.streak"), value: t("stats.days", String(summary.currentStreak)), sub: t("stats.longestStreak", String(summary.longestStreak)) }, { label: t("stats.perQuestion"), value: summary.secondsPerQuestion === null ? "--" : `${summary.secondsPerQuestion.toFixed(0)}s`, sub: t("stats.activeDays", String(summary.activeDays)) }] as item (item.label)}
                <Card.Root>
                    <Card.Content class="flex flex-col gap-0.5 pt-4">
                        <span class="text-xl font-bold">{item.value}</span>
                        <span class="text-muted-foreground text-xs">{item.label}</span>
                        <span class="text-muted-foreground text-[11px]">{item.sub}</span>
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
                <EChart
                    height="220px"
                    ariaLabel={t("stats.trendAria", String(trend.length), pct(summary.averagePercent))}
                    build={(c) => ({
                        grid: { left: 40, right: 12, top: 16, bottom: 28 },
                        tooltip: {
                            trigger: "axis",
                            backgroundColor: c.surface,
                            borderColor: c.grid,
                            textStyle: { color: c.text },
                            formatter: (params: { value: [number, number] }[]) => {
                                const point = params[0];
                                const date = new Date(point.value[0]);
                                return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
                                    date.getDate()
                                ).padStart(2, "0")}<br/>${t("stats.score")}: ${point.value[1].toFixed(0)}`;
                            },
                        },
                        xAxis: {
                            type: "time",
                            axisLine: { lineStyle: { color: c.grid } },
                            axisLabel: { color: c.axis, fontSize: 10 },
                            splitLine: { show: false },
                        },
                        yAxis: {
                            type: "value",
                            min: 0,
                            max: 100,
                            axisLabel: { color: c.axis, fontSize: 10, formatter: "{value}%" },
                            splitLine: { lineStyle: { color: c.grid } },
                        },
                        series: [
                            {
                                type: "line",
                                smooth: true,
                                symbolSize: 6,
                                data: trend.map((p) => [p.timestamp, p.percent]),
                                lineStyle: { color: c.primary, width: 2 },
                                itemStyle: { color: c.primary },
                                areaStyle: { color: c.primary, opacity: 0.12 },
                            },
                        ],
                    })}
                />
            </Card.Content>
        </Card.Root>

        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <!-- 题型正确率 -->
            <Card.Root>
                <Card.Header>
                    <Card.Title class="text-sm">{t("stats.byType")}</Card.Title>
                    <Card.Description>{t("stats.byTypeDesc")}</Card.Description>
                </Card.Header>
                <Card.Content>
                    <EChart
                        height="220px"
                        ariaLabel={t("stats.byTypeAria")}
                        build={(c) => ({
                            grid: { left: 72, right: 24, top: 12, bottom: 24 },
                            tooltip: {
                                trigger: "axis",
                                axisPointer: { type: "shadow" },
                                backgroundColor: c.surface,
                                borderColor: c.grid,
                                textStyle: { color: c.text },
                            },
                            xAxis: {
                                type: "value",
                                min: 0,
                                max: 100,
                                axisLabel: { color: c.axis, fontSize: 10, formatter: "{value}%" },
                                splitLine: { lineStyle: { color: c.grid } },
                            },
                            yAxis: {
                                type: "category",
                                data: byType.map((g) => typeLabel(g.key)),
                                axisLabel: { color: c.axis, fontSize: 10 },
                                axisLine: { lineStyle: { color: c.grid } },
                            },
                            series: [
                                {
                                    type: "bar",
                                    barMaxWidth: 16,
                                    data: byType.map((g) => ({
                                        value: Number(g.accuracy.toFixed(1)),
                                        itemStyle: { color: g.accuracy >= 60 ? c.success : c.destructive },
                                    })),
                                    label: {
                                        show: true,
                                        position: "right",
                                        color: c.axis,
                                        fontSize: 10,
                                        formatter: "{c}%",
                                    },
                                },
                            ],
                        })}
                    />
                </Card.Content>
            </Card.Root>

            <!-- 分数分布 -->
            <Card.Root>
                <Card.Header>
                    <Card.Title class="text-sm">{t("stats.distribution")}</Card.Title>
                    <Card.Description>{t("stats.distributionDesc")}</Card.Description>
                </Card.Header>
                <Card.Content>
                    <EChart
                        height="220px"
                        ariaLabel={t("stats.distributionAria")}
                        build={(c) => ({
                            grid: { left: 40, right: 16, top: 12, bottom: 24 },
                            tooltip: {
                                trigger: "axis",
                                axisPointer: { type: "shadow" },
                                backgroundColor: c.surface,
                                borderColor: c.grid,
                                textStyle: { color: c.text },
                            },
                            xAxis: {
                                type: "category",
                                data: distribution.map((b) => b.key),
                                axisLabel: { color: c.axis, fontSize: 10 },
                                axisLine: { lineStyle: { color: c.grid } },
                            },
                            yAxis: {
                                type: "value",
                                minInterval: 1,
                                axisLabel: { color: c.axis, fontSize: 10 },
                                splitLine: { lineStyle: { color: c.grid } },
                            },
                            series: [
                                {
                                    type: "bar",
                                    barMaxWidth: 32,
                                    data: distribution.map((b, i) => ({
                                        value: b.count,
                                        itemStyle: { color: i < 1 ? c.destructive : i < 3 ? c.warning : c.success },
                                    })),
                                },
                            ],
                        })}
                    />
                </Card.Content>
            </Card.Root>

            <!-- 难度正确率 -->
            <Card.Root>
                <Card.Header>
                    <Card.Title class="text-sm">{t("stats.byDifficulty")}</Card.Title>
                    <Card.Description>{t("stats.byDifficultyDesc")}</Card.Description>
                </Card.Header>
                <Card.Content>
                    <EChart
                        height="220px"
                        ariaLabel={t("stats.byDifficultyAria")}
                        build={(c) => ({
                            tooltip: {
                                trigger: "item",
                                backgroundColor: c.surface,
                                borderColor: c.grid,
                                textStyle: { color: c.text },
                            },
                            legend: { bottom: 0, textStyle: { color: c.axis, fontSize: 10 } },
                            series: [
                                {
                                    type: "pie",
                                    radius: ["42%", "68%"],
                                    avoidLabelOverlap: true,
                                    itemStyle: { borderColor: c.surface, borderWidth: 2 },
                                    label: { color: c.text, fontSize: 10, formatter: "{b} {d}%" },
                                    data: byDifficulty.map((g, i) => ({
                                        name: difficultyLabel(g.key),
                                        value: Number(g.accuracy.toFixed(1)),
                                        itemStyle: {
                                            color: [c.success, c.warning, c.destructive][i % 3],
                                        },
                                    })),
                                },
                            ],
                        })}
                    />
                </Card.Content>
            </Card.Root>

            <!-- 薄弱环节 -->
            <Card.Root>
                <Card.Header>
                    <Card.Title class="text-sm">{t("stats.weak")}</Card.Title>
                    <Card.Description>{t("stats.weakDesc")}</Card.Description>
                </Card.Header>
                <Card.Content class="flex flex-col gap-3">
                    {#if weakTags.length > 0}
                        <div class="flex flex-col gap-1.5">
                            <span class="text-muted-foreground text-xs font-semibold">{t("stats.weakByTag")}</span>
                            {#each weakTags as group (group.key)}
                                <div class="flex items-center gap-2">
                                    <span class="w-24 shrink-0 truncate text-xs" title={group.key}>{group.key}</span>
                                    <span class="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                                        <span
                                            class={cn(
                                                "block h-full rounded-full",
                                                group.accuracy >= 60 ? "bg-success" : "bg-destructive"
                                            )}
                                            style="width: {Math.max(2, Math.min(100, group.accuracy))}%"
                                        ></span>
                                    </span>
                                    <span class="text-muted-foreground w-16 shrink-0 text-right text-xs">
                                        {pct(group.accuracy)} · {t("stats.samples", String(group.count))}
                                    </span>
                                </div>
                            {/each}
                        </div>
                    {/if}
                    {#if weakTypes.length === 0 && weakDifficulties.length === 0 && weakTags.length === 0}
                        <p class="text-muted-foreground text-xs">{t("stats.weakEmpty")}</p>
                    {:else}
                        {#if weakTypes.length > 0}
                            <div class="flex flex-col gap-1.5">
                                <span class="text-muted-foreground text-xs font-semibold">{t("stats.weakByType")}</span>
                                {#each weakTypes as group (group.key)}
                                    <div class="flex items-center gap-2">
                                        <span class="w-20 shrink-0 text-xs">{typeLabel(group.key)}</span>
                                        <span class="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                                            <span
                                                class={cn(
                                                    "block h-full rounded-full",
                                                    group.accuracy >= 60 ? "bg-success" : "bg-destructive"
                                                )}
                                                style="width: {Math.max(2, Math.min(100, group.accuracy))}%"
                                            ></span>
                                        </span>
                                        <span class="text-muted-foreground w-16 shrink-0 text-right text-xs">
                                            {pct(group.accuracy)} · {t("stats.samples", String(group.count))}
                                        </span>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                        {#if weakDifficulties.length > 0}
                            <div class="flex flex-col gap-1.5">
                                <span class="text-muted-foreground text-xs font-semibold"
                                    >{t("stats.weakByDifficulty")}</span
                                >
                                {#each weakDifficulties as group (group.key)}
                                    <div class="flex items-center gap-2">
                                        <span class="w-20 shrink-0 text-xs">{difficultyLabel(group.key)}</span>
                                        <span class="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                                            <span
                                                class={cn(
                                                    "block h-full rounded-full",
                                                    group.accuracy >= 60 ? "bg-success" : "bg-destructive"
                                                )}
                                                style="width: {Math.max(2, Math.min(100, group.accuracy))}%"
                                            ></span>
                                        </span>
                                        <span class="text-muted-foreground w-16 shrink-0 text-right text-xs">
                                            {pct(group.accuracy)} · {t("stats.samples", String(group.count))}
                                        </span>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                        <p class="text-muted-foreground text-[11px]">{t("stats.weakNote")}</p>
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
