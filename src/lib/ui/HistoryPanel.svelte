<script lang="ts">
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import { Button } from "@/lib/components/ui/button";
    import * as AlertDialog from "@/lib/components/ui/alert-dialog";
    import * as Card from "@/lib/components/ui/card";
    import * as DropdownMenu from "@/lib/components/ui/dropdown-menu";
    import { Input } from "@/lib/components/ui/input";
    import { Progress } from "@/lib/components/ui/progress";
    import * as Select from "@/lib/components/ui/select";
    import { Skeleton } from "@/lib/components/ui/skeleton";
    import BankPanel from "./BankPanel.svelte";
    import StatsPanel from "./StatsPanel.svelte";
    import * as Table from "@/lib/components/ui/table";
    import * as Tabs from "@/lib/components/ui/tabs";
    import * as Empty from "@/lib/components/ui/empty";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import { dayKey } from "../quiz/charts";
    import { downloadText, exportStamp } from "./download";
    import { EXPORT_EXTENSION, EXPORT_MIME, buildExport, type ExportFormat } from "../quiz/export";
    import { PAGE_SIZE, limitGroups, nextLimit } from "../quiz/paging";
    import { PASS_SCORE, scorePercent } from "../quiz/stats";
    import type { QuizService } from "../quiz/service";
    import type { QuestionType, ScoreIndexEntry, Difficulty } from "@/types/quiz";

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

    let records = $state<ScoreIndexEntry[]>([]);
    let loading = $state(true);
    /** 热力图需要配色配置与输出语言，跟随配置变化；初值经函数读取以避免捕获警告 */
    function initialConfig() {
        return service.getConfig();
    }
    let config = $state(initialConfig());
    $effect(() => service.subscribeConfig((next) => (config = next)));
    let loadError = $state<string | null>(null);
    let deleting = $state<string | null>(null);
    let query = $state("");
    let groupBy = $state<"date" | "notebook">("date");
    let viewMode = $state<"thumbnail" | "list" | "table">("thumbnail");
    /** 分数区间筛选 */
    let scoreFilter = $state<"all" | "high" | "mid" | "low">("all");
    /** 顶层视图：记录列表 / 学习统计 */
    let topView = $state<"records" | "stats" | "bank">("records");
    /** 从热力图点某一天跳过来时，筛选出该天的成绩；null 表示不限日期 */
    let dayFilter = $state<string | null>(null);

    function clearDayFilter(): void {
        dayFilter = null;
    }
    /**
     * 已渲染条数上界。
     * 记录很多时一次性渲染全部条目会创建大量 DOM，这里分段渲染并触底加载。
     */
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

    const filtered = $derived.by(() => {
        const q = query.trim().toLowerCase();
        return records.filter((r) => {
            if (dayFilter && dayKey(r.timestamp) !== dayFilter) return false;
            if (q && !`${r.title} ${r.sourceTitle ?? ""}`.toLowerCase().includes(q)) return false;
            const p = scorePercent(r);
            if (scoreFilter === "high" && p < 80) return false;
            if (scoreFilter === "mid" && (p < 60 || p >= 80)) return false;
            if (scoreFilter === "low" && p >= 60) return false;
            return true;
        });
    });

    /** 按日期或来源分组，保持录入顺序（列表本身已按时间倒序） */
    const grouped = $derived.by(() => {
        const map = new Map<string, ScoreIndexEntry[]>();
        for (const r of filtered) {
            let key: string;
            if (groupBy === "date") {
                const d = new Date(r.timestamp);
                key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            } else {
                // 原先来源为空时错用「未作答」当兜底文案，语义不符
                key =
                    r.sourceTitle?.replace(/·.*$/, "").trim() ||
                    r.title.replace(/·.*$/, "").trim() ||
                    t("history.noSource");
            }
            const items = map.get(key);
            if (items) items.push(r);
            else map.set(key, [r]);
        }
        return [...map.entries()].map(([key, items]) => ({ key, items }));
    });

    /** 截断后的分组与剩余条数 */
    const limited = $derived(limitGroups(grouped, visible));

    /**
     * 概览数字。
     *
     * 原页面只有一串分组卡片，用户想知道「这段时间练得怎么样」得自己一张张看分数；
     * 数据本来就在手上，先用一排数字说清总量、平均水平与达标次数更直接。
     * 口径跟随当前筛选：筛了「60 分以下」时这排数字也应当只反映筛出来的那批。
     */
    const summary = $derived.by(() => {
        if (filtered.length === 0) return null;
        const percents = filtered.map((entry) => scorePercent(entry));
        const sum = percents.reduce((acc, p) => acc + p, 0);
        return {
            count: percents.length,
            avg: sum / percents.length,
            best: Math.max(...percents),
            passed: percents.filter((p) => p >= PASS_SCORE).length,
        };
    });

    /** 搜索或筛选变化时回到第一批，避免沿用上一次的展开量 */
    $effect(() => {
        void query;
        void scoreFilter;
        visible = PAGE_SIZE;
    });

    // 触底自动加载下一批；同时也提供按钮，保证无 IntersectionObserver 时仍可用
    $effect(() => {
        const element = sentinel;
        if (!element || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting) && limited.remaining > 0) {
                visible = nextLimit(visible, filtered.length);
            }
        });
        observer.observe(element);
        return () => observer.disconnect();
    });

    function timeStr(ts: number): string {
        const d = new Date(ts);
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }

    /**
     * 行内时间文案。
     *
     * 按日期分组时组标题已经写了日期，行内只需时刻；
     * 按来源分组时组标题是「第三章」这类文档名，**没有日期**——
     * 原先行内仍然只显示「11:24」，于是完全看不出这条记录是哪天做的。
     */
    function timeLabel(entry: ScoreIndexEntry): string {
        const time = timeStr(entry.timestamp);
        if (groupBy === "date") return time;
        const d = new Date(entry.timestamp);
        const date = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return d.getFullYear() === new Date().getFullYear() ? `${date} ${time}` : `${d.getFullYear()}-${date} ${time}`;
    }

    /** 分数配色：全部走主题语义色，避免硬编码在暗色主题下不可读 */
    function scoreClass(p: number): string {
        if (p >= 80) return "text-success";
        if (p >= 60) return "text-primary";
        if (p >= 30) return "text-warning";
        return "text-destructive";
    }

    async function remove(entry: ScoreIndexEntry) {
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
    function exportAs(format: ExportFormat) {
        try {
            const content = buildExport(filtered, format, t("history.title"));
            downloadText(`recallgen-scores-${exportStamp()}.${EXPORT_EXTENSION[format]}`, content, EXPORT_MIME[format]);
            showMessage(t("history.exported", String(filtered.length)), 4000);
        } catch (e) {
            showMessage(t("history.exportFailed", (e as Error).message), 7000, "error");
        }
    }
</script>

<div class="@container flex flex-col gap-4 p-4">
    <!-- 顶层视图切换：记录列表与学习统计 -->
    <Tabs.Root value={topView} onValueChange={(v) => (topView = v as typeof topView)}>
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
                dayFilter = date;
            }}
        />
    {:else if topView === "bank"}
        <BankPanel {service} {onStartReview} {openFlashcard} lang={config.general.language} />
    {:else}
        <!--
            顶栏拆成两行：第一行标题与次要操作，第二行搜索与筛选。
            原实现把标题、日期筛选片、搜索框、分数下拉、刷新、导出全塞进一个
            flex-wrap 行，面板一窄就折成三层且每层长度不一，看着像没排版。
        -->
        <header class="flex flex-col gap-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h2 class="text-lg font-semibold">{t("history.title")}</h2>
                <div class="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" onclick={() => void load()} disabled={loading}>
                        {t("common.refresh")}
                    </Button>
                    <DropdownMenu.Root>
                        <DropdownMenu.Trigger>
                            {#snippet child({ props })}
                                <Button {...props} variant="outline" size="sm" disabled={filtered.length === 0}>
                                    {t("history.export")}
                                </Button>
                            {/snippet}
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Content align="end">
                            <DropdownMenu.Item onclick={() => exportAs("json")}
                                >{t("history.exportJson")}</DropdownMenu.Item
                            >
                            <DropdownMenu.Item onclick={() => exportAs("csv")}
                                >{t("history.exportCsv")}</DropdownMenu.Item
                            >
                            <DropdownMenu.Item onclick={() => exportAs("markdown")}
                                >{t("history.exportMarkdown")}</DropdownMenu.Item
                            >
                        </DropdownMenu.Content>
                    </DropdownMenu.Root>
                </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
                {#if dayFilter}
                    <Button
                        variant="outline"
                        size="sm"
                        class="border-primary text-primary hover:bg-primary/10 gap-1 text-xs"
                        onclick={clearDayFilter}
                        title={t("history.clearDayFilter")}
                    >
                        📅 {dayFilter} ✕
                    </Button>
                {/if}
                <Input
                    class="h-8 w-full @xl:w-56"
                    placeholder={t("history.searchPlaceholder")}
                    aria-label={t("history.searchPlaceholder")}
                    bind:value={query}
                />
                <Select.Root
                    type="single"
                    value={scoreFilter}
                    onValueChange={(v) => (scoreFilter = v as typeof scoreFilter)}
                >
                    <Select.Trigger class="h-8 w-28" aria-label={t("history.filterScore")}>
                        {t(`history.filter_${scoreFilter}`)}
                    </Select.Trigger>
                    <Select.Content>
                        <Select.Item value="all">{t("history.filter_all")}</Select.Item>
                        <Select.Item value="high">{t("history.filter_high")}</Select.Item>
                        <Select.Item value="mid">{t("history.filter_mid")}</Select.Item>
                        <Select.Item value="low">{t("history.filter_low")}</Select.Item>
                    </Select.Content>
                </Select.Root>
            </div>
        </header>

        <!-- 分组与视图切换 -->
        <div class="flex flex-wrap items-center justify-between gap-3">
            <Tabs.Root value={groupBy} onValueChange={(v) => (groupBy = v as typeof groupBy)}>
                <Tabs.List>
                    <Tabs.Trigger value="date">{t("history.byDate")}</Tabs.Trigger>
                    <Tabs.Trigger value="notebook">{t("history.bySource")}</Tabs.Trigger>
                </Tabs.List>
            </Tabs.Root>
            <Tabs.Root value={viewMode} onValueChange={(v) => (viewMode = v as typeof viewMode)}>
                <Tabs.List>
                    <Tabs.Trigger value="thumbnail">{t("history.thumb")}</Tabs.Trigger>
                    <Tabs.Trigger value="list">{t("history.list")}</Tabs.Trigger>
                    <Tabs.Trigger value="table">{t("history.table")}</Tabs.Trigger>
                </Tabs.List>
            </Tabs.Root>
        </div>

        {#if loading}
            <div class="flex flex-col gap-2">
                {#each [0, 1, 2] as i (i)}
                    <Skeleton class="h-16 w-full" />
                {/each}
            </div>
        {:else if loadError}
            <Card.Root>
                <Card.Content class="flex flex-col items-start gap-2 pt-4">
                    <p class="text-destructive text-sm">{t("history.loadFailed", loadError)}</p>
                    <Button variant="outline" size="sm" onclick={() => void load()}>{t("common.retry")}</Button>
                </Card.Content>
            </Card.Root>
        {:else if records.length === 0}
            <Empty.Root class="min-h-40">
                <Empty.Header>
                    <Empty.Media variant="icon">🗂</Empty.Media>
                    <Empty.Title>{t("history.empty")}</Empty.Title>
                </Empty.Header>
            </Empty.Root>
        {:else if filtered.length === 0}
            <Empty.Root class="min-h-40">
                <Empty.Header>
                    <Empty.Media variant="icon">🔍</Empty.Media>
                    <Empty.Title>{t("history.noMatch")}</Empty.Title>
                </Empty.Header>
            </Empty.Root>
        {:else}
            <!-- 概览：先用一排数字说清「这段时间练得怎么样」，不必一张张卡片去数 -->
            {#if summary}
                <dl class="border-border grid grid-cols-2 gap-x-5 gap-y-3 rounded-lg border px-4 py-3 @xl:grid-cols-4">
                    <div class="flex flex-col gap-0.5">
                        <dt class="text-muted-foreground text-xs">{t("history.summaryCount")}</dt>
                        <dd class="text-lg leading-none font-semibold tabular-nums">{summary.count}</dd>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <dt class="text-muted-foreground text-xs">{t("history.summaryAvg")}</dt>
                        <dd class="text-lg leading-none font-semibold tabular-nums">
                            {summary.avg.toFixed(1)}
                        </dd>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <dt class="text-muted-foreground text-xs">{t("history.summaryBest")}</dt>
                        <dd class="text-lg leading-none font-semibold tabular-nums">{summary.best.toFixed(0)}</dd>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <dt class="text-muted-foreground text-xs">{t("history.summaryPassed")}</dt>
                        <dd class="text-lg leading-none font-semibold tabular-nums">{summary.passed}</dd>
                    </div>
                </dl>
            {/if}

            {#each limited.groups as group (group.key)}
                <section class="flex flex-col gap-2">
                    <h3 class="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wide">
                        <span class="text-foreground">{group.key}</span>
                        <span class="bg-muted rounded-full px-1.5 py-0.5 text-2xs tabular-nums"
                            >{group.items.length}</span
                        >
                        <span class="bg-border h-px flex-1"></span>
                    </h3>

                    {#if viewMode === "thumbnail"}
                        <div class="grid grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-3">
                            {#each group.items as r, i (r.id)}
                                {@const p = scorePercent(r)}
                                <!--
                                    整张卡片即入口。
                                    原实现把「查看」做成卡片里一个整行按钮，删除又并排放在它右边：
                                    一张 200px 宽的卡里最显眼的东西是两个操作按钮，信息反而被压成配角。
                                    现在卡片本身可点开回看，删除退到右上角的小图标（触屏没有 hover，
                                    所以不做「悬停才出现」）。
                                -->
                                <Card.Root
                                    class="group relative overflow-hidden transition-shadow focus-within:shadow-rg-md hover:shadow-rg-md animate-in fade-in-0 slide-in-from-bottom-1 [animation-fill-mode:backwards] duration-200"
                                    style="animation-delay: {Math.min(i, 10) * 30}ms"
                                >
                                    <Button
                                        variant="ghost"
                                        class="hover:bg-transparent h-auto w-full flex-col items-stretch gap-2 p-4 text-left whitespace-normal"
                                        aria-label={`${t("history.review")}：${r.title}`}
                                        onclick={() => onOpenReview(r)}
                                    >
                                        <div class="flex items-baseline gap-2 pr-6">
                                            <span
                                                class={cn(
                                                    "text-2xl leading-none font-bold tabular-nums",
                                                    scoreClass(p)
                                                )}>{p.toFixed(0)}</span
                                            >
                                            <span class="text-muted-foreground text-xs">{t("history.pts")}</span>
                                            <span class="text-muted-foreground ml-auto text-2xs tabular-nums">
                                                {p >= PASS_SCORE ? t("result.passed") : t("result.notPassed")}
                                            </span>
                                        </div>
                                        <div class="min-w-0">
                                            <div class="line-clamp-2 text-sm font-medium" title={r.title}>
                                                {r.title}
                                            </div>
                                            <div class="text-muted-foreground mt-0.5 text-xs">
                                                {t("result.qCount", String(r.questionCount))} · {timeLabel(r)}
                                            </div>
                                        </div>
                                        <Progress
                                            value={p}
                                            class={cn(
                                                "mt-0.5 h-1.5",
                                                p >= PASS_SCORE
                                                    ? "[&>[data-slot=progress-indicator]]:bg-success"
                                                    : "[&>[data-slot=progress-indicator]]:bg-destructive"
                                            )}
                                            aria-hidden="true"
                                        />
                                    </Button>

                                    <div class="absolute top-1.5 right-1.5 z-10">
                                        <AlertDialog.Root>
                                            <AlertDialog.Trigger>
                                                {#snippet child({ props })}
                                                    <!--
                                                        aria-label / title 必须写在开始标签里：
                                                        放在标签之后会被当成文本渲染出来，
                                                        页面上会直接出现「aria-label=删除 title=删除」。
                                                    -->
                                                    <Button
                                                        {...props}
                                                        variant="ghost"
                                                        size="icon-xs"
                                                        class="opacity-70 hover:opacity-100"
                                                        disabled={deleting === r.id}
                                                        aria-label={t("common.delete")}
                                                        title={t("common.delete")}
                                                    >
                                                        ✕
                                                    </Button>
                                                {/snippet}
                                            </AlertDialog.Trigger>
                                            <AlertDialog.Content>
                                                <AlertDialog.Header>
                                                    <AlertDialog.Title>{t("history.deleteOne")}</AlertDialog.Title>
                                                    <AlertDialog.Description>
                                                        {t("history.deleteConfirm", r.title)}
                                                    </AlertDialog.Description>
                                                </AlertDialog.Header>
                                                <AlertDialog.Footer>
                                                    <AlertDialog.Cancel>{t("common.cancel")}</AlertDialog.Cancel>
                                                    <AlertDialog.Action
                                                        variant="destructive"
                                                        onclick={() => void remove(r)}
                                                    >
                                                        {t("common.delete")}
                                                    </AlertDialog.Action>
                                                </AlertDialog.Footer>
                                            </AlertDialog.Content>
                                        </AlertDialog.Root>
                                    </div>
                                </Card.Root>
                            {/each}
                        </div>
                    {:else if viewMode === "list"}
                        <div class="flex flex-col gap-1">
                            {#each group.items as r (r.id)}
                                {@const p = scorePercent(r)}
                                <div class="hover:bg-accent flex items-center gap-3 rounded-md px-2 py-2">
                                    <span class={cn("w-10 shrink-0 text-right text-lg font-bold", scoreClass(p))}>
                                        {p.toFixed(0)}
                                    </span>
                                    <Button
                                        variant="link"
                                        class="min-w-0 flex-1 justify-start px-0 text-left"
                                        onclick={() => onOpenReview(r)}
                                    >
                                        <span class="truncate">{r.title}</span>
                                    </Button>
                                    <span class="text-muted-foreground shrink-0 text-xs"
                                        >{t("result.qCount", String(r.questionCount))}</span
                                    >
                                    <span class="text-muted-foreground shrink-0 text-xs">{timeLabel(r)}</span>
                                    <AlertDialog.Root>
                                        <AlertDialog.Trigger>
                                            {#snippet child({ props })}
                                                <!-- 列表视图原先没给图标按钮任何可访问名称 -->
                                                <Button
                                                    {...props}
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={deleting === r.id}
                                                    aria-label={t("common.delete")}
                                                    title={t("common.delete")}>✕</Button
                                                >
                                            {/snippet}
                                        </AlertDialog.Trigger>
                                        <AlertDialog.Content>
                                            <AlertDialog.Header>
                                                <AlertDialog.Title>{t("history.deleteOne")}</AlertDialog.Title>
                                                <AlertDialog.Description
                                                    >{t("history.deleteConfirm", r.title)}</AlertDialog.Description
                                                >
                                            </AlertDialog.Header>
                                            <AlertDialog.Footer>
                                                <AlertDialog.Cancel>{t("common.cancel")}</AlertDialog.Cancel>
                                                <AlertDialog.Action
                                                    variant="destructive"
                                                    onclick={() => void remove(r)}
                                                >
                                                    {t("common.delete")}
                                                </AlertDialog.Action>
                                            </AlertDialog.Footer>
                                        </AlertDialog.Content>
                                    </AlertDialog.Root>
                                </div>
                            {/each}
                        </div>
                    {:else}
                        <Table.Root>
                            <Table.Header>
                                <Table.Row>
                                    <Table.Head>{t("history.colTitle")}</Table.Head>
                                    <Table.Head class="w-20 text-right">{t("history.colScore")}</Table.Head>
                                    <Table.Head class="w-16 text-right">{t("history.colCount")}</Table.Head>
                                    <Table.Head class="w-20 text-right">{t("history.colTime")}</Table.Head>
                                    <Table.Head class="w-24"></Table.Head>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {#each group.items as r (r.id)}
                                    {@const p = scorePercent(r)}
                                    <Table.Row>
                                        <Table.Cell>
                                            <Button
                                                variant="link"
                                                class="h-auto justify-start px-0"
                                                onclick={() => onOpenReview(r)}
                                            >
                                                {r.title}
                                            </Button>
                                        </Table.Cell>
                                        <Table.Cell class={cn("text-right font-semibold", scoreClass(p))}>
                                            {p.toFixed(0)}%
                                        </Table.Cell>
                                        <Table.Cell class="text-right">{r.questionCount}</Table.Cell>
                                        <Table.Cell class="text-muted-foreground text-right text-xs">
                                            {timeLabel(r)}
                                        </Table.Cell>
                                        <Table.Cell>
                                            <AlertDialog.Root>
                                                <AlertDialog.Trigger>
                                                    {#snippet child({ props })}
                                                        <!--
                                                            aria-label / title 必须写在开始标签里：
                                                            放在标签之后会被当成文本渲染出来，
                                                            页面上会直接出现「aria-label=删除 title=删除」。
                                                        -->
                                                        <Button
                                                            {...props}
                                                            variant="ghost"
                                                            size="sm"
                                                            disabled={deleting === r.id}
                                                            aria-label={t("common.delete")}
                                                            title={t("common.delete")}
                                                        >
                                                            ✕
                                                        </Button>
                                                    {/snippet}
                                                </AlertDialog.Trigger>
                                                <AlertDialog.Content>
                                                    <AlertDialog.Header>
                                                        <AlertDialog.Title>{t("history.deleteOne")}</AlertDialog.Title>
                                                        <AlertDialog.Description>
                                                            {t("history.deleteConfirm", r.title)}
                                                        </AlertDialog.Description>
                                                    </AlertDialog.Header>
                                                    <AlertDialog.Footer>
                                                        <AlertDialog.Cancel>{t("common.cancel")}</AlertDialog.Cancel>
                                                        <AlertDialog.Action
                                                            variant="destructive"
                                                            onclick={() => void remove(r)}
                                                        >
                                                            {t("common.delete")}
                                                        </AlertDialog.Action>
                                                    </AlertDialog.Footer>
                                                </AlertDialog.Content>
                                            </AlertDialog.Root>
                                        </Table.Cell>
                                    </Table.Row>
                                {/each}
                            </Table.Body>
                        </Table.Root>
                    {/if}
                </section>
            {/each}

            {#if limited.remaining > 0}
                <!-- 触底自动加载；按钮同时兼顾键盘操作与不支持 IntersectionObserver 的环境 -->
                <div bind:this={sentinel} class="flex flex-col items-center gap-2 py-2">
                    <Button variant="outline" size="sm" onclick={() => (visible = nextLimit(visible, filtered.length))}>
                        {t("history.loadMore", String(limited.remaining))}
                    </Button>
                    <span class="text-muted-foreground text-xs">
                        {t("history.showingCount", String(limited.shown), String(filtered.length))}
                    </span>
                </div>
            {/if}
        {/if}
    {/if}
</div>
