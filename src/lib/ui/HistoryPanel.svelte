<script lang="ts">
    /**
     * 答题记录（含统计、题库两个子页）。
     *
     * 记录页按「总量 → 怎么筛 → 逐条看」排：标题行、四格汇总、筛选、分组与视图、列表。
     * 默认按日期的列表，每天一个分组头（当天次数与均分），行内只放分数、标题和一行要点；
     * 查看、跳回原笔记、删除收进行尾的「更多操作」菜单，删除确认框整页共用一个。
     */
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import CalendarIcon from "@lucide/svelte/icons/calendar";
    import ClipboardListIcon from "@lucide/svelte/icons/clipboard-list";
    import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
    import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
    import EyeIcon from "@lucide/svelte/icons/eye";
    import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
    import SearchXIcon from "@lucide/svelte/icons/search-x";
    import TrashIcon from "@lucide/svelte/icons/trash";
    import XIcon from "@lucide/svelte/icons/x";
    import * as AlertDialog from "@/lib/components/ui/alert-dialog";
    import { Button } from "@/lib/components/ui/button";
    import * as Card from "@/lib/components/ui/card";
    import * as DropdownMenu from "@/lib/components/ui/dropdown-menu";
    import * as Empty from "@/lib/components/ui/empty";
    import { Input } from "@/lib/components/ui/input";
    import * as Item from "@/lib/components/ui/item";
    import { Progress } from "@/lib/components/ui/progress";
    import { Skeleton } from "@/lib/components/ui/skeleton";
    import * as Table from "@/lib/components/ui/table";
    import * as Tabs from "@/lib/components/ui/tabs";
    import * as ToggleGroup from "@/lib/components/ui/toggle-group";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import { dayKey, summarize } from "../quiz/charts";
    import { EXPORT_EXTENSION, EXPORT_MIME, buildExport, type ExportFormat } from "../quiz/export";
    import { isOpenableDocId, sourceGroupKey } from "../quiz/history-view";
    import { PAGE_SIZE, limitGroups, nextLimit } from "../quiz/paging";
    import type { QuizService } from "../quiz/service";
    import { HIGH_SCORE, PASS_SCORE, passRate, scorePercent, scoreTier } from "../quiz/stats";
    import type { Difficulty, QuestionType, ScoreIndexEntry } from "@/types/quiz";
    import BankPanel from "./BankPanel.svelte";
    import { downloadText, exportStamp } from "./download";
    import { formatClock } from "./duration";
    import { scoreBar, scoreText } from "./score-tone";
    import StatsPanel from "./StatsPanel.svelte";

    let {
        service,
        onOpenReview,
        onStartReview = () => {},
        openFlashcard = undefined,
    }: {
        service: QuizService;
        onOpenReview: (entry: ScoreIndexEntry) => void;
        /** 按知识点、题型或难度开始一次到期复习；由插件层打开新的答题 Tab */
        onStartReview?: (scope: { tag?: string; type?: QuestionType; difficulty?: Difficulty; cram?: boolean }) => void;
        openFlashcard?: (items: import("../quiz/bank").BankItem[]) => void;
    } = $props();

    /** 记录只会整体替换（载入、删除），用 raw 免得给每条的 byType/byTag 都建深层代理 */
    let records = $state.raw<ScoreIndexEntry[]>([]);
    let loading = $state(true);
    let loadError = $state<string | null>(null);
    /** 热力图需要配色配置与输出语言，跟随配置变化；初值经函数读取以避免捕获警告 */
    function initialConfig() {
        return service.getConfig();
    }
    let config = $state(initialConfig());
    $effect(() => service.subscribeConfig((next) => (config = next)));

    let query = $state("");
    let groupBy = $state<"date" | "source">("date");
    let viewMode = $state<"list" | "cards" | "table">("list");
    let scoreFilter = $state<"all" | "high" | "mid" | "low">("all");
    let topView = $state<"records" | "stats" | "bank">("records");
    /** 从热力图点某一天跳过来时只看那天；null 表示不限日期 */
    let dayFilter = $state<string | null>(null);

    /** 删除确认框整页共用一个：原先每行各挂一套 AlertDialog */
    let deleteTarget = $state<ScoreIndexEntry | null>(null);
    let deleteOpen = $state(false);
    let deleting = $state<string | null>(null);

    /** 已渲染条数上界：分段渲染，触底或点按钮再加一批 */
    let visible = $state(PAGE_SIZE);
    let sentinel: HTMLDivElement | null = $state(null);

    async function load() {
        loading = true;
        loadError = null;
        try {
            records = await service.listScores();
        } catch (e) {
            console.error("[RecallGen] 加载成绩记录失败", e);
            loadError = (e as Error).message;
        } finally {
            loading = false;
        }
    }

    onMount(() => void load());

    /**
     * 每条记录的派生值只在记录变化时算一次：
     * 筛选、分组、渲染都要用百分比、日期键和搜索文本，原先每敲一个字都重算一遍。
     */
    interface Row {
        entry: ScoreIndexEntry;
        percent: number;
        day: string;
        haystack: string;
    }

    const rows = $derived<Row[]>(
        records.map((entry) => ({
            entry,
            percent: scorePercent(entry),
            day: dayKey(entry.timestamp),
            haystack: `${entry.title} ${entry.sourceTitle ?? ""}`.toLowerCase(),
        }))
    );

    const filtered = $derived.by(() => {
        const q = query.trim().toLowerCase();
        return rows.filter((row) => {
            if (dayFilter && row.day !== dayFilter) return false;
            if (q && !row.haystack.includes(q)) return false;
            // 区间与配色同一套档位：≥80 优秀、60–79 达标、<60 未达标
            const tier = scoreTier(row.percent);
            if (scoreFilter === "high" && tier !== "high") return false;
            if (scoreFilter === "mid" && tier !== "pass") return false;
            if (scoreFilter === "low" && (tier === "high" || tier === "pass")) return false;
            return true;
        });
    });

    interface Group {
        key: string;
        items: Row[];
        /** 分组头的统计按整组算，不受分段渲染截断影响 */
        count: number;
        avg: number;
    }

    /** 按日期或来源分组，保持列表本身的时间倒序 */
    const groups = $derived.by<Group[]>(() => {
        const map = new Map<string, Row[]>();
        for (const row of filtered) {
            const key = groupBy === "date" ? row.day : sourceGroupKey(row.entry);
            const items = map.get(key);
            if (items) items.push(row);
            else map.set(key, [row]);
        }
        return [...map.entries()].map(([key, items]) => ({
            key,
            items,
            count: items.length,
            avg: items.reduce((sum, row) => sum + row.percent, 0) / items.length,
        }));
    });
    const groupMeta = $derived(new Map(groups.map((group) => [group.key, group])));
    const limited = $derived(limitGroups(groups, visible));
    /** 卡片视图是一层网格，不按分组折行（一天一两次练习时每组右侧会空出一大片） */
    const flatRows = $derived(limited.groups.flatMap((group) => group.items));

    /**
     * 汇总跟随当前筛选。每题用时与统计页同一个算法（按题数加权的实测单题耗时），
     * 达标率是题目层面的 Σ达标题数 / Σ题数，与结果页顶部的「达标率」同一口径。
     */
    const summary = $derived.by(() => {
        const entries = filtered.map((row) => row.entry);
        const stats = summarize(entries);
        return {
            count: entries.length,
            avg: entries.length > 0 ? stats.averagePercent : null,
            passRate: passRate(entries),
            perQuestion: stats.secondsPerQuestion,
        };
    });

    /**
     * 换筛选、分组、视图或子页时回到第一批。
     * 原先只有搜索与分数筛选会收回：滚远之后再切视图，所有已加载的行会一次性渲染出来。
     * 在事件处理里直接收回，而不是靠 $effect 事后收回——后者会先把那几百行渲染一遍。
     */
    function resetPaging(): void {
        visible = PAGE_SIZE;
    }

    function setQuery(value: string): void {
        query = value;
        resetPaging();
    }

    function setScoreFilter(value: string): void {
        if (!value) return; // 再点一次已选中的项会传空串，保持原选择
        scoreFilter = value as typeof scoreFilter;
        resetPaging();
    }

    function setGroupBy(value: string): void {
        if (!value) return;
        groupBy = value as typeof groupBy;
        resetPaging();
    }

    function setViewMode(value: string): void {
        if (!value) return;
        viewMode = value as typeof viewMode;
        resetPaging();
    }

    function setTopView(value: string): void {
        topView = value as typeof topView;
        resetPaging();
    }

    function setDayFilter(day: string | null): void {
        dayFilter = day;
        resetPaging();
    }

    function clearFilters(): void {
        query = "";
        scoreFilter = "all";
        setDayFilter(null);
    }

    /*
     * 触底自动加载下一批。每加载一批就重建观察器：
     * 行很矮、面板很高时，加载完哨兵仍在视口内，不会再触发新的「进入视口」，
     * 原先自动加载就停在那里，得用户手动滚一下或点按钮。重建后浏览器会重新报告一次。
     */
    $effect(() => {
        const element = sentinel;
        void visible;
        if (!element || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting) && limited.remaining > 0) {
                visible = nextLimit(visible, filtered.length);
            }
        });
        observer.observe(element);
        return () => observer.disconnect();
    });

    const pad = (n: number) => String(n).padStart(2, "0");

    function clock(ts: number): string {
        const d = new Date(ts);
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    /** 带日期的时间：今年的省掉年份 */
    function dateTime(ts: number): string {
        const d = new Date(ts);
        const date = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const year = d.getFullYear() === new Date().getFullYear() ? "" : `${d.getFullYear()}-`;
        return `${year}${date} ${clock(ts)}`;
    }

    /** 分组头：按日期是「10月8日 周三」，按来源是最近一次记录的来源名 */
    const dateFormats = new Map<string, Intl.DateTimeFormat>();
    function dayTitle(day: string): string {
        const locale = config.general.language === "en" ? "en-US" : "zh-CN";
        const date = new Date(`${day}T00:00:00`);
        const withYear = date.getFullYear() !== new Date().getFullYear();
        const cacheKey = `${locale}|${withYear}`;
        let format = dateFormats.get(cacheKey);
        if (!format) {
            format = new Intl.DateTimeFormat(locale, {
                year: withYear ? "numeric" : undefined,
                month: locale === "en-US" ? "short" : "long",
                day: "numeric",
                weekday: "short",
            });
            dateFormats.set(cacheKey, format);
        }
        return format.format(date);
    }

    function groupTitle(group: { key: string; items: Row[] }): string {
        if (groupBy === "date") return dayTitle(group.key);
        const latest = group.items[0]?.entry;
        return latest?.sourceTitle || latest?.title || t("history.noSource");
    }

    /**
     * 行内一行要点：题数 · 时间 · 用时 · 未答 · 有分析。
     * 按日期分组时分组头已经写了日期，只写时刻；按来源分组、以及不分组的卡片要带上日期。
     */
    function metaLine(entry: ScoreIndexEntry, withDate: boolean): string {
        const parts = [
            t("result.qCount", String(entry.questionCount)),
            withDate ? dateTime(entry.timestamp) : clock(entry.timestamp),
        ];
        if ((entry.duration ?? 0) > 0) parts.push(`${t("result.time")} ${formatClock(entry.duration ?? 0)}`);
        if (entry.unanswered > 0) parts.push(t("history.unanswered", String(entry.unanswered)));
        if (entry.hasAnalysis) parts.push(t("history.hasAnalysis"));
        return parts.join(" · ");
    }

    function askDelete(entry: ScoreIndexEntry): void {
        deleteTarget = entry;
        // 等菜单收起再开确认框，免得菜单把焦点还给触发按钮时把确认框的焦点抢走
        setTimeout(() => (deleteOpen = true), 0);
    }

    async function confirmDelete(): Promise<void> {
        const entry = deleteTarget;
        deleteOpen = false;
        if (!entry) return;
        deleting = entry.id;
        try {
            await service.removeScore(entry.id);
            records = records.filter((r) => r.id !== entry.id);
            showMessage(t("history.deleted"), 4000);
        } catch (e) {
            console.error("[RecallGen] 删除成绩失败", e);
            showMessage(t("history.deleteFailed", (e as Error).message), 7000, "error");
        } finally {
            deleting = null;
        }
    }

    /** 导出当前筛选结果：用 Blob + a[download]，不依赖思源接口 */
    function exportAs(format: ExportFormat): void {
        try {
            const entries = filtered.map((row) => row.entry);
            const content = buildExport(entries, format, t("history.title"));
            downloadText(`recallgen-scores-${exportStamp()}.${EXPORT_EXTENSION[format]}`, content, EXPORT_MIME[format]);
            showMessage(t("history.exported", String(entries.length)), 4000);
        } catch (e) {
            showMessage(t("history.exportFailed", (e as Error).message), 7000, "error");
        }
    }

    /** 分数区间：分界取自 scoreTier 的同一套常量 */
    const SCORE_FILTERS = [
        { value: "all", label: t("history.tier_all") },
        { value: "high", label: `≥${HIGH_SCORE}` },
        { value: "mid", label: `${PASS_SCORE}–${HIGH_SCORE - 1}` },
        { value: "low", label: `<${PASS_SCORE}` },
    ] as const;

    /** 分段控件选中项补实底，否则描边变体只有一层浅灰，看不出选了哪个 */
    const SEGMENT_ON = "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";
</script>

{#snippet rowMenu(entry: ScoreIndexEntry)}
    <DropdownMenu.Root>
        <DropdownMenu.Trigger>
            {#snippet child({ props })}
                <Button
                    {...props}
                    variant="ghost"
                    size="icon-sm"
                    data-tap="icon"
                    disabled={deleting === entry.id}
                    aria-label={t("history.moreActions")}
                    title={t("history.moreActions")}
                >
                    <EllipsisIcon aria-hidden="true" />
                </Button>
            {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
            <DropdownMenu.Item onclick={() => onOpenReview(entry)}>
                <EyeIcon aria-hidden="true" />
                {t("history.review")}
            </DropdownMenu.Item>
            {#if isOpenableDocId(entry.sourceDocId)}
                <DropdownMenu.Item onclick={() => service.openDoc(entry.sourceDocId ?? "")}>
                    <ExternalLinkIcon aria-hidden="true" />
                    {t("history.openSource")}
                </DropdownMenu.Item>
            {/if}
            <DropdownMenu.Separator />
            <DropdownMenu.Item variant="destructive" onclick={() => askDelete(entry)}>
                <TrashIcon aria-hidden="true" />
                {t("common.delete")}
            </DropdownMenu.Item>
        </DropdownMenu.Content>
    </DropdownMenu.Root>
{/snippet}

<div class="@container flex flex-col gap-4 p-4">
    <!-- 顶层视图：记录 / 统计 / 题库 -->
    <Tabs.Root value={topView} onValueChange={setTopView}>
        <Tabs.List>
            <Tabs.Trigger value="records">{t("history.tabRecords")}</Tabs.Trigger>
            <Tabs.Trigger value="stats">{t("history.tabStats")}</Tabs.Trigger>
            <Tabs.Trigger value="bank">{t("history.tabBank")}</Tabs.Trigger>
        </Tabs.List>
    </Tabs.Root>

    {#if topView === "stats"}
        <StatsPanel
            {records}
            {loading}
            heatmapConfig={config.heatmap}
            lang={config.general.language}
            {onStartReview}
            onDayClick={(date) => {
                topView = "records";
                setDayFilter(date);
            }}
        />
    {:else if topView === "bank"}
        <BankPanel {service} {onStartReview} {openFlashcard} lang={config.general.language} />
    {:else}
        <header class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="m-0 flex items-baseline gap-2 text-lg font-semibold">
                {t("history.title")}
                {#if !loading && !loadError}
                    <span class="text-muted-foreground text-sm font-normal tabular-nums"
                        >{t("history.count", String(records.length))}</span
                    >
                {/if}
            </h2>
            <div class="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" data-tap onclick={() => void load()} disabled={loading}>
                    <RefreshCwIcon aria-hidden="true" />
                    {t("common.refresh")}
                </Button>
                <DropdownMenu.Root>
                    <DropdownMenu.Trigger>
                        {#snippet child({ props })}
                            <Button {...props} variant="outline" size="sm" data-tap disabled={filtered.length === 0}>
                                {t("history.export")}
                            </Button>
                        {/snippet}
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content align="end">
                        <DropdownMenu.Item onclick={() => exportAs("json")}>{t("history.exportJson")}</DropdownMenu.Item
                        >
                        <DropdownMenu.Item onclick={() => exportAs("csv")}>{t("history.exportCsv")}</DropdownMenu.Item>
                        <DropdownMenu.Item onclick={() => exportAs("markdown")}
                            >{t("history.exportMarkdown")}</DropdownMenu.Item
                        >
                    </DropdownMenu.Content>
                </DropdownMenu.Root>
            </div>
        </header>

        {#if loading}
            <div class="flex flex-col gap-2">
                {#each [0, 1, 2, 3] as i (i)}
                    <Skeleton class="h-14" />
                {/each}
            </div>
        {:else if loadError}
            <Empty.Root class="border-border min-h-40 rounded-lg border">
                <Empty.Header>
                    <Empty.Title>{t("history.loadFailed", loadError)}</Empty.Title>
                </Empty.Header>
                <Empty.Content>
                    <Button variant="outline" size="sm" data-tap onclick={() => void load()}>{t("common.retry")}</Button
                    >
                </Empty.Content>
            </Empty.Root>
        {:else if records.length === 0}
            <Empty.Root class="border-border min-h-40 rounded-lg border">
                <Empty.Header>
                    <Empty.Media variant="icon"><ClipboardListIcon aria-hidden="true" /></Empty.Media>
                    <Empty.Title>{t("history.empty")}</Empty.Title>
                </Empty.Header>
            </Empty.Root>
        {:else}
            <!-- 四格汇总：口径跟随当前筛选 -->
            <dl class="grid grid-cols-2 gap-2 @xl:grid-cols-4">
                {#each [{ label: t("history.summaryCount"), value: String(summary.count) }, { label: t("history.summaryAvg"), value: summary.avg === null ? "—" : summary.avg.toFixed(1) }, { label: t("history.summaryPassRate"), value: summary.passRate === null ? "—" : `${Math.round(summary.passRate)}%` }, { label: t("history.summaryPerQuestion"), value: summary.perQuestion === null ? "—" : `${Math.round(summary.perQuestion)}s` }] as kpi (kpi.label)}
                    <div class="bg-muted/40 flex flex-col gap-1 rounded-lg border px-3 py-2.5">
                        <dt class="text-muted-foreground text-xs">{kpi.label}</dt>
                        <dd class="text-xl leading-none font-semibold tabular-nums">{kpi.value}</dd>
                    </div>
                {/each}
            </dl>

            <!-- 筛选：搜索、分数区间、从热力图带过来的日期 -->
            <div class="flex flex-wrap items-center gap-2">
                <Input
                    class="h-8 w-full @xl:w-56"
                    placeholder={t("history.searchPlaceholder")}
                    aria-label={t("history.searchPlaceholder")}
                    value={query}
                    oninput={(e) => setQuery(e.currentTarget.value)}
                />
                <ToggleGroup.Root
                    type="single"
                    variant="outline"
                    size="sm"
                    value={scoreFilter}
                    onValueChange={setScoreFilter}
                    aria-label={t("history.filterScore")}
                >
                    {#each SCORE_FILTERS as option (option.value)}
                        <ToggleGroup.Item
                            value={option.value}
                            class={cn("tabular-nums", SEGMENT_ON)}
                            aria-label={t(`history.filter_${option.value}`)}
                            title={t(`history.filter_${option.value}`)}>{option.label}</ToggleGroup.Item
                        >
                    {/each}
                </ToggleGroup.Root>
                {#if dayFilter}
                    <Button
                        variant="outline"
                        size="sm"
                        data-tap
                        class="border-primary text-primary hover:bg-primary/10 gap-1 tabular-nums"
                        onclick={() => setDayFilter(null)}
                        title={t("history.clearDayFilter")}
                        aria-label={`${dayFilter} · ${t("history.clearDayFilter")}`}
                    >
                        <CalendarIcon aria-hidden="true" />
                        {dayFilter}
                        <XIcon aria-hidden="true" />
                    </Button>
                {/if}
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
                <ToggleGroup.Root
                    type="single"
                    variant="outline"
                    size="sm"
                    value={groupBy}
                    onValueChange={setGroupBy}
                    aria-label={t("history.groupBy")}
                >
                    <ToggleGroup.Item value="date" class={SEGMENT_ON}>{t("history.byDate")}</ToggleGroup.Item>
                    <ToggleGroup.Item value="source" class={SEGMENT_ON}>{t("history.bySource")}</ToggleGroup.Item>
                </ToggleGroup.Root>
                <ToggleGroup.Root
                    type="single"
                    variant="outline"
                    size="sm"
                    value={viewMode}
                    onValueChange={setViewMode}
                    aria-label={t("history.viewMode")}
                >
                    <ToggleGroup.Item value="list" class={SEGMENT_ON}>{t("history.list")}</ToggleGroup.Item>
                    <ToggleGroup.Item value="cards" class={SEGMENT_ON}>{t("history.cards")}</ToggleGroup.Item>
                    <ToggleGroup.Item value="table" class={SEGMENT_ON}>{t("history.table")}</ToggleGroup.Item>
                </ToggleGroup.Root>
            </div>

            {#if filtered.length === 0}
                <Empty.Root class="border-border min-h-40 rounded-lg border">
                    <Empty.Header>
                        <Empty.Media variant="icon"><SearchXIcon aria-hidden="true" /></Empty.Media>
                        <Empty.Title>{t("history.noMatch")}</Empty.Title>
                    </Empty.Header>
                    <Empty.Content>
                        <Button variant="outline" size="sm" data-tap onclick={clearFilters}
                            >{t("history.clearFilters")}</Button
                        >
                    </Empty.Content>
                </Empty.Root>
            {:else if viewMode === "list"}
                {#each limited.groups as group (group.key)}
                    {@const meta = groupMeta.get(group.key)}
                    <section class="flex flex-col gap-1.5">
                        <h3 class="text-muted-foreground m-0 flex items-center gap-2 text-xs font-semibold">
                            <span class="text-foreground truncate" title={groupTitle(group)}>{groupTitle(group)}</span>
                            <span class="shrink-0 font-normal tabular-nums"
                                >{t(
                                    "history.groupSummary",
                                    String(meta?.count ?? 0),
                                    (meta?.avg ?? 0).toFixed(0)
                                )}</span
                            >
                            <span class="bg-border h-px flex-1"></span>
                        </h3>
                        <div class="flex flex-col gap-1">
                            {#each group.items as row, i (row.entry.id)}
                                <Item.Root
                                    variant="muted"
                                    size="xs"
                                    class="animate-in fade-in-0 [animation-fill-mode:backwards] duration-200"
                                    style="animation-delay: {Math.min(i, 10) * 30}ms"
                                >
                                    <Item.Media variant="icon" class="w-10 shrink-0 justify-end bg-transparent">
                                        <span class={cn("text-lg font-bold tabular-nums", scoreText(row.percent))}
                                            >{row.percent.toFixed(0)}</span
                                        >
                                    </Item.Media>
                                    <Item.Content class="min-w-0">
                                        <Item.Title class="w-full min-w-0 text-sm">
                                            <Button
                                                variant="link"
                                                class="h-auto max-w-full justify-start px-0 text-left"
                                                onclick={() => onOpenReview(row.entry)}
                                            >
                                                <span class="truncate">{row.entry.title}</span>
                                            </Button>
                                        </Item.Title>
                                        <Item.Description class="text-2xs truncate">
                                            {metaLine(row.entry, groupBy === "source")}
                                        </Item.Description>
                                    </Item.Content>
                                    <Item.Actions>{@render rowMenu(row.entry)}</Item.Actions>
                                </Item.Root>
                            {/each}
                        </div>
                    </section>
                {/each}
            {:else if viewMode === "cards"}
                <div class="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-3">
                    {#each flatRows as row, i (row.entry.id)}
                        <Card.Root
                            class="group relative overflow-hidden transition-shadow focus-within:shadow-rg-md hover:shadow-rg-md animate-in fade-in-0 slide-in-from-bottom-1 [animation-fill-mode:backwards] duration-200"
                            style="animation-delay: {Math.min(i, 10) * 30}ms"
                        >
                            <Button
                                variant="ghost"
                                class="hover:bg-transparent h-auto w-full flex-col items-stretch gap-2 p-4 text-left whitespace-normal"
                                aria-label={t("history.reviewOf", row.entry.title)}
                                onclick={() => onOpenReview(row.entry)}
                            >
                                <div class="flex items-baseline gap-2 pr-7">
                                    <span
                                        class={cn(
                                            "text-2xl leading-none font-bold tabular-nums",
                                            scoreText(row.percent)
                                        )}>{row.percent.toFixed(0)}</span
                                    >
                                    <span class="text-muted-foreground text-xs">{t("history.pts")}</span>
                                    <span class="text-muted-foreground ml-auto text-2xs">
                                        {row.percent >= PASS_SCORE ? t("result.passed") : t("result.notPassed")}
                                    </span>
                                </div>
                                <div class="min-w-0">
                                    <div class="line-clamp-2 text-sm font-medium" title={row.entry.title}>
                                        {row.entry.title}
                                    </div>
                                    <div class="text-muted-foreground mt-0.5 text-xs">{metaLine(row.entry, true)}</div>
                                </div>
                                <Progress
                                    value={row.percent}
                                    class={cn("mt-0.5 h-1.5", scoreBar(row.percent))}
                                    aria-hidden="true"
                                />
                            </Button>
                            <div class="absolute top-1.5 right-1.5 z-10">{@render rowMenu(row.entry)}</div>
                        </Card.Root>
                    {/each}
                </div>
            {:else}
                <!-- 一张表、分组用整行标题隔开：每组各一张表时列宽对不齐 -->
                <Table.Root>
                    <Table.Header>
                        <Table.Row>
                            <Table.Head class="w-1/2">{t("history.colTitle")}</Table.Head>
                            <Table.Head class="w-32 text-right">{t("history.colScore")}</Table.Head>
                            <Table.Head class="w-16 text-right">{t("history.colCount")}</Table.Head>
                            <Table.Head class="w-24 text-right">{t("history.colTime")}</Table.Head>
                            <Table.Head class="w-10"><span class="sr-only">{t("history.moreActions")}</span></Table.Head
                            >
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {#each limited.groups as group (group.key)}
                            {@const meta = groupMeta.get(group.key)}
                            <Table.Row class="hover:bg-transparent">
                                <Table.Cell
                                    colspan={5}
                                    class="text-muted-foreground bg-muted/40 py-1.5 text-xs font-semibold"
                                >
                                    <span class="text-foreground">{groupTitle(group)}</span>
                                    <span class="ml-2 font-normal tabular-nums"
                                        >{t(
                                            "history.groupSummary",
                                            String(meta?.count ?? 0),
                                            (meta?.avg ?? 0).toFixed(0)
                                        )}</span
                                    >
                                </Table.Cell>
                            </Table.Row>
                            {#each group.items as row (row.entry.id)}
                                <Table.Row class="animate-in fade-in-0 duration-200">
                                    <Table.Cell class="max-w-0">
                                        <Button
                                            variant="link"
                                            class="h-auto max-w-full justify-start px-0"
                                            onclick={() => onOpenReview(row.entry)}
                                        >
                                            <span class="truncate">{row.entry.title}</span>
                                        </Button>
                                    </Table.Cell>
                                    <Table.Cell>
                                        <div class="flex items-center justify-end gap-2">
                                            <Progress
                                                value={row.percent}
                                                class={cn("h-1.5 w-16", scoreBar(row.percent))}
                                                aria-hidden="true"
                                            />
                                            <span
                                                class={cn(
                                                    "w-10 text-right font-semibold tabular-nums",
                                                    scoreText(row.percent)
                                                )}>{row.percent.toFixed(0)}%</span
                                            >
                                        </div>
                                    </Table.Cell>
                                    <Table.Cell class="text-right tabular-nums">{row.entry.questionCount}</Table.Cell>
                                    <Table.Cell class="text-muted-foreground text-right text-xs tabular-nums">
                                        {groupBy === "date"
                                            ? clock(row.entry.timestamp)
                                            : dateTime(row.entry.timestamp)}
                                    </Table.Cell>
                                    <Table.Cell>{@render rowMenu(row.entry)}</Table.Cell>
                                </Table.Row>
                            {/each}
                        {/each}
                    </Table.Body>
                </Table.Root>
            {/if}

            {#if limited.remaining > 0}
                <div bind:this={sentinel} class="flex flex-col items-center gap-2 py-2">
                    <Button
                        variant="outline"
                        size="sm"
                        data-tap
                        onclick={() => (visible = nextLimit(visible, filtered.length))}
                    >
                        {t("history.loadMore", String(limited.remaining))}
                    </Button>
                    <span class="text-muted-foreground text-xs tabular-nums">
                        {t("history.showingCount", String(limited.shown), String(filtered.length))}
                    </span>
                </div>
            {/if}
        {/if}
    {/if}
</div>

<!-- 删除确认框整页共用一个，记录很多时不必每行各挂一套 -->
<AlertDialog.Root bind:open={deleteOpen}>
    <AlertDialog.Content>
        <AlertDialog.Header>
            <AlertDialog.Title>{t("history.deleteOne")}</AlertDialog.Title>
            <AlertDialog.Description>{t("history.deleteConfirm", deleteTarget?.title ?? "")}</AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
            <AlertDialog.Cancel>{t("common.cancel")}</AlertDialog.Cancel>
            <AlertDialog.Action variant="destructive" onclick={() => void confirmDelete()}>
                {t("common.delete")}
            </AlertDialog.Action>
        </AlertDialog.Footer>
    </AlertDialog.Content>
</AlertDialog.Root>
