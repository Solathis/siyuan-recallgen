<script lang="ts">
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import type { ScoreIndexEntry, ScoreRange, HeatmapConfig as HMConfig } from "@/types/quiz";

    let {
        records = [],
        config,
        lang = "zh",
    }: { records?: ScoreIndexEntry[]; config: HMConfig; lang?: "zh" | "en" } = $props();

    /** GitHub 风格：固定 53 周 × 7 天 */
    const WEEKS = 53;
    const DAYS = WEEKS * 7;
    /** 单元格边长（px）。固定尺寸 + 横向滚动，保证窄屏也能看清而不是被压成一条线 */
    const CELL = 12;

    type Cell = { date: string; score: number | null; count: number };

    const weekdayLabels = $derived(
        lang === "zh" ? ["一", "", "三", "", "五", "", "日"] : ["Mon", "", "Wed", "", "Fri", "", "Sun"]
    );

    /** 月份标签跟随输出语言，不再硬编码中文月份 */
    const monthFormatter = $derived(new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", { month: "short" }));

    function fmtDay(d: Date): string {
        const p = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function fmtTip(cell: Cell): string {
        if (cell.score === null) return `${cell.date} · ${t("heatmap.noRecord")}`;
        return t("heatmap.scoreTip", cell.date, String(cell.score), String(cell.count));
    }

    function aggregate(recs: ScoreIndexEntry[], metric: "max" | "avg") {
        const m = new Map<string, { scores: number[]; count: number }>();
        for (const r of recs) {
            const key = fmtDay(new Date(r.timestamp));
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

    function buildCols(recs: ScoreIndexEntry[], cfg: HMConfig): Cell[][] {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayDow = (today.getDay() + 6) % 7;
        const start = new Date(today);
        start.setDate(start.getDate() - (DAYS - 1 - todayDow));
        const byDate = aggregate(recs, cfg.metric);

        const out: Cell[][] = [];
        const cur = new Date(start);
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
        while (out.length < WEEKS) {
            out.push(Array.from({ length: 7 }, () => ({ date: "", score: null, count: 0 })));
        }
        return out;
    }

    const cols = $derived(buildCols(records, config));

    /**
     * 用用户配置的色阶取色。
     * 无记录的格子不再硬编码 #ebedf0（该颜色在暗色主题下与背景冲突），
     * 返回 null 表示交给 .bg-muted 跟随主题。
     */
    function colorFor(score: number | null): string | null {
        if (score === null) return null;
        const ranges: ScoreRange[] = [...(config?.ranges ?? [])].sort((a, b) => b.min - a.min);
        for (const r of ranges) {
            if (score >= r.min) return r.color;
        }
        return null;
    }

    /**
     * 当前悬停/聚焦的格子。
     * 原实现用一个 position:absolute + opacity:0 的浮层显示，且没有任何规则把它显示出来，
     * 等于提示永远不可见；现改为固定在网格上方的详情行，触屏点按也能看到。
     */
    let active = $state<Cell | null>(null);

    function onEnter(cell: Cell) {
        if (cell.date) active = cell;
    }
    function onLeave() {
        active = null;
    }

    const monthLabels = $derived.by(() => {
        let prevMonth = -1;
        return cols.map((col) => {
            const first = col.find((c) => c.date);
            if (!first) return "";
            const d = new Date(`${first.date}T00:00:00`);
            const m = d.getMonth();
            if (m !== prevMonth) {
                prevMonth = m;
                return monthFormatter.format(d);
            }
            return "";
        });
    });

    const sortedRanges = $derived([...(config?.ranges ?? [])].sort((a, b) => a.min - b.min));
</script>

<div class="flex w-full flex-col gap-2">
    <!-- 详情行始终占位，避免悬停时布局跳动 -->
    <div class="text-muted-foreground min-h-5 text-xs" aria-live="polite">
        {#if active}
            {fmtTip(active)}
        {:else if records.length > 0}
            {t("heatmap.totalRecords", String(records.length))}
        {:else}
            &nbsp;
        {/if}
    </div>

    <div class="flex gap-1">
        <!-- 星期标签 -->
        <div class="py-px text-[10px] leading-none text-muted-foreground">
            {#each weekdayLabels as label}
                <div class="flex items-center" style="height: {CELL}px; margin-bottom: 4px">{label}</div>
            {/each}
        </div>

        <!-- 热力图主体：窄屏横向滚动 -->
        <div class="min-w-0 flex-1 overflow-x-auto" role="group" aria-label={t("heatmap.ariaLabel")}>
            <div class="w-max">
                <div class="flex gap-1 pb-1 text-[10px] leading-none text-muted-foreground">
                    {#each monthLabels as label}
                        <span class="shrink-0" style="width: {CELL}px">{label}</span>
                    {/each}
                </div>
                <div class="flex gap-1">
                    {#each cols as col}
                        <div class="flex flex-col gap-1">
                            {#each col as cell}
                                {#if cell.date}
                                    {@const bg = colorFor(cell.score)}
                                    <button
                                        type="button"
                                        class={cn(
                                            "rounded-[2px] transition-transform hover:scale-125 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
                                            bg === null && "bg-muted"
                                        )}
                                        style="width: {CELL}px; height: {CELL}px;{bg ? ` background:${bg};` : ''}"
                                        title={fmtTip(cell)}
                                        aria-label={fmtTip(cell)}
                                        onmouseenter={() => onEnter(cell)}
                                        onmouseleave={onLeave}
                                        onfocus={() => onEnter(cell)}
                                        onblur={onLeave}
                                        onclick={() => onEnter(cell)}
                                    ></button>
                                {:else}
                                    <span class="block" style="width: {CELL}px; height: {CELL}px" aria-hidden="true"
                                    ></span>
                                {/if}
                            {/each}
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    </div>

    <div class="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span>{t("heatmap.less")}</span>
        <span class="bg-muted border-border inline-block size-3 rounded-[2px] border"></span>
        {#each sortedRanges as r}
            <span class="border-border inline-block size-3 rounded-[2px] border" style="background:{r.color}"></span>
        {/each}
        <span>{t("heatmap.more")}</span>
    </div>
</div>
