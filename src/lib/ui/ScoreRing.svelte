<script lang="ts">
    import type { Snippet } from "svelte";
    import { cn } from "@/lib/utils";
    import { PASS_SCORE } from "@/types/quiz";

    /**
     * 得分环。
     *
     * 替换结果页顶上那三块并排大数字：数字铺开后没有主次，
     * 一眼看不到「这次过没过」。环给出的是一个可比较的量（占比），
     * 达标与否直接用颜色与徽标说清，数字退居环内。
     *
     * 尺寸走 size（px）而不是工具类：环要嵌进不同位置，宽高由调用方定，
     * 用 rem 工具类会与相邻的文本尺寸耦合。
     */
    let {
        value,
        max = 100,
        pass = PASS_SCORE,
        label = "",
        size = 148,
        children,
    }: {
        /** 得分 */
        value: number;
        max?: number;
        /** 达标线（百分比） */
        pass?: number;
        /** 环内数字下方的说明文字 */
        label?: string;
        size?: number;
        children?: Snippet;
    } = $props();

    /** 半径与线宽按 viewBox 走，实际大小由外层 size 决定，缩放不会改变线宽比例 */
    const VIEW = 120;
    const STROKE = 10;
    const RADIUS = (VIEW - STROKE) / 2;
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

    const pct = $derived(max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0);
    const passed = $derived(pct >= pass);
    const offset = $derived(CIRCUMFERENCE * (1 - pct / 100));

    const ringColor = $derived(passed ? "var(--b3-card-success-color, #1e7b34)" : "var(--b3-theme-error, #d23f31)");
</script>

<div class="relative shrink-0" style="width: {size}px; height: {size}px">
    <svg
        viewBox="0 0 {VIEW} {VIEW}"
        class="size-full"
        role="img"
        aria-label={`${Math.round(pct)}%`}
        preserveAspectRatio="xMidYMid meet"
    >
        <circle
            cx={VIEW / 2}
            cy={VIEW / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--b3-border-color)"
            stroke-width={STROKE}
        />
        <circle
            cx={VIEW / 2}
            cy={VIEW / 2}
            r={RADIUS}
            fill="none"
            stroke={ringColor}
            stroke-width={STROKE}
            stroke-linecap="round"
            stroke-dasharray={CIRCUMFERENCE}
            stroke-dashoffset={offset}
            transform={`rotate(-90 ${VIEW / 2} ${VIEW / 2})`}
            class="transition-[stroke-dashoffset] duration-500 ease-out"
        />
    </svg>

    <!-- 环内内容用绝对定位压上去：正文排版交给 HTML，比在 SVG 里排文字可控得多 -->
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        {#if children}
            {@render children()}
        {:else}
            <span
                class={cn(
                    "text-3xl leading-none font-semibold tabular-nums",
                    passed ? "text-success" : "text-destructive"
                )}
            >
                {Math.round(pct)}
            </span>
            {#if label}
                <span class="text-muted-foreground text-2xs">{label}</span>
            {/if}
        {/if}
    </div>
</div>
