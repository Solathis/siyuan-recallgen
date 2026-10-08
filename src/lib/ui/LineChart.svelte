<script lang="ts">
    import { lineGeometry, pickMarkerIndices, ticks, timeAxisLabels } from "@/lib/quiz/chart-geometry";

    /**
     * 得分率折线图（时间轴）。
     *
     * 用 SVG 直接绘制，不依赖图表库：颜色全部由 CSS 变量与 Tailwind 类决定，
     * 明暗主题自动跟随，也没有 canvas 的生命周期与重绘问题。
     *
     * 宽度必须量出来再用，不能只靠 `w-full`：
     * viewBox 写死 640 宽时，SVG 会被按容器宽度等比放大（1440 面板下放大 2.2 倍），
     * 于是 200px 的图变成 440px 高、线宽与刻度文字一起被拉大——
     * 这正是统计页趋势图「高得离谱、字特别大」的原因。
     * 量出真实宽度后缩放比恒为 1，高度与字号都回到设定值。
     */
    let {
        /** 按时间升序的得分序列 */
        data,
        width = 640,
        height = 200,
        ariaLabel = "",
    }: {
        data: { timestamp: number; percent: number }[];
        /** 量不到容器宽度时的兜底（jsdom 下 clientWidth 为 0） */
        width?: number;
        height?: number;
        ariaLabel?: string;
    } = $props();

    let hostEl = $state<HTMLDivElement | null>(null);
    let measured = $state(0);

    $effect(() => {
        const el = hostEl;
        if (!el) return;
        const update = () => (measured = el.clientWidth);
        update();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    });

    /** 实际用于 viewBox 与几何计算的宽度 */
    const viewWidth = $derived(measured > 0 ? measured : width);

    const padding = { top: 12, right: 12, bottom: 24, left: 34 };

    const percents = $derived(data.map((d) => d.percent));
    const geometry = $derived(lineGeometry(percents, viewWidth, height, padding));
    const yTicks = $derived(ticks(100, 4));

    /**
     * 标记点上限：点数很多时逐点画圆既慢又糊成一片，
     * 因此只保留首末与峰谷附近的点；悬停提示也只挂在这些点上。
     */
    const MARKER_LIMIT = 40;
    const markers = $derived(pickMarkerIndices(percents, MARKER_LIMIT));

    const innerHeight = $derived(height - padding.top - padding.bottom);
    const baseline = $derived(padding.top + innerHeight);

    function yOf(value: number): number {
        return padding.top + innerHeight - (value / 100) * innerHeight;
    }

    /**
     * 时间轴刻度：落在真实数据点的横坐标上，并按数据点下标去重
     * （跨度很短时多个刻度会吸到同一个点上，重复标签会撞 key）。
     */
    const xLabels = $derived(
        timeAxisLabels(
            data.map((d) => d.timestamp),
            {
                width: viewWidth,
                paddingLeft: padding.left,
                paddingRight: padding.right,
                format: (ts) => {
                    const date = new Date(ts);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                },
            }
        )
    );

    function fmtDate(ts: number): string {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
</script>

<div bind:this={hostEl} class="w-full">
    <svg viewBox="0 0 {viewWidth} {height}" class="block h-auto w-full" role="img" aria-label={ariaLabel}>
        <!-- 水平网格与 y 轴刻度 -->
        {#each yTicks as tick (tick)}
            <line
                x1={padding.left}
                x2={viewWidth - padding.right}
                y1={yOf(tick)}
                y2={yOf(tick)}
                class="stroke-border"
                stroke-width="1"
                stroke-dasharray={tick === 0 ? "0" : "3 3"}
            />
            <text x={padding.left - 6} y={yOf(tick) + 3} text-anchor="end" class="fill-muted-foreground text-3xs">
                {tick}
            </text>
        {/each}

        {#if geometry.points.length > 0}
            {#if geometry.area}
                <path d={geometry.area} class="fill-primary" opacity="0.12" />
            {/if}
            <path d={geometry.line} class="stroke-primary" stroke-width="2" fill="none" stroke-linejoin="round" />
            {#each markers as index (index)}
                <circle cx={geometry.points[index].x} cy={geometry.points[index].y} r="3" class="fill-primary">
                    <title>{fmtDate(data[index].timestamp)} · {data[index].percent.toFixed(0)}%</title>
                </circle>
            {/each}
        {/if}

        <!-- 时间轴刻度 -->
        {#each xLabels as label (label.index)}
            <text x={label.x} y={baseline + 16} text-anchor="middle" class="fill-muted-foreground text-3xs">
                {label.text}
            </text>
        {/each}
    </svg>
</div>
