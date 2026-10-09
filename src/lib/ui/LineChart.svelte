<script lang="ts">
    import { scaleUtc } from "d3-scale";
    import { LineChart as LayerLineChart } from "layerchart";

    import { ChartContainer, ChartTooltip, type ChartConfig } from "@/lib/components/ui/chart";
    import { t } from "../i18n";

    /**
     * 得分率折线图（时间轴）。
     *
     * 改用 shadcn 的 Chart（底层 layerchart）绘制：坐标轴、比例尺、网格、悬停
     * 与补间动画都由图表库负责，本组件只负责把得分序列整理成它的数据形状。
     *
     * 之前是自己量宽度再算 SVG 几何，理由是「不引图表库」；代价是
     * viewBox 写死时会被按容器宽度等比放大（1440 面板下 200px 的图变成 460px、
     * 线宽与刻度文字一起被拉大）——这类问题图表库自己会处理。
     */
    let {
        /** 按时间升序的得分序列 */
        data,
        ariaLabel = "",
    }: {
        data: { timestamp: number; percent: number }[];
        ariaLabel?: string;
    } = $props();

    const config = {
        percent: { label: t("stats.trend"), color: "var(--chart-1)" },
    } satisfies ChartConfig;

    const points = $derived(data.map((item) => ({ date: new Date(item.timestamp), percent: item.percent })));

    /** 时间轴刻度：几个月内只显示「月/日」，跨年时补上年份 */
    function formatDay(value: Date): string {
        return `${value.getMonth() + 1}/${value.getDate()}`;
    }
</script>

<div role="img" aria-label={ariaLabel} class="w-full">
    <ChartContainer {config} class="aspect-auto h-56 w-full">
        <LayerLineChart
            data={points}
            x="date"
            y="percent"
            xScale={scaleUtc()}
            yDomain={[0, 100]}
            points={{ r: 3 }}
            padding={{ top: 8, right: 8, bottom: 20, left: 32 }}
            series={[{ key: "percent", label: t("stats.trend"), color: "var(--chart-1)" }]}
            props={{
                spline: { strokeWidth: 2 },
                xAxis: { format: (value: Date) => formatDay(value) },
                yAxis: { format: (value: number) => String(value) },
            }}
        >
            {#snippet tooltip()}
                <ChartTooltip hideLabel />
            {/snippet}
        </LayerLineChart>
    </ChartContainer>
</div>
