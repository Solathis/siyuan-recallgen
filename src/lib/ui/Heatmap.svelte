<script lang="ts">
    import type { ScoreRecord, ScoreRange, HeatmapConfig as HMConfig } from "@/types/quiz";

    export let records: ScoreRecord[] = [];
    export let config: HMConfig;

    $: weeks = Math.max(1, Math.ceil((config?.days ?? 90) / 7));

    type Cell = { date: string; score: number | null; count: number };

    $: days = buildCells(records, config, weeks);

    function fmtDay(d: Date): string {
        const p = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function buildCells(recs: ScoreRecord[], cfg: HMConfig, wk: number): Cell[][] {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayDow = (today.getDay() + 6) % 7;
        const totalDays = wk * 7;
        const start = new Date(today);
        start.setDate(start.getDate() - (totalDays - 1 - todayDow));

        const byDate = aggregate(recs, cfg.metric);
        const cols: Cell[][] = [];
        let cur = new Date(start);
        let col: Cell[] = [];
        let guard = 0;
        while (cur <= today && guard++ < 4000) {
            const key = fmtDay(cur);
            const entry = byDate.get(key);
            col.push({ date: key, score: entry ? entry.score : null, count: entry ? entry.count : 0 });
            if (col.length === 7) {
                cols.push(col);
                col = [];
            }
            cur.setDate(cur.getDate() + 1);
        }
        if (col.length > 0) cols.push(col);
        return cols;
    }

    function aggregate(recs: ScoreRecord[], metric: "max" | "avg"): Map<string, { score: number; count: number }> {
        const m = new Map<string, { scores: number[]; count: number }>();
        for (const r of recs) {
            const d = new Date(r.timestamp);
            const key = fmtDay(d);
            const pct = r.maxScore > 0 ? (r.totalScore / r.maxScore) * 100 : 0;
            const e = m.get(key) ?? { scores: [], count: 0 };
            e.scores.push(pct);
            e.count++;
            m.set(key, e);
        }
        const out = new Map<string, { score: number; count: number }>();
        for (const [k, v] of m) {
            const score = metric === "max"
                ? Math.max(...v.scores)
                : v.scores.reduce((a, b) => a + b, 0) / v.scores.length;
            out.set(k, { score: Math.round(score), count: v.count });
        }
        return out;
    }

    function colorFor(score: number | null): string {
        if (score === null) return "#ebedf0";
        const ranges: ScoreRange[] = [...(config?.ranges ?? [])].sort((a, b) => b.min - a.min);
        for (const r of ranges) {
            if (score >= r.min) return r.color;
        }
        return "#ebedf0";
    }

    let hover: Cell | null = null;
    const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
    $: monthLabels = days.map((col) => {
        const first = col.find((c) => c) as Cell | undefined;
        if (!first) return "";
        const m = new Date(first.date + "T00:00:00").getMonth();
        return MONTHS[m];
    });
</script>

<div class="rg-heatmap">
    {#if hover}
        <div class="rg-heatmap__tip">
            {hover.date} · {hover.score !== null ? `${hover.score} 分（${hover.count} 次）` : "无记录"}
        </div>
    {/if}
    <svg class="rg-heatmap__svg" viewBox="0 0 {days.length * 14} 92">
        {#each days as col, ci}
            {#each col as cell, ri}
                {@const fill = colorFor(cell.score)}
                <rect x={ci * 14} y={ri * 13} width="11" height="11" rx="2" fill={fill}
                      on:mouseenter={() => (hover = cell)} on:mouseleave={() => (hover = null)} />
            {/each}
        {/each}
        {#each monthLabels as label, ci}
            {#if label}
                <text x={ci * 14} y="86" font-size="8" fill="var(--b3-theme-on-surface-light)">{label}</text>
            {/if}
        {/each}
    </svg>
    <div class="rg-heatmap__legend">
        <span>少</span>
        {#each [...(config?.ranges ?? [])].sort((a, b) => a.min - b.min) as r}
            <span class="rg-legend__swatch" style="background:{r.color}" title={"\u2265" + r.min}></span>
        {/each}
        <span>多</span>
    </div>
</div>

<style>
    .rg-heatmap { padding: 8px; }
    .rg-heatmap__svg { width: 100%; max-width: 520px; }
    .rg-heatmap__tip { font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 4px; min-height: 16px; }
    .rg-heatmap__legend { display: flex; align-items: center; gap: 4px; margin-top: 6px; font-size: 11px; color: var(--b3-theme-on-surface-light); }
    .rg-legend__swatch { display: inline-block; width: 11px; height: 11px; border-radius: 2px; }
</style>
