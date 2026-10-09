<script lang="ts">
    import { PieChart } from "layerchart";

    import { ChartContainer, ChartTooltip, type ChartConfig } from "@/lib/components/ui/chart";
    import * as Item from "@/lib/components/ui/item";

    /**
     * 环形图。
     *
     * 改用 shadcn 的 Chart + layerchart 的 PieChart：弧段路径、内外半径、留白
     * 与补间动画都由图表库算，本组件只把切片整理成它的数据形状。
     * 图例用 shadcn 的 Item 排版（色块 + 标签 + 数值），不再手写 ul/li。
     */
    let {
        slices,
        ariaLabel = "",
    }: {
        /** note 是可选的补充说明（例如样本量），显示在数值右侧 */
        slices: { label: string; value: number; color: string; note?: string }[];
        ariaLabel?: string;
    } = $props();

    /** 只保留正值切片：0 值画不出弧段，也不该出现在图例里 */
    const visible = $derived(slices.filter((slice) => Number.isFinite(slice.value) && slice.value > 0));

    const data = $derived(
        visible.map((slice, index) => ({
            name: slice.label,
            value: slice.value,
            fill: slice.color || `var(--chart-${(index % 5) + 1})`,
        }))
    );

    const config = $derived(
        Object.fromEntries(data.map((item) => [item.name, { label: item.name, color: item.fill }])) as ChartConfig
    );
</script>

<ChartContainer {config} class="aspect-square h-44 w-full" aria-label={ariaLabel}>
    {#if data.length === 0}
        <!-- 无数据时留一圈空环，避免整块区域空着 -->
        <div class="border-border m-auto size-32 rounded-full border-8" aria-hidden="true"></div>
    {:else}
        <PieChart {data} key="name" value="value" c="fill" innerRadius={52} padding={2}>
            {#snippet tooltip()}
                <ChartTooltip hideLabel />
            {/snippet}
        </PieChart>
    {/if}
</ChartContainer>

<!-- 图例：同时承担「文本等价物」的职责，读屏与色盲用户都能读取数值 -->
<div class="mt-2 flex flex-col">
    {#each visible as slice (slice.label)}
        <Item.Root size="xs">
            <Item.Media variant="icon" class="bg-transparent">
                <span class="size-2.5 rounded-full" style="background: {slice.color}"></span>
            </Item.Media>
            <Item.Content>
                <Item.Title class="text-xs">{slice.label}</Item.Title>
            </Item.Content>
            <Item.Actions class="text-muted-foreground text-xs">
                {slice.value.toFixed(0)}%{#if slice.note}<span class="text-2xs">（{slice.note}）</span>{/if}
            </Item.Actions>
        </Item.Root>
    {/each}
</div>
