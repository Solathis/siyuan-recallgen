<script lang="ts">
    import { cn } from "@/lib/utils";

    /**
     * 进度条。
     *
     * 两个历史问题都在这里收口：
     * 1. 外层写死 `max-w-md`——放进整宽的答题面板后，进度条只铺到 448px，
     *    右边一大片空白，「作答进度」看着像没画完。现在一律铺满可用宽度，
     *    要限制宽度由调用方在外面套容器。
     * 2. 填充色固定用思源主题色，几十屏看下来没有一处「属于本插件」的视觉线索；
     *    现在默认走自有强调色（紫），需要与思源按钮同色时传 tone="primary"。
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
    const fillTone = $derived(tone === "accent" ? "bg-rg-accent" : "bg-primary");
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

    <div
        class={cn("bg-muted relative w-full overflow-hidden rounded-full", track)}
        role="progressbar"
        aria-label={label || undefined}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : 100}
        aria-valuenow={indeterminate ? undefined : Math.round(pct)}
    >
        {#if indeterminate}
            <div class={cn("rg-indeterminate-bar absolute h-full w-1/3 rounded-full", fillTone)}></div>
        {:else}
            <div
                class={cn("h-full rounded-full transition-[width] duration-300 ease-out", fillTone)}
                style="width: {pct}%"
            ></div>
        {/if}
    </div>
</div>
