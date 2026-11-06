<script lang="ts">
    /**
     * 出题「生成中」与判分中的整屏状态。
     *
     * 原先是两张并排的卡：左边进度卡塞了四格统计，最关心的「出到第几题」淹在里面，
     * 各批在跑什么也看不到。这里按阅读顺序重排：正在发生什么（标题、用时）→
     * 收题数与进度 → 步骤与逐批状态 → 最近动态 → 折叠的出题计划。
     * 取到期题目与判分只用前两层，三种进入方式共用同一个外壳。
     */
    import AlertTriangleIcon from "@lucide/svelte/icons/triangle-alert";
    import CheckIcon from "@lucide/svelte/icons/check";
    import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
    import XIcon from "@lucide/svelte/icons/x";
    import type { Snippet } from "svelte";
    import * as Alert from "@/lib/components/ui/alert";
    import { Badge } from "@/lib/components/ui/badge";
    import { Button } from "@/lib/components/ui/button";
    import * as Card from "@/lib/components/ui/card";
    import * as Collapsible from "@/lib/components/ui/collapsible";
    import { Separator } from "@/lib/components/ui/separator";
    import { Spinner } from "@/lib/components/ui/spinner";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import { GEN_STEPS, stepStates, type ActivityEntry } from "../quiz/gen-progress";
    import type { BatchState, GenStats } from "../quiz/generator";
    import { formatClock } from "./duration";
    import ProgressBar from "./ProgressBar.svelte";

    let {
        mode,
        title,
        meta = "",
        status = "",
        elapsed = null,
        progress = null,
        counter = null,
        stats = null,
        activity = [],
        reviewer = false,
        oncancel,
        plan,
    }: {
        /** generate：AI 出题；due：取到期题目；grade：判分与分析 */
        mode: "generate" | "due" | "grade";
        title: string;
        /** 标题下的一行：来源 · 模型 · 题量 */
        meta?: string;
        /** 当前进度的文字说明，作为进度条的无障碍名称 */
        status?: string;
        /** 已用秒数；null 表示不显示用时 */
        elapsed?: number | null;
        /** 0-100；null 表示总量未知（不确定进度条） */
        progress?: number | null;
        /** 大号计数：已收集或已判分 / 总数；null 表示不显示 */
        counter?: { done: number; total: number } | null;
        /** 生成器推送的实时快照，只在 generate 下有意义 */
        stats?: GenStats | null;
        /** 最近动态，最新的在前 */
        activity?: ActivityEntry[];
        /** 是否配置了审题模型：没有就不会走审题与重做，步骤条只剩第一步 */
        reviewer?: boolean;
        /** 不传则不显示取消按钮（判分阶段不提供取消） */
        oncancel?: () => void;
        /** 出题计划，默认折叠在动态下方 */
        plan?: Snippet;
    } = $props();

    let planOpen = $state(false);

    const steps = $derived(reviewer ? GEN_STEPS : GEN_STEPS.slice(0, 1));
    const stepState = $derived(stepStates(stats?.phase ?? "generating"));
    /**
     * 补题轮的差额。目标在补题时仍是总题量，差额由它和已收集数算出；
     * 模型多给题时收集数会超过目标，差额按 0 处理并不再显示。
     */
    const shortfall = $derived(stats?.toppingUp ? Math.max(0, stats.target - stats.collected) : 0);

    /** 首轮的批次按 1、2、3 编号；补题轮的批次标成「+差额」，一眼能看出是在补 */
    const chips = $derived.by(() => {
        let ordinal = 0;
        return (stats?.batchStates ?? []).map((batch) => {
            const label = batch.topUp ? `+${batch.count}` : String(++ordinal);
            const hint = batch.topUp
                ? t("gen.batch.topUpTitle", String(batch.count), stateLabel(batch.state))
                : t("gen.batch.title", label, String(batch.count), stateLabel(batch.state));
            return { ...batch, label, hint };
        });
    });

    function stateLabel(state: BatchState): string {
        return t(`gen.batch.${state}`);
    }

    function chipTone(state: BatchState): string {
        if (state === "done") return "border-success/40 bg-success/10 text-success";
        if (state === "running") return "border-rg-accent-line bg-rg-accent-soft text-rg-accent";
        if (state === "failed") return "border-destructive/40 bg-destructive/10 text-destructive";
        return "text-muted-foreground border-dashed";
    }
