<script lang="ts">
    import { confirm, showMessage } from "siyuan";
    import * as AlertDialog from "@/lib/components/ui/alert-dialog";
    import { Badge } from "@/lib/components/ui/badge";
    import { Button } from "@/lib/components/ui/button";
    import * as Card from "@/lib/components/ui/card";
    import { Input } from "@/lib/components/ui/input";
    import * as Select from "@/lib/components/ui/select";
    import { Skeleton } from "@/lib/components/ui/skeleton";
    import * as Table from "@/lib/components/ui/table";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import { createClock } from "./clock.svelte";
    import { lineGeometry } from "../quiz/chart-geometry";
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
    /** 标签管理展开状态 */
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

    const SPARK_W = 180;
    const SPARK_H = 36;

    /** 历史趋势迷你折线（固定 0-100 量程，避免几次波动被放大成剧烈起伏） */
    function sparkline(item: BankItem) {
        return lineGeometry(
            historyOf(item).map((a) => a.percent),
            SPARK_W,
            SPARK_H,
            { top: 4, right: 2, bottom: 4, left: 2 }
        );
    }

    function phaseLabel(card: BankItem["card"]): string {
        return t(`bank.phase_${cardPhase(card)}`);
    }

    function typeLabel(type: string): string {
        return t(`type.${type}_short`);
    }

    function masteryTone(mastery: number): string {
        if (mastery >= 80) return "bg-success";
        if (mastery >= 60) return "bg-primary";
        if (mastery >= 30) return "bg-warning";
        return "bg-destructive";
    }
</script>

