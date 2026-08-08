<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import Heatmap from "./Heatmap.svelte";
    import { button, card, field, input, select, cn } from "./components";
    import type { RecallGenConfig } from "@/types/config";
    import type { ScoreRecord } from "@/types/quiz";

    export let config: RecallGenConfig;
    export let scores: ScoreRecord[] = [];
    const dispatch = createEventDispatcher<{ save: RecallGenConfig }>();

    function v(e: Event): string { return (e.target as HTMLInputElement | HTMLSelectElement).value; }
    function vn(e: Event): number { return parseInt(v(e)) || 0; }

    function patchHeatmap(patch: Partial<typeof config.heatmap>) {
        dispatch("save", { ...config, heatmap: { ...config.heatmap, ...patch } });
    }
    function onMetricChange(e: Event) { patchHeatmap({ metric: v(e) as "max" | "avg" }); }
    function addRange() {
        patchHeatmap({ ranges: [...config.heatmap.ranges, { min: 0, max: 0, color: "#cccccc" }] });
    }
    function removeRange(i: number) {
        patchHeatmap({ ranges: config.heatmap.ranges.filter((_, idx) => idx !== i) });
    }
    function patchRange(i: number, patch: Partial<{ min: number; max: number; color: string }>) {
        const ranges = config.heatmap.ranges.map((r, idx) => idx === i ? { ...r, ...patch } : r);
        dispatch("save", { ...config, heatmap: { ...config.heatmap, ranges } });
    }
</script>

<div class={card.root}>
    <div class={card.header}>
        <h3 class={card.title}>热力图设置</h3>
        <p class={card.description}>成绩日历与配色区间</p>
    </div>
    <div class={cn(card.content, field.group)}>
        <Heatmap records={scores} config={config.heatmap} />
        <div class={field.field}>
            <label class={field.label} for="rg-metric">聚合方式</label>
            <select id="rg-metric" class={select} value={config.heatmap.metric} on:change={onMetricChange}>
                <option value="max">每日最高分</option>
                <option value="avg">每日平均分</option>
            </select>
        </div>
        <div class={field.field}>
            <span class={field.label}>配色区间</span>
            <div class="rg-ranges">
                {#each config.heatmap.ranges as r, i}
                    <div class="rg-range-row">
                        <input class={cn(input, "rg-range-num")} type="number" placeholder="min" value={r.min} on:input={(e) => patchRange(i, { min: vn(e) })} />
                        <input class={cn(input, "rg-range-num")} type="number" placeholder="max" value={r.max} on:input={(e) => patchRange(i, { max: vn(e) })} />
                        <input class="rg-color-picker" type="color" value={r.color} on:input={(e) => patchRange(i, { color: v(e) })} />
                        <button class={button({ variant: "ghost", size: "icon" })} on:click={() => removeRange(i)}>✕</button>
                    </div>
                {/each}
                <button class={button({ variant: "outline", size: "sm" })} on:click={addRange}>+ 添加区间</button>
            </div>
        </div>
    </div>
</div>

<style>
    .rg-ranges { display: flex; flex-direction: column; gap: 8px; }
    .rg-range-row { display: flex; align-items: center; gap: 8px; }
    :global(.rg-range-num) { width: 72px; }
    .rg-color-picker { width: 36px; height: 34px; padding: 2px; border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); background: var(--b3-theme-background); cursor: pointer; }
</style>
