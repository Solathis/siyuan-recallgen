<script lang="ts">
    import { onMount } from "svelte";
    import { Button } from "@/lib/components/ui/button";
    import * as Card from "@/lib/components/ui/card";
    import * as Empty from "@/lib/components/ui/empty";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import { renderMarkdownLatex } from "./latex";
    import ProgressBar from "./ProgressBar.svelte";
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

    /** 根元素：键盘监听挂在 window 上，需要自己判断面板是否真的在前台 */
    let rootEl = $state<HTMLDivElement | null>(null);

    let index = $state(0);
    let revealed = $state(false);
    let counts = $state<Record<FlashGrade, number>>({ again: 0, hard: 0, good: 0, easy: 0 });
    /** questionId → 得分率 */
    let grades = $state<Map<string, number>>(new Map());
    let done = $state(false);

    const current = $derived(items[index] ?? null);
    const isLast = $derived(index >= items.length - 1);
    const rated = $derived(grades.size);
    const remaining = $derived(Math.max(0, items.length - rated));
    const gradeSummary = $derived(
        GRADE_ORDER.filter((g) => counts[g] > 0)
            .map((g) => t(`flash.${g}Count`, String(counts[g])))
            .join(" · ")
    );

    /** 每档自评的语义色，按钮与侧栏计数共用一套，避免两处各写一份 */
    const GRADE_TONE: Record<FlashGrade, string> = {
        again: "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20",
        hard: "border-warning/30 bg-warning/10 text-warning hover:bg-warning/20",
        good: "border-success/30 bg-success/10 text-success hover:bg-success/20",
        easy: "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20",
    };

    function reveal(): void {
        revealed = true;
    }

    /**
     * 面板是否真的在前台。
     *
     * 按键监听挂在 window 上，而思源会把非活动的 tab 留在 DOM 里，
     * 不加判断就会「在别的 tab 里按空格，这边的卡片跟着翻」。
     *
     * 用祖先的 display/visibility 判断而不是 getClientRects：后者依赖布局引擎，
     * jsdom 下恒为空列表，等于让整条按键路径无法写用例。
     */
    function isPanelVisible(): boolean {
        if (!rootEl?.isConnected) return false;
        for (let node: HTMLElement | null = rootEl; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden") return false;
        }
        return true;
    }

    /*
     * 键盘操作：闪卡是整套流程里最适合键盘的一个环节——一屏一张卡，
     * 手上不必离开键盘。空格/回车揭示，1–4 自评（与按钮顺序一致）。
     *
     * 监听挂在 window 上（用户可能刚点完别处，焦点不在面板里），因此要自己
     * 排除两种情况：面板不在前台（另一个 tab 里按空格不该翻这里的卡）、
     * 焦点在输入控件里。
     */
    function onKeydown(event: KeyboardEvent): void {
        if (done || !current) return;
        const element = event.target as HTMLElement | null;
        if (
            element &&
            (element.tagName === "INPUT" ||
                element.tagName === "TEXTAREA" ||
                element.tagName === "SELECT" ||
                element.isContentEditable)
        ) {
            return;
        }
        if (!isPanelVisible()) return;

        if (event.key === " " || event.key === "Enter") {
            if (revealed) return;
            event.preventDefault();
            reveal();
            return;
        }
        if (!revealed) return;
        const position = Number.parseInt(event.key, 10);
        const grade_ = GRADE_ORDER[position - 1];
        if (grade_) {
            event.preventDefault();
            grade(grade_);
        }
    }

    onMount(() => {
        window.addEventListener("keydown", onKeydown);
        return () => window.removeEventListener("keydown", onKeydown);
    });

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

    /* ── 选择题：选项与正确项 ────────────────────────────────────── */

    /**
     * 选择题的选项列表；非选择题返回 null。
     *
     * 之前闪卡只渲染题干、不渲染选项，于是选择题根本没法答：
     * 卡片上只有「关于 $state，下列说法正确的是？」，四个选项一个都看不到，
     * 揭晓答案也只给出一个字母「B」——等于把题做废了。
     */
    function choiceOptions(q: BankItem["question"]): string[] | null {
        return q.type === "single_choice" || q.type === "multiple_choice" ? q.options : null;
    }

    /** 正确选项下标（多选按升序） */
    function correctIndices(q: BankItem["question"]): number[] {
        if (q.type === "single_choice") return [q.answer];
        if (q.type === "multiple_choice") return [...q.answer].sort((a, b) => a - b);
        return [];
    }

    function optionLetter(i: number): string {
        return String.fromCharCode(65 + i);
    }

    /** 编程题的初始代码模板：贴在题干下方，否则「在此实现」这类题干没上下文 */
    function starterCode(q: BankItem["question"]): string | null {
        if (q.type !== "coding") return null;
        const code = q.starter_code?.trim();
        return code ? code : null;
    }

    /** 正确答案的展示文本（按题型） */
    function answerText(item: BankItem): string {
        const q = item.question;
        if (q.type === "single_choice" || q.type === "multiple_choice") {
            // 只给字母没有意义，必须带上选项原文
            return correctIndices(q)
                .map((i) => `- ${optionLetter(i)}. ${q.options[i] ?? ""}`)
                .join("\n");
        }
        if (q.type === "true_false") return q.answer ? t("common.true") : t("common.false");
        if (q.type === "fill_blank")
            return (Array.isArray(q.answer) ? q.answer : []).map((opts) => opts.join(" / ")).join("；");
        if (q.type === "coding") return q.answer ?? "";
        return q.reference_answer ?? "";
    }
