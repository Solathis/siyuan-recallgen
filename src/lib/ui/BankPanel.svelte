<script lang="ts">
    import { confirm, showMessage } from "siyuan";
    import * as AlertDialog from "@/lib/components/ui/alert-dialog";
    import { Badge } from "@/lib/components/ui/badge";
    import { Button } from "@/lib/components/ui/button";
    import { Checkbox } from "@/lib/components/ui/checkbox";
    import { Label } from "@/lib/components/ui/label";
    import * as Card from "@/lib/components/ui/card";
    import * as Collapsible from "@/lib/components/ui/collapsible";
    import * as Empty from "@/lib/components/ui/empty";
    import { Input } from "@/lib/components/ui/input";
    import * as Select from "@/lib/components/ui/select";
    import { Progress } from "@/lib/components/ui/progress";
    import { Skeleton } from "@/lib/components/ui/skeleton";
    import * as Table from "@/lib/components/ui/table";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import { Area, Chart, Layer, Spline } from "layerchart";
    import { ChartContainer } from "@/lib/components/ui/chart";
    import { createClock } from "./clock.svelte";
    import {
        MAX_BANK_HISTORY,
        RECENT_AVG_WINDOW,
        bankTags,
        cardPhase,
        dueState,
        masteryScore,
        recentAverage,
        type BankItem,
    } from "../quiz/bank";
    import { buildAnkiExport } from "../quiz/bank";
    import { nextLimit, PAGE_SIZE } from "../quiz/paging";
    import { downloadText, exportStamp } from "./download";
    import type { QuizService } from "../quiz/service";
    import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
    import type { QuestionType, Difficulty } from "@/types/quiz";

    let {
        service,
        onStartReview = () => {},
        openFlashcard,
        lang = "zh",
    }: {
        service: QuizService;
        /** 打开闪卡复习面板；急训模式下点复习按钮时触发 */
        openFlashcard?: (items: BankItem[]) => void;
        /** 按知识点或题型开始一次复习；由插件层打开新的答题 Tab */
        onStartReview?: (scope: {
            tag?: string;
            type?: QuestionType;
            difficulty?: Difficulty;
            /** 急训模式：忽略排程，全部取出 */
            cram?: boolean;
        }) => void;
        /** 界面语言；由外层传入，service.getConfig() 本身不是响应式的 */
        lang?: "zh" | "en";
    } = $props();

    let items = $state<BankItem[]>([]);
    let loading = $state(true);
    let loadError = $state<string | null>(null);
    let deleting = $state<string | null>(null);
    let query = $state("");
    let filter = $state<"all" | "due" | "weak">("all");
    let typeFilter = $state<string>("all");
    let tagFilter = $state<string>("all");
    let difficultyFilter = $state<string>("all");
    /** 急训模式：忽略 FSRS 排程，把所有匹配的题目全部取出来（考前突击用） */
    let cram = $state(false);
    let visible = $state(PAGE_SIZE);

    async function load() {
        loading = true;
        loadError = null;
        try {
            items = await service.listBank();
        } catch (e) {
            console.error("[RecallGen] 加载题库失败", e);
            loadError = (e as Error).message;
        } finally {
            loading = false;
        }
    }

    $effect(() => {
        void load();
    });

    /** 搜索或筛选变化时回到第一批 */
    $effect(() => {
        void query;
        void filter;
        void typeFilter;
        void tagFilter;
        void difficultyFilter;
        visible = PAGE_SIZE;
    });

    async function doRenameTag(): Promise<void> {
        if (!renamingTag || !renameValue.trim()) {
            renamingTag = null;
            return;
        }
        const count = await service.renameBankTag(renamingTag, renameValue.trim());
        showMessage(t("bank.tagAffected", String(count)), 4000);
        renamingTag = null;
        renameValue = "";
        await load();
    }

    async function doDeleteTag(tag: string): Promise<void> {
        const count = await service.deleteBankTag(tag);
        showMessage(t("bank.tagAffected", String(count)), 4000);
        if (tagFilter === tag) tagFilter = "all";
        await load();
    }

    /** 到期数量与时间相关：读共享时钟，面板长期打开时也会随过期题目更新 */
    const clock = createClock();

    const counts = $derived({
        total: items.length,
        due: items.filter((item) => item.card.due <= clock.now).length,
        weak: items.filter((item) => masteryScore(item) < 60).length,
    });

    const typeOptions = $derived(
        [...new Set(items.map((item) => item.question.type))].sort((a, b) => a.localeCompare(b))
    );

    /** 题库里出现过的知识点标签（按题数倒序），用于筛选与「按知识点复习」 */
    const tagOptions = $derived(bankTags(items));
    /** 标签管理折叠区的展开状态；只用于让箭头翻转，展开本身由 Collapsible 管理 */
    let showTagManage = $state(false);
    /** 正在重命名的标签 */
    let renamingTag = $state<string | null>(null);
    let renameValue = $state("");

    /**
     * 当前筛选能否直接拿去开一次复习：
     * 知识点、题型与难度都是题库的筛选键，而「掌握度」不是。
     * 多个筛选同时生效时按优先级取一个维度（与界面上的紧凑展示一致）。
     */
    const reviewScope = $derived.by<{
        tag?: string;
        type?: QuestionType;
        difficulty?: Difficulty;
        label: string;
    } | null>(() => {
        if (tagFilter !== "all") return { tag: tagFilter, label: t("bank.scopeTag", tagFilter) };
        if (typeFilter !== "all") {
            return { type: typeFilter as QuestionType, label: t("bank.scopeType", typeLabel(typeFilter)) };
        }
        if (difficultyFilter !== "all") {
            const difficulty = difficultyFilter as Difficulty;
            return { difficulty, label: t("bank.scopeDifficulty", t(`diff.${difficulty}`)) };
        }
        return null;
    });

    /** 当前筛选范围内的题目与其中的到期题数 */
    const scopeItems = $derived.by(() => {
        const scope = reviewScope;
        if (!scope) return [];
        return items.filter((item) => {
            if (scope.tag && !(item.question.tags ?? []).includes(scope.tag)) return false;
            if (scope.type && item.question.type !== scope.type) return false;
            if (scope.difficulty && item.question.difficulty !== scope.difficulty) return false;
            return true;
        });
    });
    const scopeDueCount = $derived(scopeItems.filter((item) => item.card.due <= clock.now).length);

    const filtered = $derived.by(() => {
        const keyword = query.trim().toLowerCase();
        // 必须用共享时钟而不是 Date.now()：Date.now() 不是响应式依赖，
        // 派生值只在筛选条件变化时重算，面板开着跨过到期时刻也不会刷新，
        // 会出现「顶部徽标说到期 3 题、点『到期』却只筛出 2 题」。
        const now = clock.now;
        return (
            items
                .filter((item) => {
                    if (keyword && !item.question.question.toLowerCase().includes(keyword)) return false;
                    if (typeFilter !== "all" && item.question.type !== typeFilter) return false;
                    if (tagFilter !== "all" && !(item.question.tags ?? []).includes(tagFilter)) return false;
                    if (difficultyFilter !== "all" && item.question.difficulty !== difficultyFilter) return false;
                    if (filter === "due" && item.card.due > now) return false;
                    if (filter === "weak" && masteryScore(item) >= 60) return false;
                    return true;
                })
                // 越早到期越靠前，便于直接开始复习
                .sort((a, b) => a.card.due - b.card.due)
        );
    });

    const shown = $derived(filtered.slice(0, visible));

    async function remove(item: BankItem) {
        deleting = item.id;
        try {
            await service.removeBankItem(item.id);
            items = items.filter((current) => current.id !== item.id);
            showMessage(t("bank.removed"), 4000);
        } catch (e) {
            console.error("[RecallGen] 删除题库题目失败", e);
            showMessage(t("bank.removeFailed", (e as Error).message), 7000, "error");
        } finally {
            deleting = null;
        }
    }

    /** now 由共享时钟传入：内部再读 Date.now() 会让文本与徽标/筛选的口径脱节 */
    function fmtDue(card: BankItem["card"], now: number): string {
        const state = dueState(card, now);
        if (state === "overdue") return t("bank.dueOverdue");
        if (state === "today") return t("bank.dueToday");
        const days = Math.max(1, Math.round((card.due - now) / 86_400_000));
        return state === "soon" ? t("bank.dueInDays", String(days)) : t("bank.dueLater", String(days));
    }

    /* ── 展开详情：复习历史 ───────────────────────────────────────── */

    /** 同时只展开一行，避免长列表里堆出大量 DOM */
    let expanded = $state<string | null>(null);

    function toggle(id: string) {
        expanded = expanded === id ? null : id;
    }

    function fmtDateTime(ts: number): string {
        return new Date(ts).toLocaleString(lang === "zh" ? "zh-CN" : "en", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    const historyOf = (item: BankItem) => item.history ?? [];
    const historyNewestFirst = (item: BankItem) => [...historyOf(item)].reverse();

    /** 迷你折线的数据：按时间升序的得分率（横轴用序号即可，不需要真实时间比例尺） */
    function sparkPoints(item: BankItem) {
        return historyOf(item).map((attempt, index) => ({ index, percent: attempt.percent }));
    }

    const sparkConfig = { percent: { label: t("bank.detailHistoryChart"), color: "var(--chart-1)" } };

    function phaseLabel(card: BankItem["card"]): string {
        return t(`bank.phase_${cardPhase(card)}`);
    }

    function typeLabel(type: string): string {
        return t(`type.${type}_short`);
    }

    /** 掌握度条的色调：覆盖 Progress 内部指示条的底色 */
    function masteryTone(mastery: number): string {
        if (mastery >= 80) return "[&>[data-slot=progress-indicator]]:bg-success";
        if (mastery >= 60) return "[&>[data-slot=progress-indicator]]:bg-primary";
        if (mastery >= 30) return "[&>[data-slot=progress-indicator]]:bg-warning";
        return "[&>[data-slot=progress-indicator]]:bg-destructive";
    }
</script>

<!--
    题库页。

    结构按 shadcn 的写法重排（不是往旧标记上贴类名）：
    页头 → 概览卡 → 筛选卡 → 到期入口 → 标签管理 → 列表 → 分页。
    每块都是 Card / Field / Collapsible / Table / Empty / Progress / Badge 的组合，
    动效统一走 tw-animate-css 的 animate-in（列表交错必须带 animation-fill-mode:backwards，
    否则带延迟的元素会在延迟期间先完整显示再闪一下）。
-->
<!--
        滚动容器本身是 flex 列，直接子项默认 flex-shrink: 1 ——
        内容比可视区高时它们会被压扁，筛选卡的最后一行（到期入口）就被卡底裁掉。
        因此所有直接子项固定不由内容以外的原因收缩。
    -->
<div class="@container flex h-full flex-col gap-4 overflow-y-auto p-4 *:shrink-0">
    <!-- 页头 -->
    <header class="flex flex-wrap items-end justify-between gap-3">
        <div class="flex flex-col gap-1">
            <h2 class="text-lg font-semibold">{t("bank.pageTitle")}</h2>
            <p class="text-muted-foreground text-sm">{t("bank.pageDesc")}</p>
        </div>
        <div class="flex items-center gap-1.5">
            <Button
                variant="outline"
                size="sm"
                disabled={loading || items.length === 0}
                onclick={() =>
                    downloadText(
                        `recallgen-anki-${exportStamp()}.txt`,
                        buildAnkiExport(items),
                        "text/tab-separated-values"
                    )}
            >
                {t("bank.ankiExport")}
            </Button>
            <Button variant="ghost" size="sm" onclick={() => void load()} disabled={loading}>
                {t("common.refresh")}
            </Button>
        </div>
    </header>

    <!-- 概览：三个数字单独成卡，与统计页同一种读法 -->
    <dl class="grid grid-cols-1 gap-3 @xl:grid-cols-3">
        {#each [{ label: t("bank.statTotal"), value: counts.total, tone: "text-foreground" }, { label: t("bank.statDue"), value: counts.due, tone: counts.due > 0 ? "text-warning" : "text-foreground" }, { label: t("bank.statWeak"), value: counts.weak, tone: counts.weak > 0 ? "text-destructive" : "text-foreground" }] as stat, i (stat.label)}
            <Card.Root
                class="animate-in fade-in-0 slide-in-from-bottom-1 [animation-fill-mode:backwards] duration-200"
                style="animation-delay: {i * 30}ms"
            >
                <Card.Content class="flex flex-col gap-0.5 pt-4">
                    <dt class="text-muted-foreground text-xs">{stat.label}</dt>
                    <dd class={cn("text-xl leading-none font-semibold tabular-nums", stat.tone)}>{stat.value}</dd>
                </Card.Content>
            </Card.Root>
        {/each}
    </dl>

    <!-- 筛选 -->
    <Card.Root>
        <Card.Content class="flex flex-col gap-3 pt-4">
            <div class="flex flex-wrap items-center gap-2">
                <Input
                    class="w-full @xl:w-56"
                    placeholder={t("bank.searchPlaceholder")}
                    aria-label={t("bank.searchPlaceholder")}
                    bind:value={query}
                />
                <Select.Root type="single" value={filter} onValueChange={(v) => (filter = v as typeof filter)}>
                    <Select.Trigger class="w-28" aria-label={t("bank.filterLabel")}>
                        {filter === "all"
                            ? t("bank.filterAll")
                            : filter === "due"
                              ? t("bank.filterDue")
                              : t("bank.filterWeak")}
                    </Select.Trigger>
                    <Select.Content>
                        <Select.Item value="all">{t("bank.filterAll")}</Select.Item>
                        <Select.Item value="due">{t("bank.filterDue")}</Select.Item>
                        <Select.Item value="weak">{t("bank.filterWeak")}</Select.Item>
                    </Select.Content>
                </Select.Root>
                {#if typeOptions.length > 1}
                    <Select.Root type="single" value={typeFilter} onValueChange={(v) => (typeFilter = v)}>
                        <Select.Trigger class="w-28" aria-label={t("bank.filterType")}>
                            {typeFilter === "all" ? t("bank.filterAllTypes") : typeLabel(typeFilter)}
                        </Select.Trigger>
                        <Select.Content>
                            <Select.Item value="all">{t("bank.filterAllTypes")}</Select.Item>
                            {#each typeOptions as type (type)}
                                <Select.Item value={type}>{typeLabel(type)}</Select.Item>
                            {/each}
                        </Select.Content>
                    </Select.Root>
                {/if}
                <Select.Root type="single" value={difficultyFilter} onValueChange={(v) => (difficultyFilter = v)}>
                    <Select.Trigger class="w-24" aria-label={t("bank.filterDifficulty")}>
                        {difficultyFilter === "all"
                            ? t("bank.filterAllDifficulties")
                            : t(`diff.${difficultyFilter as Difficulty}`)}
                    </Select.Trigger>
                    <Select.Content>
                        <Select.Item value="all">{t("bank.filterAllDifficulties")}</Select.Item>
                        {#each ["easy", "medium", "hard"] as const as level (level)}
                            <Select.Item value={level}>{t(`diff.${level}`)}</Select.Item>
                        {/each}
                    </Select.Content>
                </Select.Root>
                {#if tagOptions.length > 0}
                    <Select.Root type="single" value={tagFilter} onValueChange={(v) => (tagFilter = v)}>
                        <Select.Trigger class="w-32" aria-label={t("bank.filterTag")}>
                            {tagFilter === "all" ? t("bank.filterAllTags") : tagFilter}
                        </Select.Trigger>
                        <Select.Content>
                            <Select.Item value="all">{t("bank.filterAllTags")}</Select.Item>
                            {#each tagOptions as option (option.tag)}
                                <Select.Item value={option.tag}>
                                    {option.tag}
                                    <span class="text-muted-foreground">· {option.count}</span>
                                </Select.Item>
                            {/each}
                        </Select.Content>
                    </Select.Root>
                {/if}
                <Label
                    class="text-muted-foreground ml-auto flex cursor-pointer items-center gap-1.5 text-xs font-normal"
                    title={t("bank.cramModeHint")}
                >
                    <Checkbox class="size-3.5" checked={cram} onCheckedChange={(v) => (cram = v === true)} />
                    {t("bank.cramMode")}
                </Label>
            </div>

            <!-- 当前筛选可直接开一次复习：知识点/题型/难度都是题库的筛选键 -->
            {#if reviewScope}
                <div class="bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-lg p-2">
                    <span class="text-xs">
                        {t("bank.scopeLine", reviewScope.label, String(scopeItems.length))}
                        <span class="text-muted-foreground">
                            {scopeDueCount > 0 ? t("bank.tagDue", String(scopeDueCount)) : t("bank.tagAhead")}
                        </span>
                    </span>
                    <Button
                        size="sm"
                        onclick={() => {
                            if (cram && openFlashcard) openFlashcard(scopeItems);
                            else
                                onStartReview({
                                    tag: reviewScope?.tag,
                                    type: reviewScope?.type,
                                    difficulty: reviewScope?.difficulty,
                                });
                        }}
                    >
                        {cram ? `${t("bank.cramBadge")} · ` : ""}{t("bank.reviewScope")}
                    </Button>
                </div>
            {/if}

            <!-- 池子里有到期题时直接给入口，不必先选筛选 -->
            {#if !loading && items.length > 0 && counts.due > 0}
                <div
                    class="bg-primary/5 border-primary/20 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2"
                >
                    <span class="text-xs">{t("bank.dueLine", String(counts.due), String(counts.total))}</span>
                    <Button size="sm" onclick={() => onStartReview({})}>{t("bank.reviewDue")}</Button>
                </div>
            {/if}
        </Card.Content>
    </Card.Root>

    <!-- 标签管理：折叠区 -->
    {#if tagOptions.length > 0}
        <Collapsible.Root bind:open={showTagManage} class="border-border rounded-lg border">
            <!-- 同样补一个会翻转的箭头：只有一行灰字时看不出这块能展开 -->
            <Collapsible.Trigger
                class="text-muted-foreground flex w-full items-center gap-1.5 p-3 text-left text-xs font-medium"
            >
                <ChevronDownIcon
                    class={cn("size-3.5 shrink-0 transition-transform", showTagManage && "rotate-180")}
                    aria-hidden="true"
                />
                {t("bank.tagManage")} ({tagOptions.length})
            </Collapsible.Trigger>
            <Collapsible.Content>
                <div class="flex max-w-md flex-col gap-1 px-3 pb-3">
                    {#each tagOptions as option (option.tag)}
                        <div class="flex items-center gap-1.5 text-xs">
                            {#if renamingTag === option.tag}
                                <Input
                                    class="h-6 w-28 px-1.5 text-xs"
                                    bind:value={renameValue}
                                    aria-label={t("bank.tagRenamePrompt")}
                                    placeholder={t("bank.tagRenamePrompt")}
                                    onkeydown={(e) => e.key === "Enter" && void doRenameTag()}
                                />
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    class="text-primary"
                                    aria-label={t("common.confirm")}
                                    title={t("common.confirm")}
                                    onclick={() => void doRenameTag()}
                                >
                                    ✓
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    class="text-muted-foreground"
                                    aria-label={t("common.cancel")}
                                    title={t("common.cancel")}
                                    onclick={() => (renamingTag = null)}
                                >
                                    ✕
                                </Button>
                            {:else}
                                <span class="min-w-0 truncate">{option.tag}</span>
                                <span class="text-muted-foreground">({option.count})</span>
                                <span class="flex-1"></span>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    class="text-primary shrink-0"
                                    aria-label={t("bank.tagRename")}
                                    title={t("bank.tagRename")}
                                    onclick={() => {
                                        renamingTag = option.tag;
                                        renameValue = option.tag;
                                    }}
                                >
                                    ✎
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    class="text-destructive shrink-0"
                                    aria-label={t("bank.tagDelete")}
                                    title={t("bank.tagDelete")}
                                    onclick={() =>
                                        confirm(
                                            t("bank.tagConfirmDelete", option.tag, String(option.count)),
                                            "",
                                            () => void doDeleteTag(option.tag)
                                        )}
                                >
                                    ✕
                                </Button>
                            {/if}
                        </div>
                    {/each}
                </div>
            </Collapsible.Content>
        </Collapsible.Root>
    {/if}

    <!-- 列表 -->
    {#if loading}
        <Card.Root>
            <Card.Content class="flex flex-col gap-2 pt-4">
                {#each [0, 1, 2] as i (i)}
                    <Skeleton class="h-12 w-full" />
                {/each}
            </Card.Content>
        </Card.Root>
    {:else if loadError}
        <Empty.Root class="border-border min-h-40 rounded-lg border">
            <Empty.Header>
                <Empty.Media variant="icon">⚠️</Empty.Media>
                <Empty.Title>{t("bank.loadFailed", loadError)}</Empty.Title>
            </Empty.Header>
            <Empty.Content>
                <Button variant="outline" size="sm" onclick={() => void load()}>{t("common.retry")}</Button>
            </Empty.Content>
        </Empty.Root>
    {:else if items.length === 0}
        <Empty.Root class="border-border min-h-40 rounded-lg border">
            <Empty.Header>
                <Empty.Media variant="icon">🗃</Empty.Media>
                <Empty.Title>{t("bank.empty")}</Empty.Title>
            </Empty.Header>
        </Empty.Root>
    {:else if filtered.length === 0}
        <Empty.Root class="border-border min-h-40 rounded-lg border">
            <Empty.Header>
                <Empty.Media variant="icon">🔍</Empty.Media>
                <Empty.Title>{t("bank.noMatch")}</Empty.Title>
            </Empty.Header>
        </Empty.Root>
    {:else}
        <Card.Root class="overflow-hidden py-0">
            <Table.Root>
                <Table.Header>
                    <Table.Row>
                        <Table.Head>{t("bank.colQuestion")}</Table.Head>
                        <Table.Head class="w-16">{t("bank.colType")}</Table.Head>
                        <Table.Head class="w-32 text-right">{t("bank.colMastery")}</Table.Head>
                        <Table.Head class="w-20 text-right">{t("bank.colHistory")}</Table.Head>
                        <Table.Head class="w-20 text-right">{t("bank.colDue")}</Table.Head>
                        <Table.Head class="w-10"></Table.Head>
                    </Table.Row>
                </Table.Header>
                <Table.Body>
                    {#each shown as item (item.id)}
                        {@const mastery = masteryScore(item)}
                        <Table.Row class="animate-in fade-in-0 duration-200">
                            <Table.Cell>
                                <Button
                                    variant="ghost"
                                    class="h-auto w-full flex-col items-start gap-0.5 p-0 text-left whitespace-normal"
                                    aria-expanded={expanded === item.id}
                                    onclick={() => toggle(item.id)}
                                >
                                    <span class="line-clamp-2 text-xs" title={item.question.question}
                                        >{item.question.question}</span
                                    >
                                    <span class="text-muted-foreground text-2xs">
                                        {expanded === item.id ? "▾" : "▸"}
                                        {item.sourceTitle}
                                    </span>
                                </Button>
                            </Table.Cell>
                            <Table.Cell>
                                <Badge variant="outline">{typeLabel(item.question.type)}</Badge>
                            </Table.Cell>
                            <Table.Cell>
                                <div class="flex items-center justify-end gap-2">
                                    <Progress value={mastery} class={cn("h-2 w-16", masteryTone(mastery))} />
                                    <span class="text-muted-foreground w-6 text-right text-2xs tabular-nums"
                                        >{mastery}</span
                                    >
                                </div>
                            </Table.Cell>
                            <Table.Cell class="text-muted-foreground text-right text-2xs tabular-nums">
                                {t("bank.historyValue", String(item.timesPassed), String(item.timesSeen))}
                            </Table.Cell>
                            <Table.Cell class="text-right text-2xs">
                                {#if dueState(item.card, clock.now) === "overdue"}
                                    <span class="text-warning font-medium">{fmtDue(item.card, clock.now)}</span>
                                {:else}
                                    <span class="text-muted-foreground">{fmtDue(item.card, clock.now)}</span>
                                {/if}
                            </Table.Cell>
                            <Table.Cell>
                                <AlertDialog.Root>
                                    <AlertDialog.Trigger>
                                        {#snippet child({ props })}
                                            <Button
                                                {...props}
                                                variant="ghost"
                                                size="icon-xs"
                                                disabled={deleting === item.id}
                                                aria-label={t("common.delete")}
                                                title={t("common.delete")}
                                            >
                                                ✕
                                            </Button>
                                        {/snippet}
                                    </AlertDialog.Trigger>
                                    <AlertDialog.Content>
                                        <AlertDialog.Header>
                                            <AlertDialog.Title>{t("bank.removeTitle")}</AlertDialog.Title>
                                            <AlertDialog.Description>
                                                {t("bank.removeConfirm", item.question.question.slice(0, 40))}
                                            </AlertDialog.Description>
                                        </AlertDialog.Header>
                                        <AlertDialog.Footer>
                                            <AlertDialog.Cancel>{t("common.cancel")}</AlertDialog.Cancel>
                                            <AlertDialog.Action variant="destructive" onclick={() => void remove(item)}>
                                                {t("common.delete")}
                                            </AlertDialog.Action>
                                        </AlertDialog.Footer>
                                    </AlertDialog.Content>
                                </AlertDialog.Root>
                            </Table.Cell>
                        </Table.Row>

                        {#if expanded === item.id}
                            {@const history = historyOf(item)}
                            {@const recent = recentAverage(item)}
                            <!-- 展开行：复习历史（迷你折线 + 逐次得分）+ 排程状态 -->
                            <Table.Row class="bg-muted/30 animate-in fade-in-0 slide-in-from-top-1 duration-150">
                                <Table.Cell colspan={6}>
                                    <div class="grid gap-4 py-2 @4xl:grid-cols-2">
                                        <div class="flex flex-col gap-2">
                                            <span class="text-xs font-medium">
                                                {t("bank.detailHistory", String(history.length))}
                                                {#if recent !== null}
                                                    <span class="text-muted-foreground font-normal">
                                                        {t(
                                                            "bank.detailRecentAvg",
                                                            String(Math.min(RECENT_AVG_WINDOW, history.length)),
                                                            recent.toFixed(0)
                                                        )}
                                                    </span>
                                                {/if}
                                            </span>
                                            {#if history.length === 0}
                                                <p class="text-muted-foreground text-2xs">
                                                    {item.timesSeen > 0
                                                        ? t("bank.detailHistoryLegacy", String(item.timesSeen))
                                                        : t("bank.detailHistoryEmpty")}
                                                </p>
                                            {:else}
                                                <div
                                                    class="h-9 w-full max-w-44"
                                                    role="img"
                                                    aria-label={t("bank.detailHistoryChart")}
                                                >
                                                    <ChartContainer
                                                        config={sparkConfig}
                                                        class="aspect-auto h-full w-full"
                                                    >
                                                        <Chart
                                                            data={sparkPoints(item)}
                                                            x="index"
                                                            y="percent"
                                                            yDomain={[0, 100]}
                                                            padding={{ top: 4, right: 2, bottom: 4, left: 2 }}
                                                        >
                                                            <Layer>
                                                                <Area class="fill-primary/15" />
                                                                <Spline class="stroke-primary" strokeWidth={1.5} />
                                                            </Layer>
                                                        </Chart>
                                                    </ChartContainer>
                                                </div>
                                                <div class="flex flex-wrap gap-1">
                                                    {#each historyNewestFirst(item) as attempt, index (attempt.at)}
                                                        <Badge
                                                            variant="outline"
                                                            class={cn(
                                                                "text-2xs",
                                                                attempt.percent >= 90
                                                                    ? "border-success/40 text-success"
                                                                    : attempt.percent >= 60
                                                                      ? "text-foreground"
                                                                      : "border-destructive/40 text-destructive"
                                                            )}
                                                            title={fmtDateTime(attempt.at)}
                                                        >
                                                            {attempt.percent.toFixed(0)}
                                                            {#if index === 0}
                                                                <span class="text-muted-foreground"
                                                                    >· {t("bank.detailLatest")}</span
                                                                >
                                                            {/if}
                                                        </Badge>
                                                    {/each}
                                                </div>
                                                {#if history.length >= MAX_BANK_HISTORY}
                                                    <p class="text-muted-foreground text-2xs">
                                                        {t("bank.detailHistoryCap", String(MAX_BANK_HISTORY))}
                                                    </p>
                                                {/if}
                                            {/if}
                                        </div>

                                        <div class="flex flex-col gap-2">
                                            <span class="text-xs font-medium">{t("bank.detailSchedule")}</span>
                                            <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-2xs">
                                                <dt class="text-muted-foreground">{t("bank.detailPhase")}</dt>
                                                <dd>{phaseLabel(item.card)}</dd>
                                                <dt class="text-muted-foreground">{t("bank.detailDue")}</dt>
                                                <dd>{fmtDateTime(item.card.due)}</dd>
                                                <dt class="text-muted-foreground">{t("bank.detailReps")}</dt>
                                                <dd>{item.card.reps}</dd>
                                                <dt class="text-muted-foreground">{t("bank.detailLapses")}</dt>
                                                <dd>{item.card.lapses}</dd>
                                                <dt class="text-muted-foreground">{t("bank.detailStability")}</dt>
                                                <dd>
                                                    {t("bank.detailStabilityValue", item.card.stability.toFixed(1))}
                                                </dd>
                                                <dt class="text-muted-foreground">{t("bank.detailDifficulty")}</dt>
                                                <dd>{item.card.difficulty.toFixed(1)}</dd>
                                                <dt class="text-muted-foreground">{t("bank.detailCreated")}</dt>
                                                <dd>{fmtDateTime(item.createdAt)}</dd>
                                            </dl>
                                            {#if (item.question.tags ?? []).length > 0}
                                                <div class="flex flex-wrap items-center gap-1">
                                                    <span class="text-muted-foreground text-2xs">
                                                        {t("bank.detailTags")}
                                                    </span>
                                                    {#each item.question.tags ?? [] as tag (tag)}
                                                        <Button
                                                            variant="outline"
                                                            size="xs"
                                                            onclick={() => (tagFilter = tag)}
                                                        >
                                                            {tag}
                                                        </Button>
                                                    {/each}
                                                </div>
                                            {/if}
                                            <p class="text-muted-foreground text-2xs">
                                                {t("bank.detailSource", item.sourceTitle || item.sourceDocId)}
                                            </p>
                                        </div>
                                    </div>
                                </Table.Cell>
                            </Table.Row>
                        {/if}
                    {/each}
                </Table.Body>
            </Table.Root>
        </Card.Root>

        {#if filtered.length > shown.length}
            <div class="flex flex-col items-center gap-2 py-2">
                <Button variant="outline" size="sm" onclick={() => (visible = nextLimit(visible, filtered.length))}>
                    {t("history.loadMore", String(filtered.length - shown.length))}
                </Button>
                <span class="text-muted-foreground text-xs">
                    {t("history.showingCount", String(shown.length), String(filtered.length))}
                </span>
            </div>
        {/if}
    {/if}
</div>
