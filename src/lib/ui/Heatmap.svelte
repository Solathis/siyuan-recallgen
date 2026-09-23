<script lang="ts">
    import { heatmap as h } from "./components";
    import { t } from "../i18n";
    import type { ScoreRecord, ScoreRange, HeatmapConfig as HMConfig } from "@/types/quiz";

    export let records: ScoreRecord[] = [];
    export let config: HMConfig;

    /** GitHub 风格：固定 53 周 × 7 天 */
    const WEEKS = 53;
    const DAYS = WEEKS * 7;

    type Cell = { date: string; score: number | null; count: number };
    type Col = Cell[];

    $: cols = buildCols(records, config);
    $: tipText = hover ? fmtTip(hover) : "\u00a0";

    const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

    function fmtDay(d: Date): string {
        const p = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function fmtTip(cell: Cell): string {
        if (cell.score === null) return `${cell.date} · ${t("heatmap.noRecord")}`;
        return t("heatmap.scoreTip", cell.date, String(cell.score), String(cell.count));
    }

    function buildCols(recs: ScoreRecord[], cfg: HMConfig): Col[] {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayDow = (today.getDay() + 6) % 7;
        const start = new Date(today);
        start.setDate(start.getDate() - (DAYS - 1 - todayDow));
        const byDate = aggregate(recs, cfg.metric);
        const out: Col[] = [];
        let cur = new Date(start);
        let col: Cell[] = [];
        let guard = 0;
        while (cur <= today && guard++ < 4000) {
            const key = fmtDay(cur);
            const e = byDate.get(key);
            col.push({ date: key, score: e ? e.score : null, count: e ? e.count : 0 });
            if (col.length === 7) {
                out.push(col);
                col = [];
            }
            cur.setDate(cur.getDate() + 1);
        }
        if (col.length > 0) out.push(col);
        while (out.length < WEEKS) out.push(Array.from({ length: 7 }, () => ({ date: "", score: null, count: 0 })));
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
            const score =
                metric === "max" ? Math.max(...v.scores) : v.scores.reduce((a, b) => a + b, 0) / v.scores.length;
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
    function onEnter(cell: Cell) {
        hover = cell;
    }
    function onLeave() {
        hover = null;
    }

    /** 月份标签：仅在月份变化时显示，避免重复 */
    $: monthLabels = (() => {
        let prevMonth = -1;
        return cols.map((col) => {
            const first = col.find((c) => c.date);
            if (!first) return "";
            const m = new Date(first.date + "T00:00:00").getMonth();
            if (m !== prevMonth) {
                prevMonth = m;
                return MONTHS[m];
            }
            return "";
        });
    })();
    $: sortedRanges = [...(config?.ranges ?? [])].sort((a, b) => a.min - b.min);
</script>

<div class={h.root}>
    <div class={h.tip}>{tipText}</div>
    <div class={h.months} style="grid-template-columns: repeat({WEEKS}, 1fr)">
        {#each monthLabels as label}
            <span class={h.monthLabel}>{label}</span>
        {/each}
    </div>
    <div class={h.grid} style="grid-template-columns: repeat({WEEKS}, 1fr)">
        {#each cols as col}
            <div class={h.col}>
                {#each col as cell}
                    <div
                        class={h.cell}
                        style="background:{colorFor(cell.score)}"
                        on:mouseenter={() => onEnter(cell)}
                        on:mouseleave={onLeave}
                        role="button"
                        tabindex="-1"
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
