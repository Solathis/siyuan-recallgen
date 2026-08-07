<script lang="ts">
    import { heatmap as h } from "./components";
    import type { ScoreRecord, ScoreRange, HeatmapConfig as HMConfig } from "@/types/quiz";

    export let records: ScoreRecord[] = [];
    export let config: HMConfig;

    type Cell = { date: string; score: number | null; count: number };
    type Col = Cell[];

    $: weeks = Math.max(1, Math.ceil((config?.days ?? 90) / 7));
    $: cols = buildCols(records, config, weeks);

    const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

    let tipX = 0;
    let tipY = 0;
    let tipVisible = false;
    let tipDate = "";
    let tipScore = "";

    function fmtDay(d: Date): string {
        const p = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function buildCols(recs: ScoreRecord[], cfg: HMConfig, wk: number): Col[] {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayDow = (today.getDay() + 6) % 7;
        const totalDays = wk * 7;
        const start = new Date(today);
        start.setDate(start.getDate() - (totalDays - 1 - todayDow));
        const byDate = aggregate(recs, cfg.metric);
        const out: Col[] = [];
        let cur = new Date(start);
        let col: Cell[] = [];
        let guard = 0;
        while (cur <= today && guard++ < 4000) {
            const key = fmtDay(cur);
            const e = byDate.get(key);
            col.push({ date: key, score: e ? e.score : null, count: e ? e.count : 0 });
            if (col.length === 7) { out.push(col); col = []; }
            cur.setDate(cur.getDate() + 1);
        }
        if (col.length > 0) out.push(col);
        return out;
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

    function onEnter(cell: Cell, e: MouseEvent) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const parentRect = (e.currentTarget as HTMLElement).closest(".rg-heatmap")!.getBoundingClientRect();
        tipX = rect.left - parentRect.left + rect.width / 2;
        tipY = rect.top - parentRect.top - 4;
        tipDate = cell.date;
        tipScore = cell.score !== null ? `${cell.score} 分（${cell.count} 次）` : "无记录";
        tipVisible = true;
    }
    function onLeave() { tipVisible = false; }

    $: monthLabels = cols.map((col) => {
        const first = col.find((c) => c);
        if (!first) return "";
        return MONTHS[new Date(first.date + "T00:00:00").getMonth()];
    });
    $: sortedRanges = [...(config?.ranges ?? [])].sort((a, b) => a.min - b.min);
</script>

<div class={h.root}>
    <div class={h.tip} style="left:{tipX}px; top:{tipY}px; transform:translate(-50%,-100%); opacity:{tipVisible ? 1 : 0}">
        {tipDate} · {tipScore}
    </div>
    <div class={h.months} style="grid-template-columns: repeat({cols.length}, 1fr)">
        {#each monthLabels as label}
            <span class={h.monthLabel}>{label}</span>
        {/each}
    </div>
    <div class={h.grid} style="grid-template-columns: repeat({cols.length}, 1fr)">
        {#each cols as col}
            <div class={h.col}>
                {#each col as cell}
                    <div class={h.cell}
                         style="background:{colorFor(cell.score)}"
                         on:mouseenter={(e) => onEnter(cell, e)}
                         on:mouseleave={onLeave}
                         role="button" tabindex="-1"
                    ></div>
                {/each}
            </div>
        {/each}
    </div>
    <div class={h.legend}>
        <span class={h.legendText}>少</span>
        {#each sortedRanges as r}
            <span class={h.legendSwatch} style="background:{r.color}"></span>
        {/each}
        <span class={h.legendText}>多</span>
    </div>
</div>
