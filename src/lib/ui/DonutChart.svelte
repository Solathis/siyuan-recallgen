<script lang="ts">
    import { donutArcs } from "@/lib/quiz/chart-geometry";

    /**
     * 环形图：用 SVG 弧段绘制，配色由传入的 CSS 变量决定。
     *
     * 颜色走 CSS 变量而不是 Tailwind 类，是因为 Tailwind 只能生成源码里字面出现过的类，
     * 动态拼出的 `fill-x` / `bg-x` 不会被生成（此处需要同一颜色同时用于填充与图例色块）。
     */
    let {
        slices,
        size = 180,
        thickness = 22,
        ariaLabel = "",
    }: {
        /** note 是可选的补充说明（例如样本量），显示在数值右侧的括号里 */
        slices: { label: string; value: number; color: string; note?: string }[];
        size?: number;
        thickness?: number;
        ariaLabel?: string;
    } = $props();

    // 尺寸来自 props，必须用派生值，写成普通常量在 props 变化时不会更新
    const center = $derived(size / 2);
    const outer = $derived(center - 2);
    const inner = $derived(outer - thickness);

    /** 只保留正值切片：与 donutArcs 的过滤保持一致，下标才能对上 */
    const nonZero = $derived(slices.filter((s) => Number.isFinite(s.value) && s.value > 0));
    const arcs = $derived(
        donutArcs(
            slices.map((s) => s.value),
            { cx: center, cy: center, inner, outer }
        )
    );
</script>

<div class="flex flex-wrap items-center gap-4">
    <svg viewBox="0 0 {size} {size}" style="width: {size}px; height: {size}px" role="img" aria-label={ariaLabel}>
        {#if arcs.length === 0}
            <!-- 无数据时画一个空心环，避免整块区域空着 -->
            <circle
                cx={center}
                cy={center}
                r={(outer + inner) / 2}
                stroke-width={thickness}
                fill="none"
                style="stroke: var(--color-muted)"
            />
        {:else}
            {#each arcs as arc, i (i)}
                {@const slice = nonZero[i]}
                <path d={arc.path} style="fill: {slice.color}">
                    <title>{slice.label} · {slice.value.toFixed(0)}%</title>
                </path>
            {/each}
        {/if}
    </svg>

    <!-- 图例：同时承担「文本等价物」的职责，读屏与色盲用户都能读取数值 -->
    <ul class="flex flex-col gap-1 text-xs">
        {#each slices as slice (slice.label)}
            <li class="flex items-center gap-2">
                <span class="size-2.5 shrink-0 rounded-full" style="background: {slice.color}"></span>
                <span>{slice.label}</span>
                <span class="text-muted-foreground">
                    {slice.value.toFixed(0)}%{#if slice.note}（{slice.note}）{/if}
                </span>
            </li>
        {/each}
    </ul>
</div>