</script>

<!--
    只做进场，不做退场：这是整屏状态容器，面板不在前台时 WAAPI 动画会被暂停，
    退场播不完会让「生成中」和下一屏一直叠在一起。
-->
<div class="@container flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-2 py-6">
    <Card.Root class="animate-in fade-in-0 slide-in-from-bottom-1 w-full max-w-4xl duration-200">
        <Card.Header class="gap-1.5">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
                <Spinner class="text-rg-accent size-5 shrink-0" aria-hidden="true" />
                <Card.Title class="min-w-0 flex-1 text-base font-semibold" aria-live="polite">{title}</Card.Title>
                {#if elapsed !== null}
                    <span class="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {t("gen.progress.elapsed")}
                        {formatClock(elapsed)}
                    </span>
                {/if}
                {#if oncancel}
                    <Button variant="outline" size="sm" data-tap class="shrink-0" onclick={oncancel}>
                        {mode === "due" ? t("common.cancel") : t("quiz.cancelGenerate")}
                    </Button>
                {/if}
            </div>
            {#if meta}
                <Card.Description class="truncate pl-8" title={meta}>{meta}</Card.Description>
            {/if}
        </Card.Header>

        <Card.Content
            class={cn(
                "grid grid-cols-1 gap-x-6 gap-y-5",
                mode === "generate" && "@3xl:grid-cols-[minmax(0,1fr)_18rem]"
            )}
        >
            <div class="flex min-w-0 flex-col gap-4">
                {#if counter}
                    <div class="flex items-end justify-between gap-3">
                        <div class="flex flex-col gap-0.5">
                            <span class="text-muted-foreground text-xs">
                                {mode === "grade" ? t("gen.stat.graded") : t("gen.stat.collected")}
                            </span>
                            <span class="text-2xl leading-none font-bold tabular-nums">
                                {counter.done}
                                <span class="text-muted-foreground text-base font-normal">
                                    / {t("result.qCount", String(counter.total))}
                                </span>
                            </span>
                        </div>
                        {#if mode === "grade" && progress !== null}
                            <span class="text-muted-foreground text-sm tabular-nums">{Math.round(progress)}%</span>
                        {/if}
                    </div>
                {/if}
                <ProgressBar value={progress} ariaLabel={status || title} />

                {#if mode === "generate"}
                    <ol class="m-0 flex list-none flex-wrap items-center gap-2 p-0" aria-label={t("gen.stat.phase")}>
                        {#each steps as step, index (step)}
                            {@const current = stepState[step]}
                            <li
                                class="flex items-center gap-1.5"
                                aria-current={current === "active" ? "step" : undefined}
                            >
                                {#if index > 0}
                                    <!-- 连接线跟着它后面那一步走；窄容器里步骤会折行，连接线悬在行首行尾，干脆不画 -->
                                    <Separator class="mr-0.5 hidden data-horizontal:w-6 @md:block" aria-hidden="true" />
                                {/if}
                                <span
                                    class={cn(
                                        "flex size-5 items-center justify-center rounded-full border text-2xs font-semibold tabular-nums",
                                        current === "done" && "border-success/40 bg-success/10 text-success",
                                        current === "active" &&
                                            "border-rg-accent bg-rg-accent text-rg-accent-foreground",
                                        current === "pending" && "text-muted-foreground"
                                    )}
                                >
                                    {#if current === "done"}
                                        <CheckIcon class="size-3" aria-hidden="true" />
                                    {:else}
                                        {index + 1}
                                    {/if}
                                </span>
                                <span
                                    class={cn(
                                        "text-xs",
                                        current === "pending" ? "text-muted-foreground" : "font-medium"
                                    )}>{t(`gen.phase.${step}`)}</span
                                >
                            </li>
                        {/each}
                    </ol>

                    {#if chips.length > 0}
                        <div class="flex flex-wrap items-center gap-1.5">
                            <span class="text-muted-foreground mr-1 text-xs">{t("gen.stat.batch")}</span>
                            {#each chips as chip, index (index)}
                                <Badge
                                    variant="outline"
                                    class={cn("h-6 min-w-8 gap-1 px-1.5 tabular-nums", chipTone(chip.state))}
                                    title={chip.hint}
                                >
                                    {#if chip.state === "done"}
                                        <CheckIcon class="size-3" aria-hidden="true" />
                                    {:else if chip.state === "running"}
                                        <Spinner class="size-3" aria-hidden="true" />
                                    {:else if chip.state === "failed"}
                                        <XIcon class="size-3" aria-hidden="true" />
                                    {/if}
                                    <span aria-hidden="true">{chip.label}</span>
                                    <span class="sr-only">{chip.hint}</span>
                                </Badge>
                            {/each}
                            {#if shortfall > 0}
                                <span class="text-rg-accent ml-1 text-xs">{t("gen.toppingUp", String(shortfall))}</span>
                            {/if}
                        </div>
                    {/if}

                    {#if (stats?.dropped ?? 0) > 0}
                        <p class="text-warning m-0 text-xs">
                            {t("gen.stat.droppedCount", String(stats?.dropped ?? 0))}
                        </p>
                    {/if}
                    {#if stats?.note}
                        <Alert.Root class="border-warning/40 text-warning">
                            <AlertTriangleIcon aria-hidden="true" />
                            <Alert.Description class="text-warning text-xs">{stats.note}</Alert.Description>
                        </Alert.Root>
                    {/if}
                {/if}
            </div>

            {#if mode === "generate"}
                <div
                    class="flex min-w-0 flex-col gap-3 border-t pt-4 @3xl:border-t-0 @3xl:border-l @3xl:pt-0 @3xl:pl-6"
                >
                    <h3 class="text-muted-foreground m-0 text-xs font-semibold">{t("gen.activity.title")}</h3>
                    <div role="log" aria-live="polite" aria-label={t("gen.activity.title")}>
                        <ol class="m-0 flex list-none flex-col gap-2 p-0">
                            {#each activity as entry (entry)}
                                <li class="animate-in fade-in-0 slide-in-from-top-1 flex gap-2 text-xs duration-200">
                                    <span class="text-muted-foreground min-w-9 shrink-0 tabular-nums">
                                        {formatClock(entry.at)}
                                    </span>
                                    <span class="min-w-0 break-words">{entry.text}</span>
                                </li>
                            {:else}
                                <li class="text-muted-foreground text-xs">{t("gen.activity.empty")}</li>
                            {/each}
                        </ol>
                    </div>

                    {#if plan}
                        <Collapsible.Root open={planOpen} onOpenChange={(v) => (planOpen = v)}>
                            <Collapsible.Trigger
                                data-tap
                                class="text-muted-foreground flex w-full items-center gap-1.5 py-1 text-left text-xs font-medium"
                            >
                                <ChevronDownIcon
                                    class={cn("size-3.5 shrink-0 transition-transform", planOpen && "rotate-180")}
                                    aria-hidden="true"
                                />
                                {t("gen.plan.title")}
                            </Collapsible.Trigger>
                            <Collapsible.Content class="pt-2">
                                {@render plan()}
                            </Collapsible.Content>
                        </Collapsible.Root>
                    {/if}
                </div>
            {/if}
        </Card.Content>
    </Card.Root>
</div>
