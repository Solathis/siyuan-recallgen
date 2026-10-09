<script module lang="ts">
    /** 可聚焦的格子：index 是网格坐标算出的下标，col/row 是网格坐标 */
    export interface FocusCell {
        index: number;
        col: number;
        row: number;
    }

    /**
     * 键盘漫游的目标格子。
     *
     * 只在「有日期的格子」集合内移动：窗口首尾可能有补位格（不可聚焦），
     * 按几何位置直接加减会让焦点落到不存在的元素上，表现为按键没反应。
     */
    export function nextFocusCell(
        cells: FocusCell[],
        from: { col: number; row: number },
        key: string
    ): FocusCell | null {
        if (cells.length === 0) return null;
        const at = (col: number, row: number) => cells.find((cell) => cell.col === col && cell.row === row);

        switch (key) {
            case "ArrowUp":
                for (let r = from.row - 1; r >= 0; r--) {
                    const hit = at(from.col, r);
                    if (hit) return hit;
                }
                return null;
            case "ArrowDown":
                for (let r = from.row + 1; r <= 6; r++) {
                    const hit = at(from.col, r);
                    if (hit) return hit;
                }
                return null;
            case "ArrowLeft":
                for (let c = from.col - 1; c >= 0; c--) {
                    const hit = at(c, from.row);
                    if (hit) return hit;
                }
                return null;
            case "ArrowRight":
                for (let c = from.col + 1; c <= 53; c++) {
                    const hit = at(c, from.row);
                    if (hit) return hit;
                }
                return null;
            case "Home":
                return cells[0];
            case "End":
                return cells[cells.length - 1];
            default:
                return null;
        }
    }
</script>

