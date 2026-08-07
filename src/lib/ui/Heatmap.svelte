<script lang="ts">
    import { badge } from "./components";
    import type { ScoreRecord, ScoreRange, HeatmapConfig as HMConfig } from "@/types/quiz";

    export let records: ScoreRecord[] = [];
    export let config: HMConfig;

    $: weeks = Math.max(1, Math.ceil((config?.days ?? 90) / 7));

    type Cell = { date: string; score: number | null; count: number };

    $: days = buildCells(records, config, weeks);
    $: tipText = hover ? `${hover.date} · ${hover.score !== null ? hover.score + " 分（" + hover.count + " 次）" : "无记录"}` : "\u00a0";

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
            if (col.length === 7) { cols.push(col); col = []; }
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
            const score = metric === "max" ? Math.max(...v.scores) : v.scores.reduce((a, b) => a + b, 0) / v.scores.length;
            out.set(k, { score: Math.round(score), count: v.count });
        }
        return out;
    }

    function colorFor(score: number | null): string {
        if (score === null) return "#ebedf0";
        const ranges: ScoreRange[] = [...(config?.ranges ?? [])].sort((a, b) => b.min - a.min);
        for (const r of ranges) { if (score >= r.min) return r.color; }
        return "#ebedf0";
    }

    let hover: Cell | null = null;
    const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
    $: monthLabels = days.map((col) => {
        const first = col.find((c) => c) as Cell | undefined;
        if (!first) return "";
        return MONTHS[new Date(first.date + "T00:00:00").getMonth()];
    });
    $: svgW = Math.max(days.length * 14, 1);
    const GRID_TOP = 16;
    const ROW_H = 13;
</script>

<div class="rg-heatmap">
    <div class="rg-heatmap__tip">{tipText}</div>
    <svg class="rg-heatmap__svg" viewBox="0 0 {svgW} {GRID_TOP + 7 * ROW_H + 4}">
        {#each monthLabels as label, ci}
            {#if label}
                <text x={ci * 14} y="11" font-size="8" fill="var(--b3-theme-on-surface-light)">{label}</text>
            {/if}
        {/each}
        {#each days as col, ci}
            {#each col as cell, ri}
                <rect x={ci * 14} y={GRID_TOP + ri * ROW_H} width="11" height="11" rx="2"
                      fill={colorFor(cell.score)}
                      on:mouseenter={() => (hover = cell)} on:mouseleave={() => (hover = null)} />
            {/each}
        {/each}
    </svg>
    <div class="rg-heatmap__legend">
        <span class="rg-legend-text">少</span>
        {#each [...(config?.ranges ?? [])].sort((a, b) => a.min - b.min) as r}
            <span class="rg-legend__swatch" style="background:{r.color}"></span>
        {/each}
        <span class="rg-legend-text">多</span>
    </div>
</div>

<style>
    .rg-heatmap { display: flex; flex-direction: column; gap: 6px; }
    .rg-heatmap__tip {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        min-height: 20px;
        line-height: 20px;
    }
    .rg-heatmap__svg { width: 100%; max-width: 520px; }
    .rg-heatmap__legend {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 2px;
    }
    .rg-legend-text { font-size: 11px; color: var(--b3-theme-on-surface-light); }
    .rg-legend__swatch {
        display: inline-block;
        width: 11px;
        height: 11px;
        border-radius: 2px;
        border: 1px solid var(--b3-border-color);
    }
</style>
