<script lang="ts">
    import { Progress } from "@/lib/components/ui/progress";
    import { Skeleton } from "@/lib/components/ui/skeleton";
    import { cn } from "@/lib/utils";

    /**
     * 进度条（shadcn Progress 的薄封装）。
     *
     * 两件事在这里收口：
     * 1. 外层原先是写死的 max-w-md——放进整宽的答题面板后进度条只铺到 448px，
     *    右侧半屏空白，看着像没画完。现在一律铺满，要限制宽度由调用方在外面套容器。
     * 2. 填充色原先固定用思源主题色，几十屏看下来没有一处「属于本插件」的视觉线索；
     *    现在默认走自有强调色（紫），需要与思源按钮同色时传 tone="primary"。
     *
     * 确定值走 shadcn 的 Progress；只有「总量未知」那一种情形是自绘的——
     * Progress 的指示条由 value 定位，表达不了「一直在跑但不知道到哪」。
     */
    let {
        value = null,
        label = "",
        size = "md",
        tone = "accent",
        showValue = false,
    }: {
        /** null 表示总量未知，用无尽滑动动画 */
        value?: number | null;
        label?: string;
        size?: "xs" | "sm" | "md";
        /** accent：自有强调色；primary：思源主题色 */
        tone?: "accent" | "primary";
        /** 行尾是否显示百分比 */
        showValue?: boolean;
    } = $props();

    const indeterminate = $derived(value === null);
    const pct = $derived(indeterminate ? 0 : Math.max(0, Math.min(100, value as number)));
    const track = $derived(size === "xs" ? "h-1" : size === "sm" ? "h-1.5" : "h-2");
    /*
     * 指示条的颜色靠覆盖 Progress 内部 data-slot="progress-indicator" 的 bg-primary 实现。
     * 用任意值变体而不是改 shadcn 组件本体：组件是 CLI 生成的、将来还会再生成，
     * 改动会被覆盖掉。
     */
    const toneClass = $derived(tone === "accent" ? "[&>[data-slot=progress-indicator]]:bg-rg-accent" : undefined);
    const hasHead = $derived(!!label || (showValue && !indeterminate));
</script>

<div class="flex w-full flex-col gap-1.5">
    {#if hasHead}
        <div class="flex items-baseline justify-between gap-2">
            {#if label}
                <span class="text-muted-foreground text-xs" aria-live="polite">{label}</span>
            {/if}
            {#if showValue && !indeterminate}
                <span class="text-muted-foreground shrink-0 text-xs tabular-nums">{Math.round(pct)}%</span>
            {/if}
        </div>
    {/if}

    {#if indeterminate}
        <!--
            总量未知时用 Skeleton：shadcn 的 Progress 指示条由 value 定位，
            表达不了「一直在跑但不知道到哪」，而 Skeleton 的脉冲本就是「进行中」的语义。
        -->
        <Skeleton class={cn("w-full rounded-full", track)} aria-label={label || undefined} />
    {:else}
        <Progress {value} class={cn(track, toneClass)} aria-label={label || undefined} />
    {/if}
</div>