<script lang="ts">
    import { Calendar, Chart, Layer, Rect, Text } from "layerchart";

    import { ChartContainer, type ChartConfig } from "@/lib/components/ui/chart";
    import * as Select from "@/lib/components/ui/select";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import { isSafeCssColor, type HeatmapConfig, type ScoreIndexEntry } from "@/types/quiz";
    import { rangeYears, startOfDay, windowBounds, type HeatmapRange } from "./heatmap-range";

    type HMConfig = HeatmapConfig;

    /** 一天一格 */
    type Day = { date: Date; score: number | null; count: number };

    let {
        records = [],
        config,
        lang = "zh",
        showRangePicker = true,
        onDayClick,
    }: {
        records?: ScoreIndexEntry[];
        config: HMConfig;
        lang?: "zh" | "en";
        /** 设置页的预览不需要切换统计范围 */
        showRangePicker?: boolean;
        /** 点击某个有记录的日期时触发（用于跳转到当天的成绩记录） */
        onDayClick?: (date: string) => void;
    } = $props();

    const DAY_MS = 86_400_000;

    const today = startOfDay(new Date());
    const years = $derived(rangeYears(records, today));
    let range = $state<HeatmapRange>("recent");

    function onRangeChange(value: string): void {
        range = value === "recent" ? "recent" : Number(value);
    }

    function fmtDay(d: Date): string {
        const p = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    /** 按天聚合得分：配置里选「最高分」还是「平均分」 */
    const byDay = $derived.by(() => {
        const map = new Map<string, number[]>();
        const scoped =
            range === "recent" ? records : records.filter((r) => new Date(r.timestamp).getFullYear() === range);
        for (const record of scoped) {
            const key = fmtDay(new Date(record.timestamp));
            const percent = record.maxScore > 0 ? (record.totalScore / record.maxScore) * 100 : 0;
            const list = map.get(key);
            if (list) list.push(percent);
            else map.set(key, [percent]);
        }
        return map;
    });

    const bounds = $derived(windowBounds(range, today));
    const startMs = $derived(startOfDay(bounds.start).getTime());

    /** 窗口内每一天（含无记录的日子），顺序即日历顺序 */
    const days = $derived.by<Day[]>(() => {
        const out: Day[] = [];
        const cursor = new Date(bounds.start);
        while (cursor <= bounds.end) {
            const scores = byDay.get(fmtDay(cursor)) ?? [];
            out.push({
                date: new Date(cursor),
                score:
                    scores.length === 0
                        ? null
                        : config.metric === "max"
                          ? Math.max(...scores)
                          : scores.reduce((a, b) => a + b, 0) / scores.length,
                count: scores.length,
            });
            cursor.setDate(cursor.getDate() + 1);
        }
        return out;
    });

    /** 按分数落在哪个区间取色；区间按下限从高到低匹配 */
    const rangesDesc = $derived([...(config?.ranges ?? [])].sort((a, b) => b.min - a.min));
    const rangesAsc = $derived([...(config?.ranges ?? [])].sort((a, b) => a.min - b.min));

    function colorFor(score: number | null): string | null {
        if (score === null) return null;
        for (const entry of rangesDesc) {
            if (score >= entry.min) return entry.color;
        }
        return null;
    }

    const chartConfig = {
        score: { label: t("heatmap.ariaLabel"), color: "var(--chart-1)" },
    } satisfies ChartConfig;

    /* ── 悬停 / 聚焦详情行 ───────────────────────────────────────── */

    let active = $state<Day | null>(null);

    function fmtTip(day: Day): string {
        if (day.score === null) return `${fmtDay(day.date)} · ${t("heatmap.noRecord")}`;
        return t("heatmap.scoreTip", fmtDay(day.date), String(Math.round(day.score)), String(day.count));
    }

    /* ── 键盘漫游（roving tabindex）──────────────────────────────── */

    /**
     * 网格坐标由日期算，不依赖渲染尺寸。
     *
     * 行高是图表库按容器尺寸算出来的，jsdom 下容器为 0 会让一切尺寸为 0；
     * 若用像素位置反推行列，测试环境里会拿到 NaN，可聚焦的那一格也就找不到了。
     * row 取 getDay()（0=周日），与图表库 y = getDay() * 行高 的口径一致。
     */
    function colOf(day: Day): number {
        return Math.floor((startOfDay(day.date).getTime() - startMs) / (7 * DAY_MS));
    }

    function indexOf(day: Day, col: number): number {
        return col * 7 + day.date.getDay();
    }

    let focusedRaw = $state(-1);

    const focusCells = $derived(
        days.map((day) => {
            const col = colOf(day);
            return { index: indexOf(day, col), col, row: day.date.getDay() };
        })
    );

    /**
     * 当前可聚焦格的下标。
     * 下标由「周列 × 7 + 星期几」算出，首格不一定是 0（窗口首日是周一，下标就是 1），
     * 直接拿 0 当初值会出现「没有一格 tabindex=0」，键盘根本进不来；
     * 切换统计范围后整张网格的下标也会变，所以这里统一收口成「不在集合里就回到首格」。
     */
    const focused = $derived(
        focusCells.some((cell) => cell.index === focusedRaw) ? focusedRaw : (focusCells[0]?.index ?? -1)
    );

    /** 键盘移动后要把 DOM 焦点移过去，用元素引用直接对应下标 */
    let cellRefs = new Map<number, SVGRectElement>();

    function onCellKeydown(event: KeyboardEvent, day: Day): void {
        const next = nextFocusCell(focusCells, { col: colOf(day), row: day.date.getDay() }, event.key);
        if (!next) return;
        event.preventDefault();
        focusedRaw = next.index;
        cellRefs.get(next.index)?.focus();
    }

    /** 月份标签：每月第一格上方标一次，格式跟随界面语言 */
    const monthFormatter = $derived(new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", { month: "short" }));

    const monthLabels = $derived.by(() => {
        const out: { col: number; label: string }[] = [];
        let prevMonth = -1;
        for (const day of days) {
            const month = day.date.getMonth();
            if (month !== prevMonth) {
                prevMonth = month;
                out.push({ col: colOf(day), label: monthFormatter.format(day.date) });
            }
        }
        return out;
    });

    const weekdayLabels = $derived(
        lang === "zh" ? ["日", "一", "二", "三", "四", "五", "六"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    );
</script>

<div class="flex w-full flex-col gap-2">
    <!-- 详情行始终占位，避免悬停时布局跳动 -->
    <div class="flex items-center gap-2">
        <div class="text-muted-foreground min-h-5 flex-1 text-xs" aria-live="polite">
            {#if active}
                {fmtTip(active)}
            {:else}
                {t("heatmap.totalRecords", String(records.length))}
            {/if}
        </div>
        {#if showRangePicker}
            <Select.Root type="single" value={String(range)} onValueChange={onRangeChange}>
                <Select.Trigger class="w-28 shrink-0" aria-label={t("heatmap.rangeLabel")}>
                    {range === "recent" ? t("heatmap.rangeRecent") : t("heatmap.rangeYear", String(range))}
                </Select.Trigger>
                <Select.Content>
                    <Select.Item value="recent">{t("heatmap.rangeRecent")}</Select.Item>
                    {#each years as year (year)}
                        <Select.Item value={String(year)}>{t("heatmap.rangeYear", String(year))}</Select.Item>
                    {/each}
                </Select.Content>
            </Select.Root>
        {/if}
    </div>

    <!--
        日历网格用图表库的 Calendar：周列位置、月份标签、单元格边长都由它算，
        本组件只负责每天的颜色与交互。
        窄容器交给横向滚动兜底（给内容一个最小宽度，格子才不会被压成一条线）。
    -->
    <div class="min-w-0 overflow-x-auto">
        <div class="min-w-3xl">
            <ChartContainer config={chartConfig} class="aspect-auto h-40 w-full">
                <Chart data={days} x="date" padding={{ top: 18, right: 4, bottom: 4, left: 24 }}>
                    <!-- Layer 是必需的中间层：Calendar 要 LayerContext 才拿得到比例尺 -->
                    <Layer>
                        <Calendar start={bounds.start} end={bounds.end} monthLabel={false}>
                            {#snippet children({ cells, cellSize })}
                                <!-- 月份标签自己画：图表库默认是英文缩写（"Oct"），中文界面要「10月」 -->
                                {#each monthLabels as month (month.col)}
                                    <Text
                                        value={month.label}
                                        x={month.col * cellSize[0]}
                                        y={-6}
                                        verticalAnchor="end"
                                        class="fill-muted-foreground text-3xs"
                                    />
                                {/each}

                                <!-- 星期标签：图表库只画月份，星期要自己补；放在左侧留白里，由行高定位 -->
                                {#each weekdayLabels as label, row (row)}
                                    <Text
                                        value={row % 2 === 0 ? label : ""}
                                        x={-6}
                                        y={row * cellSize[1] + cellSize[1] / 2}
                                        textAnchor="end"
                                        verticalAnchor="middle"
                                        class="fill-muted-foreground text-3xs"
                                    />
                                {/each}

                                {#each cells as cell (fmtDay(cell.data.date))}
                                    {@const day = cell.data as Day}
                                    {@const col = colOf(day)}
                                    {@const index = indexOf(day, col)}
                                    {@const color = colorFor(day.score)}
                                    {@const safe = color && isSafeCssColor(color) ? color : null}
                                    <Rect
                                        x={cell.x}
                                        y={cell.y}
                                        width={cellSize[0]}
                                        height={cellSize[1]}
                                        rx={2}
                                        data-cell-index={index}
                                        tabindex={index === focused ? 0 : -1}
                                        class={cn("rg-heat-cell", safe === null && "fill-muted")}
                                        fill={safe ?? "var(--color-muted)"}
                                        aria-label={fmtTip(day)}
                                        onmouseenter={() => (active = day)}
                                        onmouseleave={() => (active = null)}
                                        onfocus={() => {
                                            focusedRaw = index;
                                            active = day;
                                        }}
                                        onblur={() => (active = null)}
                                        onclick={() => {
                                            active = day;
                                            // 只在当天有记录时才跳转：空的日期点进去是一份空列表
                                            if (onDayClick && day.count > 0) onDayClick(fmtDay(day.date));
                                        }}
                                        onkeydown={(event: KeyboardEvent) => onCellKeydown(event, day)}
                                    ></Rect>
                                {/each}
                            {/snippet}
                        </Calendar>
                    </Layer>
                </Chart>
            </ChartContainer>
        </div>
    </div>

    <div class="text-muted-foreground flex items-center gap-1 text-2xs">
        <span>{t("heatmap.less")}</span>
        <span class="bg-muted border-border inline-block size-3 rounded-sm border"></span>
        {#each rangesAsc as entry, i (i)}
            <span
                class="border-border inline-block size-3 rounded-sm border"
                style="background:{isSafeCssColor(entry.color) ? entry.color : 'transparent'}"
            ></span>
        {/each}
        <span>{t("heatmap.more")}</span>
    </div>
</div>
