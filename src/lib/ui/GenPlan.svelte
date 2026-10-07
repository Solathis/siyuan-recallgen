<script lang="ts">
    import { Badge } from "@/lib/components/ui/badge";
    import { t } from "../i18n";
    import type { DifficultyDistribution, QuestionType } from "@/types/quiz";

    /**
     * 出题计划信息面板。
     *
     * 生成前用户只能看到「题型标签 + 题量」，模型、批次、结构化输出这些
     * 真正决定成败的信息（尤其是「为什么老是解析失败」）都看不到；
     * 这里把它们集中展示，生成中与生成前共用同一份信息。
     */
    let {
        sourceTitle,
        chars = 0,
        difficulty,
        types = [],
        batches = 1,
        modelName = "",
        protocol = "",
        structured = false,
        reviewer = null,
    }: {
        sourceTitle: string;
        chars?: number;
        difficulty: DifficultyDistribution;
        types?: QuestionType[];
        batches?: number;
        modelName?: string;
        protocol?: string;
        structured?: boolean;
        /** 审题模型名；null 表示没配审题模型（不会走审题循环） */
        reviewer?: string | null;
    } = $props();

    const total = $derived(Math.max(1, difficulty.easy + difficulty.medium + difficulty.hard));
    const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
    const rows = $derived([
        { key: "easy" as const, value: difficulty.easy, cls: "bg-success" },
        { key: "medium" as const, value: difficulty.medium, cls: "bg-warning" },
        { key: "hard" as const, value: difficulty.hard, cls: "bg-destructive" },
    ]);
</script>

<div class="bg-muted/40 flex flex-col gap-2.5 rounded-md border p-3">
    <div class="flex items-center justify-between gap-2">
        <span class="text-muted-foreground text-2xs font-semibold tracking-wide uppercase">
            {t("gen.plan.title")}
        </span>
        <span class="text-muted-foreground text-2xs">{t("gen.plan.editHint")}</span>
    </div>

    <!-- 来源与规模 -->
    <div class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs sm:grid-cols-3">
        <div class="col-span-2 flex min-w-0 flex-col gap-0.5 sm:col-span-1">
            <span class="text-muted-foreground">{t("gen.plan.source")}</span>
            <span class="truncate font-medium" title={sourceTitle}>{sourceTitle}</span>
        </div>
        {#if chars > 0}
            <div class="flex flex-col gap-0.5">
                <span class="text-muted-foreground">{t("gen.plan.charsLabel")}</span>
                <span class="font-medium">{t("gen.plan.chars", chars.toLocaleString())}</span>
            </div>
        {/if}
        <div class="flex flex-col gap-0.5">
            <span class="text-muted-foreground">{t("gen.plan.total")}</span>
            <span class="font-medium">{difficulty.total}</span>
        </div>
        <div class="flex flex-col gap-0.5">
            <span class="text-muted-foreground">{t("gen.plan.batches")}</span>
            <span class="font-medium">{t("gen.plan.batchesValue", String(batches))}</span>
        </div>
    </div>

    <!-- 题型 -->
    <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-xs">{t("gen.plan.types")}</span>
        <div class="flex flex-wrap gap-1.5">
            {#each types as type (type)}
                <Badge variant="secondary" class="text-2xs">{t(`type.${type}_short`)}</Badge>
            {/each}
        </div>
    </div>

    <!-- 难度分布：用占比条代替一串数字，比例一眼可见 -->
    <div class="flex flex-col gap-1">
        <span class="text-muted-foreground text-xs">{t("gen.plan.difficulty")}</span>
        <div class="bg-border flex h-1.5 w-full overflow-hidden rounded-full">
            {#each rows as row (row.key)}
                <div class={row.cls} style={`width:${pct(row.value)}`}></div>
            {/each}
        </div>
        <div class="text-muted-foreground flex flex-wrap gap-x-3 text-2xs">
            {#each rows as row (row.key)}
                <span class="flex items-center gap-1">
                    <span class={`inline-block size-1.5 rounded-full ${row.cls}`}></span>
                    {t(`quiz.config${row.key[0].toUpperCase()}${row.key.slice(1)}`, String(row.value))}
                </span>
            {/each}
        </div>
    </div>

    <!-- 模型与开关：解析失败时最先要看的几项 -->
    <div class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-2xs">
        <span>
            {t("gen.plan.model")}：<span class="text-foreground font-medium">{modelName || "—"}</span>
            {#if protocol}<span class="text-muted-foreground">（{protocol}）</span>{/if}
        </span>
        <span>
            {t("gen.plan.structured")}：<span class="text-foreground font-medium"
                >{structured ? t("gen.state.on") : t("gen.state.off")}</span
            >
        </span>
        <span>
            {t("gen.plan.review")}：<span class="text-foreground font-medium"
                >{reviewer ?? t("gen.state.noReviewer")}</span
            >
        </span>
    </div>
</div>
