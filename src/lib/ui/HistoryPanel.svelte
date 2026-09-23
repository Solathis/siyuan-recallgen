<script lang="ts">
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import { Button } from "@/lib/components/ui/button";
    import * as AlertDialog from "@/lib/components/ui/alert-dialog";
    import * as Card from "@/lib/components/ui/card";
    import * as DropdownMenu from "@/lib/components/ui/dropdown-menu";
    import { Input } from "@/lib/components/ui/input";
    import * as Select from "@/lib/components/ui/select";
    import { Skeleton } from "@/lib/components/ui/skeleton";
    import StatsPanel from "./StatsPanel.svelte";
    import * as Table from "@/lib/components/ui/table";
    import * as Tabs from "@/lib/components/ui/tabs";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import { EXPORT_EXTENSION, EXPORT_MIME, buildExport, type ExportFormat } from "../quiz/export";
    import { PAGE_SIZE, limitGroups, nextLimit } from "../quiz/paging";
    import { scorePercent } from "../quiz/stats";
    import type { QuizService } from "../quiz/service";
    import type { ScoreIndexEntry } from "@/types/quiz";

    let { service, onOpenReview }: { service: QuizService; onOpenReview: (entry: ScoreIndexEntry) => void } = $props();

    let records = $state<ScoreIndexEntry[]>([]);
    let loading = $state(true);
    let loadError = $state<string | null>(null);
    let deleting = $state<string | null>(null);
    let query = $state("");
    let groupBy = $state<"date" | "notebook">("date");
    let viewMode = $state<"thumbnail" | "list" | "table">("thumbnail");
    /** 分数区间筛选 */
    let scoreFilter = $state<"all" | "high" | "mid" | "low">("all");
    /** 顶层视图：记录列表 / 学习统计 */
    let topView = $state<"records" | "stats">("records");
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
            const stamp = new Date().toISOString().slice(0, 10);
            const blob = new Blob([content], { type: `${EXPORT_MIME[format]};charset=utf-8` });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `recallgen-scores-${stamp}.${EXPORT_EXTENSION[format]}`;
            a.click();
            // 立即释放，避免长时间占用内存
            URL.revokeObjectURL(url);
            showMessage(t("history.exported", String(filtered.length)), 4000);
        } catch (e) {
            showMessage(t("history.exportFailed", (e as Error).message), 7000, "error");
        }
    }
</script>

<div class="flex flex-col gap-4 p-4">
    <!-- 顶层视图切换：记录列表与学习统计 -->
    <Tabs.Root value={topView} onValueChange={(v) => (topView = v as typeof topView)}>
        <Tabs.List>
            <Tabs.Trigger value="records">{t("history.tabRecords")}</Tabs.Trigger>
            <Tabs.Trigger value="stats">{t("history.tabStats")}</Tabs.Trigger>
        </Tabs.List>
    </Tabs.Root>

    {#if topView === "stats"}
        <StatsPanel {records} {loading} />
    {:else}
        <header class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-lg font-semibold">{t("history.title")}</h2>
            <div class="flex flex-wrap items-center gap-2">
                <Input
                    class="h-8 w-44"
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
                <Button variant="outline" size="sm" onclick={() => void load()} disabled={loading}>
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
            <div class="text-muted-foreground py-12 text-center text-sm">{t("history.empty")}</div>
        {:else if filtered.length === 0}
            <div class="text-muted-foreground py-12 text-center text-sm">{t("history.noMatch")}</div>
        {:else}
            {#each limited.groups as group (group.key)}
                <section class="flex flex-col gap-2">
                    <h3 class="border-border text-sm font-semibold border-b pb-1">
                        {group.key}
                        <span class="text-muted-foreground font-normal">({group.items.length})</span>
                    </h3>

                    {#if viewMode === "thumbnail"}
                        <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
                            {#each group.items as r (r.id)}
                                {@const p = scorePercent(r)}
                                <Card.Root class="group relative overflow-hidden">
                                    <Card.Content class="flex flex-col gap-2 pt-4">
                                        <div class="flex items-baseline gap-3">
                                            <span class={cn("text-2xl font-bold", scoreClass(p))}>{p.toFixed(0)}</span>
                                            <span class="text-muted-foreground text-xs">{t("history.pts")}</span>
                                        </div>
                                        <div class="min-w-0">
                                            <div class="truncate text-sm font-medium" title={r.title}>{r.title}</div>
                                            <div class="text-muted-foreground text-xs">
                                                {t("result.qCount", String(r.questionCount))} · {timeStr(r.timestamp)}
                                            </div>
                                        </div>
                                        <div class="bg-muted h-1 w-full overflow-hidden rounded-full">
                                            <div
                                                class={cn(
                                                    "h-full rounded-full",
                                                    p >= 60 ? "bg-success" : "bg-destructive"
                                                )}
                                                style="width: {Math.min(100, Math.max(0, p))}%"
                                            ></div>
                                        </div>
                                        <div class="flex gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                class="flex-1"
                                                onclick={() => onOpenReview(r)}>{t("history.review")}</Button
                                            >
                                            <AlertDialog.Root>
                                                <AlertDialog.Trigger>
                                                    {#snippet child({ props })}
                                                        <Button
                                                            {...props}
                                                            variant="ghost"
                                                            size="sm"
                                                            disabled={deleting === r.id}
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
                                    </Card.Content>
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
                                    <span class="text-muted-foreground shrink-0 text-xs">{timeStr(r.timestamp)}</span>
                                    <AlertDialog.Root>
                                        <AlertDialog.Trigger>
                                            {#snippet child({ props })}
                                                <Button
                                                    {...props}
                                                    variant="ghost"
                                                    size="sm"
                                                    disabled={deleting === r.id}>✕</Button
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
                                            {timeStr(r.timestamp)}
                                        </Table.Cell>
                                        <Table.Cell>
                                            <AlertDialog.Root>
                                                <AlertDialog.Trigger>
                                                    {#snippet child({ props })}
                                                        <Button
                                                            {...props}
                                                            variant="ghost"
                                                            size="sm"
                                                            disabled={deleting === r.id}
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
