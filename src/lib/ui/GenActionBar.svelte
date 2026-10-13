<script lang="ts">
    import type { Snippet } from "svelte";
    import { Button } from "@/lib/components/ui/button";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";

    /**
     * 出题两个入口共用的吸底操作栏。
     *
     * 原先「粘贴材料」与「按日期」两套 footer 各写各的，宽度、按钮顺序、
     * 提示位置都不一样；同一个动作出现两种排版会让人不确定按哪个。
     * 左边只放状态提示，右边固定为〔次要动作…〕〔取消〕〔主操作〕。
     */
    let {
        hint = "",
        hintTone = "muted",
        primaryLabel,
        onprimary,
        primaryDisabled = false,
        cancelLabel = t("common.cancel"),
        oncancel = undefined,
        extra = undefined,
        class: className,
    }: {
        /** 左侧状态提示：校验结果、配置缺失原因等 */
        hint?: string;
        hintTone?: "muted" | "warning" | "destructive";
        primaryLabel: string;
        onprimary: () => void;
        primaryDisabled?: boolean;
        /** 传 undefined 就不渲染取消按钮 */
        cancelLabel?: string;
        oncancel?: (() => void) | undefined;
        /** 主操作之前的次要按钮（如「清空」） */
        extra?: Snippet;
        class?: string;
    } = $props();

    const toneClass = {
        muted: "text-muted-foreground",
        warning: "text-warning",
        destructive: "text-destructive",
    };
</script>

<div
    class={cn(
        "border-border bg-background/95 rg-safe-bottom flex shrink-0 items-center justify-between gap-2 border-t px-2 py-2",
        className
    )}
>
    <p
        class={cn("min-w-0 flex-1 truncate text-xs tabular-nums", toneClass[hintTone])}
        role={hintTone === "destructive" ? "alert" : "status"}
    >
        {hint}
    </p>
    <div class="flex shrink-0 items-center gap-1.5">
        {#if extra}
            {@render extra()}
        {/if}
        {#if oncancel}
            <Button variant="ghost" size="sm" data-tap onclick={oncancel}>{cancelLabel}</Button>
        {/if}
        <Button size="sm" data-tap disabled={primaryDisabled} onclick={onprimary}>{primaryLabel}</Button>
    </div>
</div>
