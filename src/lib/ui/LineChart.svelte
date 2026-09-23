<script lang="ts">
    import { lineGeometry, pickMarkerIndices, ticks, timeTicks } from "@/lib/quiz/chart-geometry";

    /**
     * 得分率折线图（时间轴）。
     *
     * 用 SVG 直接绘制，不依赖图表库：颜色全部由 CSS 变量与 Tailwind 类决定，
     * 明暗主题自动跟随，也没有 canvas 的生命周期与重绘问题。
     */
    let {
        /** 按时间升序的得分序列 */
        data,
        width = 640,
        height = 200,
        ariaLabel = "",
    }: {
        data: { timestamp: number; percent: number }[];
        width?: number;
        height?: number;
        ariaLabel?: string;
    } = $props();

    const padding = { top: 12, right: 12, bottom: 24, left: 34 };

    const percents = $derived(data.map((d) => d.percent));
    const geometry = $derived(lineGeometry(percents, width, height, padding));
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

    /** 时间轴刻度需要落在真实数据点的横坐标上 */
    const xLabels = $derived.by(() => {
        if (data.length === 0) return [];
        const stamps = data.map((d) => d.timestamp);
        const innerWidth = width - padding.left - padding.right;
        return timeTicks(stamps, 3).map((stamp) => {
            const index = nearestIndex(stamps, stamp);
            const x =
                data.length === 1
                    ? padding.left + innerWidth / 2
                    : padding.left + (index / (data.length - 1)) * innerWidth;
            const date = new Date(stamp);
            return { x, text: `${date.getMonth() + 1}/${date.getDate()}` };
        });
    });

    function nearestIndex(stamps: number[], target: number): number {
        let best = 0;
        for (let i = 1; i < stamps.length; i++) {
            if (Math.abs(stamps[i] - target) < Math.abs(stamps[best] - target)) best = i;
        }
        return best;
    }

    function fmtDate(ts: number): string {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
</script>

<svg viewBox="0 0 {width} {height}" class="h-auto w-full" role="img" aria-label={ariaLabel} preserveAspectRatio="none">
    <!-- 水平网格与 y 轴刻度 -->
    {#each yTicks as tick (tick)}
        <line
            x1={padding.left}
            x2={width - padding.right}
            y1={yOf(tick)}
            y2={yOf(tick)}
            class="stroke-border"
            stroke-width="1"
            stroke-dasharray={tick === 0 ? "0" : "3 3"}
        />
        <text x={padding.left - 6} y={yOf(tick) + 3} text-anchor="end" class="fill-muted-foreground text-[9px]">
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
    {#each xLabels as label (label.x)}
        <text x={label.x} y={baseline + 16} text-anchor="middle" class="fill-muted-foreground text-[9px]">
            {label.text}
        </text>
    {/each}
</svg>
