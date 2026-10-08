<script module lang="ts">
    /** 可聚焦的格子：index 是 DOM 顺序下标，col/row 是网格坐标 */
    export interface FocusCell {
        index: number;
        col: number;
        row: number;
    }

    /**
     * 键盘漫游的目标格子。
     *
     * 只在「有日期的格子」集合内移动：窗口前后有补位格（渲染成 span、不可聚焦），
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
                for (let c = from.col + 1; ; c++) {
                    const hit = at(c, from.row);
                    if (hit) return hit;
                    // 右侧已无列可找
                    if (c > cells[cells.length - 1].col) return null;
                }
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
    import { cn } from "@/lib/utils";
    import * as Select from "@/lib/components/ui/select";
    import { HEATMAP_WEEKS, rangeYears, startOfDay, windowBounds, type HeatmapRange } from "./heatmap-range";
    import { t } from "../i18n";
    import { createClock } from "./clock.svelte";
    import { isSafeCssColor } from "@/types/quiz";
    import type { ScoreIndexEntry, HeatmapConfig as HMConfig } from "@/types/quiz";

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

    /*
     * 单元格边长不在这里写死：由 .rg-heatmap 里的 --rg-heat-cell 按容器宽度算，
     * 宽面板刚好铺满、窄面板到下限后交给外层横向滚动。见 app.css。
     */
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

    /**
     * 今天的零点。
     * 面板可能被长期打开（思源不重启），若只算一次，跨过午夜后
     * 「最近一年」的窗口会一直停在昨天，因此跟随共享时钟推进。
     */
    const clock = createClock();
    const today = $derived(startOfDay(new Date(clock.now)));

    /** 有记录的自然年 + 今年，倒序；用于范围选择器 */
    const years = $derived(rangeYears(records, today));

    let range = $state<HeatmapRange>("recent");

    /**
     * 键盘漫游位置（roving tabindex）。
     * 一屏三百多个格子若都在 Tab 序列里，键盘用户要按几百次才能走过热力图，
     * 因此只让一个格子可 Tab 聚焦，格内用方向键移动。
     */
    let focusIndex = $state(0);
    /** 热力图主体容器，供键盘漫游定位格子 */
    let listEl: HTMLElement | null = $state(null);

    /** 第几列第几行 → 线性下标（与 DOM 顺序一致） */
    function cellIndex(colIndex: number, rowIndex: number): number {
        return colIndex * 7 + rowIndex;
    }

    /**
     * 真正可聚焦的格子（有日期的）。
     * 窗口前后的补位格渲染成 span，不在 Tab 序列里，
     * 因此方向键只能在可聚焦集合内移动，否则会走到没有对应元素的格子上。
     */
    const focusableCells = $derived.by(() => {
        const out: FocusCell[] = [];
        cols.forEach((column, col) =>
            column.forEach((cell, row) => {
                if (cell.date) out.push({ index: cellIndex(col, row), col, row });
            })
        );
        return out;
    });

    /** 当前 Tab 停靠的格子必须存在（数据或范围变化后可能要重算） */
    $effect(() => {
        const list = focusableCells;
        if (list.length === 0) return;
        if (!list.some((cell) => cell.index === focusIndex)) {
            // 回落到最新的一天：热力图右端是「最近」，比跳到最左更有用
            focusIndex = list[list.length - 1].index;
        }
    });

    /** 方向键在 7 行 × N 列的网格里移动焦点（跳过补位格） */
    function onCellKeydown(event: KeyboardEvent, colIndex: number, rowIndex: number): void {
        const target = nextFocusCell(focusableCells, { col: colIndex, row: rowIndex }, event.key);
        if (!target) return;
        event.preventDefault();
        const next = target.index;
        focusIndex = next;
        // 焦点跟随：tabindex 更新后再把焦点移到新格子
        queueMicrotask(() => {
            listEl?.querySelector<HTMLElement>(`[data-cell-index="${next}"]`)?.focus();
        });
    }

    function onRangeChange(v: string) {
        range = v === "recent" ? "recent" : Number(v);
        active = null;
    }

    function buildCols(recs: ScoreIndexEntry[], cfg: HMConfig, r: HeatmapRange): Cell[][] {
        const byDate = aggregate(recs, cfg.metric);
        const { start, end } = windowBounds(r, today);

        const out: Cell[][] = [];
        const cur = new Date(start);
        let col: Cell[] = [];
        let guard = 0;
        while (cur <= end && guard++ < 4000) {
            // 年初/窗口前的补位格子没有日期，渲染为空占位
            const inWindow = r === "recent" || cur.getFullYear() === r;
            const key = inWindow ? fmtDay(cur) : "";
            const e = key ? byDate.get(key) : undefined;
            col.push({ date: key, score: e ? e.score : null, count: e ? e.count : 0 });
            if (col.length === 7) {
                out.push(col);
                col = [];
            }
            cur.setDate(cur.getDate() + 1);
        }
        if (col.length > 0) {
            while (col.length < 7) col.push({ date: "", score: null, count: 0 });
            out.push(col);
        }
        if (r === "recent") {
            while (out.length < HEATMAP_WEEKS) {
                out.push(Array.from({ length: 7 }, () => ({ date: "", score: null, count: 0 })));
            }
        }
        return out;
    }

    const cols = $derived(buildCols(records, config, range));

    /** 当前范围内的记录数，用于详情行的兜底文案 */
    const inRange = $derived(
        range === "recent" ? records : records.filter((r) => new Date(r.timestamp).getFullYear() === range)
    );

    /**
     * 用用户配置的色阶取色。
     * 无记录的格子不再硬编码 #ebedf0（该颜色在暗色主题下与背景冲突），
     * 返回 null 表示交给 .bg-muted 跟随主题。
     */
    /** 色阶按 min 降序，取第一个命中的区间 */
    const rangesDesc = $derived([...(config?.ranges ?? [])].sort((a, b) => b.min - a.min));

    function colorFor(score: number | null): string | null {
        if (score === null) return null;
        // 复用派生值：每个格子都重新排序会让约 371 个格子各排一次
        for (const r of rangesDesc) {
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

<div class="rg-heatmap flex w-full flex-col gap-2" style="--rg-heat-cols: {cols.length}">
    <!-- 详情行始终占位，避免悬停时布局跳动 -->
    <div class="flex items-center gap-2">
        <div class="text-muted-foreground min-h-5 flex-1 text-xs" aria-live="polite">
            {#if active}
                {fmtTip(active)}
            {:else if inRange.length > 0}
                {t("heatmap.totalRecords", String(inRange.length))}
            {:else}
                &nbsp;
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

    <div class="flex gap-1">
        <!--
            星期标签。
            顶部必须补一个与右侧月份行等高的占位：月份行在滚动容器内部，
            而这一列在它外面，不补占位整列标签会整体上移一行，
            于是「三」实际指向周二那一行（实测偏差 18px = 月份行高度）。
        -->
        <div class="text-3xs leading-none text-muted-foreground w-5 shrink-0">
            <!-- 结构与右侧月份行逐字相同，高度才能由同一套类保证一致 -->
            <div class="flex gap-1 pb-1 text-3xs leading-none" aria-hidden="true">
                <span class="w-full">&nbsp;</span>
            </div>
            <!--
                行距必须与格子列的 gap-1 同源（0.25rem）。原先写死 margin-bottom: 4px，
                而格子用的是 rem 单位（插件基准字号下是 3.25px），每行差 0.75px，
                七行下来最后一行的「日」会偏出 5px。
            -->
            {#each weekdayLabels as label, i (i)}
                <div class="mb-1 flex items-center" style="height: var(--rg-heat-cell)">{label}</div>
            {/each}
        </div>

        <!-- 热力图主体：窄屏横向滚动 -->
        <div class="min-w-0 flex-1 overflow-x-auto" role="group" aria-label={t("heatmap.ariaLabel")} bind:this={listEl}>
            <div class="w-max">
                <div class="flex gap-1 pb-1 text-3xs leading-none text-muted-foreground">
                    <!--
                        标签盒宽只有一格（CELL），必须禁止换行：否则「10月」会在
                        数字与「月」之间折成两行（CJK 可在任意字符间断行），
                        整行因此从 11px 变成 20px，把左侧星期标签挤得整体上移一行。
                        溢出到右侧空白列是预期的（月份之间隔约 4 列）。
                    -->
                    {#each monthLabels as label, i (i)}
                        <span class="shrink-0 whitespace-nowrap" style="width: var(--rg-heat-cell)">{label}</span>
                    {/each}
                </div>
                <div class="flex gap-1">
                    {#each cols as col, colIndex (colIndex)}
                        <div class="flex flex-col gap-1">
                            {#each col as cell, rowIndex (rowIndex)}
                                {#if cell.date}
                                    {@const bg = colorFor(cell.score)}
                                    {@const safeBg = isSafeCssColor(bg) ? bg : null}
                                    <button
                                        type="button"
                                        data-cell-index={cellIndex(colIndex, rowIndex)}
                                        tabindex={cellIndex(colIndex, rowIndex) === focusIndex ? 0 : -1}
                                        class={cn(
                                            "rounded-sm transition-transform hover:scale-125 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
                                            bg === null && "bg-muted"
                                        )}
                                        style="width: var(--rg-heat-cell); height: var(--rg-heat-cell);{safeBg
                                            ? ` background:${safeBg};`
                                            : ''}"
                                        title={fmtTip(cell)}
                                        aria-label={fmtTip(cell)}
                                        onmouseenter={() => onEnter(cell)}
                                        onmouseleave={onLeave}
                                        onfocus={() => {
                                            focusIndex = cellIndex(colIndex, rowIndex);
                                            onEnter(cell);
                                        }}
                                        onblur={onLeave}
                                        onclick={() => {
                                            onEnter(cell);
                                            // 只在当天有记录时才跳转：空的日期点进去是一份空列表，
                                            // 用户还得再清一次筛选（与 onDayClick 的说明一致）
                                            if (onDayClick && cell.date && cell.count > 0) onDayClick(cell.date);
                                        }}
                                        onkeydown={(e) => onCellKeydown(e, colIndex, rowIndex)}
                                    ></button>
                                {:else}
                                    <span
                                        class="block"
                                        style="width: var(--rg-heat-cell); height: var(--rg-heat-cell)"
                                        aria-hidden="true"
                                    ></span>
                                {/if}
                            {/each}
                        </div>
                    {/each}
                </div>
            </div>
        </div>
    </div>

    <div class="flex items-center gap-1 text-2xs text-muted-foreground">
        <span>{t("heatmap.less")}</span>
        <span class="bg-muted border-border inline-block size-3 rounded-sm border"></span>
        {#each sortedRanges as r, i (i)}
            <span
                class="border-border inline-block size-3 rounded-sm border"
                style="background:{isSafeCssColor(r.color) ? r.color : 'transparent'}"
            ></span>
        {/each}
        <span>{t("heatmap.more")}</span>
    </div>
</div>