</script>

<!--
    自适应布局。
    原实现把进度条、卡片、自评统计都卡在 max-w-lg（512px）并居中，
    在思源的宽面板（1000px 以上）里左右各空出三四百像素，卡片本身也只有 300px 高，
    下方整片空白——整屏看上去像没排完。
    现在：卡片随容器放宽到 48rem 并吃满可用高度；容器够宽时右侧再挂一栏
    「本次复习」统计，把自评分布与剩余题量从底部那行小字挪过去，
    宽面板的横向空间因此有内容可用，而不是留白。
-->
<div bind:this={rootEl} class="@container flex h-full flex-col gap-4 px-4 py-5">
    <div class="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4 @3xl:flex-row @3xl:items-stretch">
        <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            <div class="flex items-center justify-between gap-2">
                <div class="min-w-0 flex-1">
                    <!--
                        文案要与卡片标题同口径（第几张 / 共几张）。
                        原先这里传的是 0 基下标，于是在第一张卡上出现
                        进度条写「0 / 10」、卡片里写「1 / 10」的矛盾。
                    -->
                    <!--
                        进度条与文案同源（当前位置 / 共几张），也与卡片标题一致。
                        原先条按位置、文案在「全部评完」或「提前结束」时按总题数，
                        提前结束会出现「10 / 10」配一条 40% 的条；
                        全部评完时 index = n-1，两者自然都到 100%。
                    -->
                    <ProgressBar
                        value={items.length > 0 ? ((index + 1) / items.length) * 100 : 0}
                        label={t(
                            "flash.progress",
                            // 空列表时下标会算出 1（1 / 0），用 min 收口
                            String(Math.min(index + 1, items.length)),
                            String(items.length)
                        )}
                    />
                </div>
                {#if !done && index > 0}
                    <Button variant="ghost" size="sm" onclick={finishEarly}>{t("flash.finishEarly")}</Button>
                {/if}
            </div>

            {#if done}
                <Card.Root class="w-full">
                    <Card.Header class="text-center">
                        <Card.Title class="text-lg">{t("flash.done")}</Card.Title>
                        <Card.Description>{t("flash.doneDesc", String(items.length), gradeSummary)}</Card.Description>
                    </Card.Header>
                </Card.Root>
            {:else if current}
                <!--
                    按题目 id 做 key：切到下一张时整卡重新入场。
                    flex-1 让卡片吃满剩余高度，短题干也不会在下方留一大片空白。
                -->
                {#key current.id}
                    <Card.Root
                        class="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 flex min-h-64 w-full flex-1 flex-col shadow-rg-sm"
                    >
                        <Card.Header class="pb-1">
                            <Card.Description class="text-2xs">
                                {t("flash.progress", String(index + 1), String(items.length))}
                                · {t(`type.${current.question.type}_short`)}
                                · {t(`diff.${current.question.difficulty}`)}
                            </Card.Description>
                        </Card.Header>
                        <Card.Content class="flex min-h-0 flex-1 flex-col justify-center gap-4 pb-4">
                            <div class="rg-markdown text-reading mx-auto max-w-prose leading-relaxed">
                                {@html renderMarkdownLatex(current.question.question)}
                            </div>

                            <!--
                            选择题必须把选项渲染出来，否则这张卡没法答：
                            只看题干、四个选项一个都看不到，揭晓时又只给一个字母。
                            揭晓后正确项加底色，与下方「答案」互为印证。
                        -->
                            {#if choiceOptions(current.question)}
                                <ul class="mx-auto flex w-full max-w-prose flex-col gap-1 text-sm">
                                    {#each choiceOptions(current.question) as option, i (i)}
                                        {@const isRight = revealed && correctIndices(current.question).includes(i)}
                                        <li
                                            class={cn(
                                                "flex items-start gap-2 rounded-md px-2.5 py-1.5",
                                                isRight && "bg-success/15 font-semibold"
                                            )}
                                        >
                                            <span class="text-muted-foreground w-3 shrink-0 font-mono text-xs"
                                                >{optionLetter(i)}</span
                                            >
                                            <div class="rg-markdown min-w-0 flex-1">
                                                {@html renderMarkdownLatex(option)}
                                            </div>
                                        </li>
                                    {/each}
                                </ul>
                            {/if}

                            <!-- 编程题：初始代码模板必须一起给，否则「在此实现」没有上下文 -->
                            {#if starterCode(current.question)}
                                <pre
                                    class="bg-muted mx-auto max-h-40 w-full max-w-prose overflow-auto rounded-md p-3 font-mono text-xs">{starterCode(
                                        current.question
                                    )}</pre>
                            {/if}

                            {#if !revealed}
                                <div class="mx-auto w-full max-w-prose">
                                    <Button onclick={reveal} class="w-full" size="lg">
                                        {t("flash.showAnswer")}
                                    </Button>
                                    <p class="text-muted-foreground mt-2 text-center text-2xs">
                                        {t("flash.revealHint")} · {t("flash.keyHint")}
                                    </p>
                                </div>
                            {:else}
                                <div
                                    class="border-border bg-muted/30 animate-in fade-in-0 mx-auto w-full max-w-prose rounded-md border border-t-2 p-3"
                                >
                                    <p class="text-muted-foreground mb-1 text-2xs font-semibold">
                                        {t("flash.answerLabel")}
                                    </p>
                                    <div class="rg-markdown text-sm">
                                        {@html renderMarkdownLatex(answerText(current))}
                                    </div>
                                </div>

                                <div class="mx-auto grid w-full max-w-prose grid-cols-4 gap-2">
                                    {#each GRADE_ORDER as g (g)}
                                        <Button
                                            variant="outline"
                                            class={cn("h-auto py-2.5 text-xs font-semibold", GRADE_TONE[g])}
                                            onclick={() => grade(g)}
                                        >
                                            {t(`flash.${g}`)}
                                        </Button>
                                    {/each}
                                </div>
                            {/if}
                        </Card.Content>
                    </Card.Root>
                {/key}
            {:else}
                <!-- 空列表原先什么都不渲染：面板整块空白，用户不知道是没题还是坏了 -->
                <Empty.Root class="min-h-40">
                    <Empty.Header>
                        <Empty.Media variant="icon">🃏</Empty.Media>
                        <Empty.Title>{t("flash.empty")}</Empty.Title>
                    </Empty.Header>
                </Empty.Root>
            {/if}
        </div>

        <!-- 侧栏：容器够宽才出现，窄面板下这些统计仍在底部那行显示 -->
        <aside class="hidden w-52 shrink-0 flex-col gap-3 @3xl:flex">
            <Card.Root>
                <Card.Header>
                    <Card.Title class="text-sm">{t("flash.sessionTitle")}</Card.Title>
                </Card.Header>
                <Card.Content class="flex flex-col gap-3">
                    <dl class="grid grid-cols-2 gap-x-3 gap-y-2">
                        <div class="flex flex-col gap-0.5">
                            <dt class="text-muted-foreground text-2xs">{t("flash.ratedLabel")}</dt>
                            <dd class="text-lg leading-none font-semibold tabular-nums">{rated}</dd>
                        </div>
                        <div class="flex flex-col gap-0.5">
                            <dt class="text-muted-foreground text-2xs">{t("flash.remainingLabel")}</dt>
                            <dd class="text-lg leading-none font-semibold tabular-nums">{remaining}</dd>
                        </div>
                    </dl>

                    <div class="flex flex-col gap-1.5">
                        {#each GRADE_ORDER as g (g)}
                            <div class="flex items-center justify-between gap-2 text-xs">
                                <span class="text-muted-foreground flex items-center gap-1.5">
                                    <span
                                        class={cn(
                                            "size-2 rounded-full",
                                            {
                                                again: "bg-destructive",
                                                hard: "bg-warning",
                                                good: "bg-success",
                                                easy: "bg-primary",
                                            }[g]
                                        )}
                                    ></span>
                                    {t(`flash.${g}`)}
                                </span>
                                <span class="tabular-nums">{counts[g]}</span>
                            </div>
                        {/each}
                    </div>
                </Card.Content>
            </Card.Root>
        </aside>
    </div>

    <!-- 窄面板下侧栏不显示，统计退到这一行 -->
    {#if !done && current}
        <div class="text-muted-foreground flex flex-wrap gap-3 text-xs @3xl:hidden">
            <span>{t("flash.ratedLabel")} {rated}</span>
            <span>{t("flash.remainingLabel")} {remaining}</span>
            {#each GRADE_ORDER as g (g)}
                {#if counts[g] > 0}
                    <span>{t(`flash.${g}Count`, String(counts[g]))}</span>
                {/if}
            {/each}
        </div>
    {/if}
</div>
