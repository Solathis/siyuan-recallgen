<script lang="ts">
    import { onDestroy } from "svelte";
    import { BarChart, LineChart, PieChart } from "echarts/charts";
    import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
    import * as echarts from "echarts/core";
    import { CanvasRenderer } from "echarts/renderers";
    import { chartPalette, isDarkTheme } from "./theme.svelte.js";

    // 按需注册，避免把 ECharts 全量打进单文件产物
    echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

    let {
        /** 由父组件构建的 option 工厂：传入主题色板，返回完整的 ECharts option */
        build,
        height = "240px",
        ariaLabel = "",
    }: {
        build: (palette: ReturnType<typeof chartPalette>) => Record<string, unknown>;
        height?: string;
        ariaLabel?: string;
    } = $props();

    let host: HTMLDivElement | null = $state(null);
    let chart: echarts.ECharts | null = null;
    let resizeObserver: ResizeObserver | null = null;

    /**
     * 读取主题信号，使效果在主题切换时重新执行。
     * 颜色只能通过 CSS 变量解析，因此主题变化必须重建 option 而不是复用旧的。
     */
    const dark = $derived(isDarkTheme());

    $effect(() => {
        const element = host;
        if (!element) return;

        const instance = echarts.init(element, undefined, { renderer: "canvas" });
        chart = instance;
        // 容器宽度随面板变化（侧栏展开、窗口缩放）
        resizeObserver = new ResizeObserver(() => instance.resize());
        resizeObserver.observe(element);

        return () => {
            resizeObserver?.disconnect();
            resizeObserver = null;
            chart = null;
            instance.dispose();
        };
    });

    // 主题或数据变化时重建 option
    $effect(() => {
        void dark;
        const instance = chart;
        if (!instance || !host) return;
        const palette = chartPalette(host);
        instance.setOption(build(palette), true);
    });

    onDestroy(() => {
        resizeObserver?.disconnect();
        chart?.dispose();
        chart = null;
    });
</script>

<!-- 图表本身对读屏不可见，因此把关键信息放在 aria-label 里，并在下方提供文本兜底 -->
<div bind:this={host} style="height: {height}; width: 100%" role="img" aria-label={ariaLabel}></div>
