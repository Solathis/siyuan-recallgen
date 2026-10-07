<script lang="ts">
    import { Button } from "@/lib/components/ui/button";
    import * as Card from "@/lib/components/ui/card";
    import ProgressBar from "./ProgressBar.svelte";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import { renderMarkdownLatex } from "./latex";
    import type { BankItem } from "@/lib/quiz/bank";

    export type FlashGrade = "again" | "hard" | "good" | "easy";

    /** 自评 → 得分率（用于 FSRS 排程） */
    const GRADE_PERCENT: Record<FlashGrade, number> = { again: 0, hard: 50, good: 80, easy: 100 };
    const GRADE_ORDER: FlashGrade[] = ["again", "hard", "good", "easy"];

    let {
        items,
        onDone,
    }: {
        items: BankItem[];
        /** 全部卡片完成时触发；调用方用返回的得分率做 FSRS 排程 */
        onDone?: (grades: Array<{ id: string; percent: number }>) => void;
    } = $props();

    let index = $state(0);
    let revealed = $state(false);
    let counts = $state<Record<FlashGrade, number>>({ again: 0, hard: 0, good: 0, easy: 0 });
    /** questionId → 得分率 */
    let grades = $state<Map<string, number>>(new Map());
    let done = $state(false);

    const current = $derived(items[index] ?? null);
    const isLast = $derived(index >= items.length - 1);
    const gradeSummary = $derived(
        GRADE_ORDER.filter((g) => counts[g] > 0)
            .map((g) => t(`flash.${g}Count`, String(counts[g])))
            .join(" · ")
    );

    function reveal(): void {
        revealed = true;
    }

    /** 提前结束：把已自评的卡片结果交给调用方，未评的不算 */
    function finishEarly(): void {
        if (done || grades.size === 0) return;
        done = true;
        onDone?.(Array.from(grades.entries()).map(([id, percent]) => ({ id, percent })));
    }

    function grade(grade: FlashGrade): void {
        if (!current || done) return;
        counts[grade]++;
        grades.set(current.id, GRADE_PERCENT[grade]);

        if (isLast) {
            done = true;
            onDone?.(Array.from(grades.entries()).map(([id, percent]) => ({ id, percent })));
        } else {
            index++;
            revealed = false;
        }
    }

    /** 正确答案的展示文本（按题型） */
    function answerText(item: BankItem): string {
        const q = item.question;
        if (q.type === "single_choice" || q.type === "multiple_choice") {
            const idx = Array.isArray(q.answer) ? q.answer : [q.answer as number];
            return idx.map((i) => String.fromCharCode(65 + i)).join(", ");
        }
        if (q.type === "true_false") return q.answer ? t("common.true") : t("common.false");
        if (q.type === "fill_blank")
            return (Array.isArray(q.answer) ? q.answer : []).map((opts) => opts.join(" / ")).join("；");
        if (q.type === "coding") return q.answer ?? "";
        return q.reference_answer ?? "";
    }
</script>

<div class="flex h-full flex-col items-center gap-4 px-4 py-6">
    <div class="flex w-full max-w-lg items-center justify-between gap-2">
        <div class="min-w-0 flex-1">
            <ProgressBar
                value={items.length > 0 ? ((index + (done ? 1 : 0)) / items.length) * 100 : 0}
                label={t("flash.progress", String(done ? items.length : index), String(items.length))}
            />
        </div>
        {#if !done && index > 0}
            <Button variant="ghost" size="sm" onclick={finishEarly}>
                {t("flash.finishEarly")}
            </Button>
        {/if}
    </div>

    {#if done}
        <Card.Root class="w-full max-w-lg">
            <Card.Header class="text-center">
                <Card.Title class="text-lg">{t("flash.done")}</Card.Title>
                <Card.Description>{t("flash.doneDesc", String(items.length), gradeSummary)}</Card.Description>
            </Card.Header>
        </Card.Root>
    {:else if current}
        <Card.Root class="flex min-h-[300px] w-full max-w-lg flex-col shadow-sm">
            <Card.Header class="pb-1">
                <Card.Description class="text-2xs">
                    {t("flash.progress", String(index + 1), String(items.length))}
                    · {current.question.difficulty}
                </Card.Description>
            </Card.Header>
            <Card.Content class="flex flex-1 flex-col justify-center gap-4 pb-4">
                <div class="rg-markdown text-reading leading-relaxed">
                    {@html renderMarkdownLatex(current.question.question)}
                </div>

                {#if !revealed}
                    <Button onclick={reveal} class="w-full" size="lg">
                        {t("flash.showAnswer")}
                    </Button>
                    <p class="text-muted-foreground text-center text-2xs">{t("flash.revealHint")}</p>
                {:else}
                    <div class="border-border bg-muted/30 mt-1 rounded-md border border-t-2 p-3 pt-3">
                        <p class="text-muted-foreground mb-1 text-2xs font-semibold">{t("flash.answerLabel")}</p>
                        <div class="rg-markdown text-sm">
                            {@html renderMarkdownLatex(answerText(current))}
                        </div>
                    </div>

                    <div class="grid grid-cols-4 gap-2">
                        {#each GRADE_ORDER as g (g)}
                            <button
                                type="button"
                                class={cn(
                                    "rounded-md border py-2.5 text-xs font-semibold transition-colors",
                                    g === "again" &&
                                        "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20",
                                    g === "hard" && "border-warning/30 bg-warning/10 text-warning hover:bg-warning/20",
                                    g === "good" && "border-success/30 bg-success/10 text-success hover:bg-success/20",
                                    g === "easy" && "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                                )}
                                onclick={() => grade(g)}
                            >
                                {t(`flash.${g}`)}
                            </button>
                        {/each}
                    </div>
                {/if}
            </Card.Content>
        </Card.Root>

        <div class="text-muted-foreground flex gap-3 text-xs">
            {#each GRADE_ORDER as g (g)}
                {#if counts[g] > 0}
                    <span>{t(`flash.${g}Count`, String(counts[g]))}</span>
                {/if}
            {/each}
        </div>
    {/if}
</div>