<div class="@container flex flex-col gap-4">
    <Card.Root>
        <Card.Content class="flex flex-col gap-3 pt-4">
            <!--
                工具栏拆成两行。
                原实现把「三个概览徽标 + 搜索框 + 四个下拉 + 两个按钮」全塞进一个
                flex-wrap 行里，宽屏上勉强一排、窄一点就折成两三层且各层长度不一；
                现在第一行是概览与次要操作，第二行专放筛选，折行后始终是整齐的两段。
            -->
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{t("bank.totalCount", String(counts.total))}</Badge>
                    <Badge variant={counts.due > 0 ? "warning" : "outline"}
                        >{t("bank.dueCount", String(counts.due))}</Badge
                    >
                    <Badge variant="outline">{t("bank.weakCount", String(counts.weak))}</Badge>
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
            </div>

            <div class="flex flex-wrap items-center gap-2">
                <Input
                    class="h-8 w-full @xl:w-56"
                    placeholder={t("bank.searchPlaceholder")}
                    aria-label={t("bank.searchPlaceholder")}
                    bind:value={query}
                />
                <Select.Root type="single" value={filter} onValueChange={(v) => (filter = v as typeof filter)}>
                    <Select.Trigger class="h-8 w-28" aria-label={t("bank.filterLabel")}>
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
                        <Select.Trigger class="h-8 w-28" aria-label={t("bank.filterType")}>
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
                    <Select.Trigger class="h-8 w-24" aria-label={t("bank.filterDifficulty")}>
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
                        <Select.Trigger class="h-8 w-32" aria-label={t("bank.filterTag")}>
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
            </div>
        </Card.Content>
    </Card.Root>

    <!--
        到期题只在顶部有一个数字，却要先选某个标签/题型/难度才出现复习入口，
        等于「看得到欠账、点不了开始」。池子里有到期题时直接给一个入口。
    -->
    {#if !loading && items.length > 0 && counts.due > 0}
        <div
            class="bg-primary/5 border-primary/20 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2"
        >
            <span class="text-xs">{t("bank.dueLine", String(counts.due), String(counts.total))}</span>
            <Button size="sm" onclick={() => onStartReview({})}>{t("bank.reviewDue")}</Button>
        </div>
    {/if}

    <!-- 标签管理：展开后可重命名或删除知识点标签 -->
    {#if tagOptions.length > 0}
        <div class="flex flex-col gap-1">
            <button
                type="button"
                class="text-muted-foreground flex items-center gap-1 text-xs hover:text-foreground"
                onclick={() => (showTagManage = !showTagManage)}
            >
                {showTagManage ? "▾" : "▸"}
                {t("bank.tagManage")} ({tagOptions.length})
            </button>
            {#if showTagManage}
                <div class="flex flex-col gap-1 pl-3">
                    {#each tagOptions as option (option.tag)}
                        <div class="flex items-center gap-1.5 text-xs">
                            {#if renamingTag === option.tag}
                                <input
                                    class="border-input bg-background w-28 rounded-md border px-1.5 py-0.5 text-xs"
                                    bind:value={renameValue}
                                    placeholder={t("bank.tagRenamePrompt")}
                                    onkeydown={(e) => e.key === "Enter" && void doRenameTag()}
                                />
                                <!-- 图标按钮要给可访问名称：✓ / ✕ 读屏只会念成符号 -->
                                <button
                                    type="button"
                                    class="text-primary"
                                    aria-label={t("common.confirm")}
                                    title={t("common.confirm")}
                                    onclick={() => void doRenameTag()}
                                >
                                    ✓
                                </button>
                                <button
                                    type="button"
                                    class="text-muted-foreground"
                                    aria-label={t("common.cancel")}
                                    title={t("common.cancel")}
                                    onclick={() => (renamingTag = null)}
                                >
                                    ✕
                                </button>
                            {:else}
                                <span class="min-w-0 truncate">{option.tag}</span>
                                <span class="text-muted-foreground">({option.count})</span>
                                <span class="flex-1"></span>
                                <button
                                    type="button"
                                    class="text-primary shrink-0 opacity-60 hover:opacity-100"
                                    title={t("bank.tagRename")}
                                    onclick={() => {
                                        renamingTag = option.tag;
                                        renameValue = option.tag;
                                    }}
                                >
                                    ✎
                                </button>
                                <button
                                    type="button"
                                    class="text-destructive shrink-0 opacity-60 hover:opacity-100"
                                    title={t("bank.tagDelete")}
                                    onclick={() =>
                                        confirm(
                                            t("bank.tagConfirmDelete", option.tag, String(option.count)),
                                            "",
                                            () => void doDeleteTag(option.tag)
                                        )}
                                >
                                    ✕
                                </button>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/if}
        </div>
    {/if}

    <!-- 按知识点筛选时给出一条可执行的复习入口，而不是只能看列表 -->
    {#if reviewScope && !loading && items.length > 0}
        <div class="bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
            <span class="text-xs">
                {t("bank.scopeLine", reviewScope.label, String(scopeItems.length))}
                {#if scopeDueCount > 0}
                    <span class="text-muted-foreground">{t("bank.tagDue", String(scopeDueCount))}</span>
                {:else}
                    <span class="text-muted-foreground">{t("bank.tagAhead")}</span>
                {/if}
            </span>
            <Button
                size="sm"
                variant="outline"
                onclick={() => {
                    if (cram && openFlashcard) {
                        openFlashcard(scopeItems);
                    } else {
                        onStartReview({
                            tag: reviewScope?.tag,
                            type: reviewScope?.type,
                            difficulty: reviewScope?.difficulty,
                        });
                    }
                }}
            >
                {cram ? t("bank.cramBadge") + " · " : ""}{t("bank.reviewScope")}
            </Button>
            <label
                class="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs"
                title={t("bank.cramModeHint")}
            >
                <input type="checkbox" class="accent-primary size-3.5" bind:checked={cram} />
                {t("bank.cramMode")}
            </label>
        </div>
    {/if}

    {#if loading}
        <div class="flex flex-col gap-2">
            {#each [0, 1, 2] as i (i)}
                <Skeleton class="h-12 w-full" />
            {/each}
        </div>
    {:else if loadError}
        <Card.Root>
            <Card.Content class="flex flex-col items-start gap-2 pt-4">
                <p class="text-destructive text-sm">{t("bank.loadFailed", loadError)}</p>
                <Button variant="outline" size="sm" onclick={() => void load()}>{t("common.retry")}</Button>
            </Card.Content>
        </Card.Root>
    {:else if items.length === 0}
        <div class="text-muted-foreground py-12 text-center text-sm">{t("bank.empty")}</div>
    {:else if filtered.length === 0}
        <div class="text-muted-foreground py-12 text-center text-sm">{t("bank.noMatch")}</div>
    {:else}
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
                    <Table.Row>
                        <Table.Cell>
                            <button
                                type="button"
                                class="flex w-full flex-col gap-0.5 text-left"
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
                            </button>
                        </Table.Cell>
                        <Table.Cell>
                            <Badge variant="outline">{typeLabel(item.question.type)}</Badge>
                        </Table.Cell>
                        <Table.Cell>
                            <div class="flex items-center justify-end gap-2">
                                <span class="bg-muted h-2 w-16 overflow-hidden rounded-full">
                                    <span
                                        class={cn("block h-full rounded-full", masteryTone(mastery))}
                                        style="width: {Math.max(2, Math.min(100, mastery))}%"
                                    ></span>
                                </span>
                                <span class="text-muted-foreground w-6 text-right text-2xs tabular-nums">{mastery}</span
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
                                        <!--
                                            aria-label / title 必须写在开始标签里。
                                            原实现把它们放在标签之后，Svelte 会把
                                            `aria-label=` 当文本、把表达式当插值，
                                            于是每一行的操作列都渲染出
                                            「aria-label=删除 title=删除 ✕」这串字面量。
                                        -->
                                        <Button
                                            {...props}
                                            variant="ghost"
                                            size="sm"
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
                        {@const spark = sparkline(item)}
                        <Table.Row class="bg-muted/30">
                            <Table.Cell colspan={6}>
                                <div class="grid gap-4 py-2 md:grid-cols-2">
                                    <!-- 复习历史 -->
                                    <div class="flex flex-col gap-2">
                                        <span class="text-xs font-medium">
                                            {t("bank.detailHistory", String(history.length))}
                                            {#if recent !== null}
                                                <span class="text-muted-foreground font-normal">
                                                    <!-- 次数用实际参与平均的条数：只有 2 条历史时
                                                         说「最近 5 次平均」是假的 -->
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
                                            <svg
                                                viewBox="0 0 {SPARK_W} {SPARK_H}"
                                                class="h-9 w-full max-w-44"
                                                role="img"
                                                aria-label={t("bank.detailHistoryChart")}
                                            >
                                                <path d={spark.area} class="fill-primary/15"></path>
                                                <path
                                                    d={spark.line}
                                                    class="stroke-primary"
                                                    fill="none"
                                                    stroke-width="1.5"
                                                ></path>
                                            </svg>
                                            <div class="flex flex-wrap gap-1">
                                                {#each historyNewestFirst(item) as attempt, index (attempt.at)}
                                                    <span
                                                        class={cn(
                                                            "rounded-sm border px-1.5 py-0.5 text-2xs",
                                                            attempt.percent >= 90
                                                                ? "border-success/40 text-success"
                                                                : attempt.percent >= 60
                                                                  ? "border-border text-foreground"
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
                                                    </span>
                                                {/each}
                                            </div>
                                            {#if history.length >= MAX_BANK_HISTORY}
                                                <p class="text-muted-foreground text-2xs">
                                                    {t("bank.detailHistoryCap", String(MAX_BANK_HISTORY))}
                                                </p>
                                            {/if}
                                        {/if}
                                    </div>

                                    <!-- 间隔重复状态 -->
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
                                            <dd>{t("bank.detailStabilityValue", item.card.stability.toFixed(1))}</dd>
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
                                                    <button
                                                        type="button"
                                                        class="border-border hover:bg-muted rounded-sm border px-1.5 py-0.5 text-2xs"
                                                        onclick={() => (tagFilter = tag)}
                                                    >
                                                        {tag}
                                                    </button>
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
