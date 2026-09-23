<script lang="ts">
    import { showMessage } from "siyuan";
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
    import { dueState, masteryScore, type BankItem } from "../quiz/bank";
    import { nextLimit, PAGE_SIZE } from "../quiz/paging";
    import type { QuizService } from "../quiz/service";

    let { service }: { service: QuizService } = $props();

    let items = $state<BankItem[]>([]);
    let loading = $state(true);
    let loadError = $state<string | null>(null);
    let deleting = $state<string | null>(null);
    let query = $state("");
    let filter = $state<"all" | "due" | "weak">("all");
    let typeFilter = $state<string>("all");
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
        visible = PAGE_SIZE;
    });

    const counts = $derived({
        total: items.length,
        due: items.filter((item) => item.card.due <= Date.now()).length,
        weak: items.filter((item) => masteryScore(item) < 60).length,
    });

    const typeOptions = $derived(
        [...new Set(items.map((item) => item.question.type))].sort((a, b) => a.localeCompare(b))
    );

    const filtered = $derived.by(() => {
        const keyword = query.trim().toLowerCase();
        const now = Date.now();
        return (
            items
                .filter((item) => {
                    if (keyword && !item.question.question.toLowerCase().includes(keyword)) return false;
                    if (typeFilter !== "all" && item.question.type !== typeFilter) return false;
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

    function fmtDue(card: BankItem["card"]): string {
        const state = dueState(card);
        if (state === "overdue") return t("bank.dueOverdue");
        if (state === "today") return t("bank.dueToday");
        const days = Math.max(1, Math.round((card.due - Date.now()) / 86_400_000));
        return state === "soon" ? t("bank.dueInDays", String(days)) : t("bank.dueLater", String(days));
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

<div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t("bank.totalCount", String(counts.total))}</Badge>
            <Badge variant={counts.due > 0 ? "warning" : "outline"}>{t("bank.dueCount", String(counts.due))}</Badge>
            <Badge variant="outline">{t("bank.weakCount", String(counts.weak))}</Badge>
        </div>
        <div class="flex flex-wrap items-center gap-2">
            <Input
                class="h-8 w-40"
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
            <Button variant="outline" size="sm" onclick={() => void load()} disabled={loading}>
                {t("common.refresh")}
            </Button>
        </div>
    </div>

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
                    <Table.Head class="w-20">{t("bank.colType")}</Table.Head>
                    <Table.Head class="w-28">{t("bank.colMastery")}</Table.Head>
                    <Table.Head class="w-32">{t("bank.colHistory")}</Table.Head>
                    <Table.Head class="w-28">{t("bank.colDue")}</Table.Head>
                    <Table.Head class="w-16"></Table.Head>
                </Table.Row>
            </Table.Header>
            <Table.Body>
                {#each shown as item (item.id)}
                    {@const mastery = masteryScore(item)}
                    <Table.Row>
                        <Table.Cell>
                            <div class="flex flex-col gap-0.5">
                                <span class="line-clamp-2 text-xs" title={item.question.question}
                                    >{item.question.question}</span
                                >
                                <span class="text-muted-foreground text-[11px]">{item.sourceTitle}</span>
                            </div>
                        </Table.Cell>
                        <Table.Cell>
                            <Badge variant="outline">{typeLabel(item.question.type)}</Badge>
                        </Table.Cell>
                        <Table.Cell>
                            <div class="flex items-center gap-2">
                                <span class="bg-muted h-2 w-16 overflow-hidden rounded-full">
                                    <span
                                        class={cn("block h-full rounded-full", masteryTone(mastery))}
                                        style="width: {Math.max(2, Math.min(100, mastery))}%"
                                    ></span>
                                </span>
                                <span class="text-muted-foreground text-[11px]">{mastery}</span>
                            </div>
                        </Table.Cell>
                        <Table.Cell class="text-muted-foreground text-[11px]">
                            {t("bank.historyValue", String(item.timesPassed), String(item.timesSeen))}
                        </Table.Cell>
                        <Table.Cell class="text-[11px]">
                            {#if dueState(item.card) === "overdue"}
                                <span class="text-warning font-medium">{fmtDue(item.card)}</span>
                            {:else}
                                <span class="text-muted-foreground">{fmtDue(item.card)}</span>
                            {/if}
                        </Table.Cell>
                        <Table.Cell>
                            <AlertDialog.Root>
                                <AlertDialog.Trigger>
                                    {#snippet child({ props })}
                                        <Button {...props} variant="ghost" size="sm" disabled={deleting === item.id}>
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
