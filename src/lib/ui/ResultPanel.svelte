<script lang="ts">
    import { Badge } from "@/lib/components/ui/badge";
    import { Button } from "@/lib/components/ui/button";
    import * as Card from "@/lib/components/ui/card";
    import { Progress } from "@/lib/components/ui/progress";
    import { Textarea } from "@/lib/components/ui/textarea";
    import * as Tabs from "@/lib/components/ui/tabs";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import type { ChatTurn, QuizService } from "../quiz/service";
    import { renderMarkdownLatex } from "./latex";
    import { PASS_SCORE } from "@/types/quiz";
    import type { GradingResult, Question } from "@/types/quiz";

    let {
        service,
        results,
        questions,
        analysis = null,
        duration = 0,
        onsave = () => {},
        onsavewrong = () => {},
        savingDoc = false,
        onretrywrong = () => {},
        ondiscard = () => {},
    }: {
        service: QuizService;
        results: GradingResult[];
        questions: Question[];
        analysis?: string | null;
        duration?: number;
        onsave?: () => void;
        onsavewrong?: () => void;
        /** 保存到文档进行中：按钮置灰，避免重复建文档 */
        savingDoc?: boolean;
        /** 只重做未达标的题目 */
        onretrywrong?: () => void;
        ondiscard?: () => void;
    } = $props();

    /* ── 汇总统计 ────────────────────────────────────────────────── */

    const total = $derived(results.reduce((s, r) => s + r.score, 0));
    const max = $derived(results.reduce((s, r) => s + r.maxScore, 0));
    const pct = $derived(max > 0 ? (total / max) * 100 : 0);
    const correctCount = $derived(results.filter((r) => r.score >= PASS_SCORE).length);
    const partialCount = $derived(results.filter((r) => r.score > 0 && r.score < 100).length);
    const wrongCount = $derived(results.filter((r) => r.score === 0 && !!r.userAnswer).length);
    const unanswered = $derived(results.filter((r) => !r.userAnswer).length);
    const accuracy = $derived(results.length > 0 ? (correctCount / results.length) * 100 : 0);

    /**
     * 按得分取主题语义色，不再硬编码十六进制色值
     * （原实现在暗色主题下对比度不足，基本不可读）。
     */
    function scoreTone(p: number): string {
        if (p >= 80) return "text-success";
        if (p >= 60) return "text-primary";
        if (p >= 30) return "text-warning";
        return "text-destructive";
    }

    function fmtDuration(sec: number): string {
        if (sec <= 0) return "--";
        return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    }

    /* ── 题目详情 ────────────────────────────────────────────────── */

    let activeTab = $state<"questions" | "analysis">("questions");
    let activeQ = $state(0);

    const activeResult = $derived(results[activeQ]);
    const activeQuestion = $derived(questions[activeQ]);

    /**
     * 题目状态：客观题支持部分得分后，「正确」表示完全正确（100 分），
     * 部分得分单独成一类，避免把 75 分的多选题显示成绿色「正确」。
     */
    function qStatus(r: GradingResult): "correct" | "partial" | "wrong" | "unanswered" {
        if (!r.userAnswer) return "unanswered";
        if (r.score >= 100) return "correct";
        if (r.score > 0) return "partial";
        return "wrong";
    }

    function correctText(q: Question): string {
        switch (q.type) {
            case "single_choice":
                return String.fromCharCode(65 + q.answer);
            case "multiple_choice":
                return q.answer
                    .map((i) => String.fromCharCode(65 + i))
                    .sort()
                    .join("、");
            case "true_false":
                return q.answer ? t("common.true") : t("common.false");
            case "fill_blank":
                return q.answer.map((o) => o.join(" / ")).join("；");
            case "subjective":
                return q.reference_answer;
            case "coding":
                return t("common.seeAnswer");
        }
    }

    function userText(r: GradingResult): string {
        const ua = r.userAnswer;
        if (!ua) return t("common.unanswered");
        switch (ua.type) {
            case "single_choice":
                return String.fromCharCode(65 + ua.value);
            case "multiple_choice":
                return ua.value
                    .map((i) => String.fromCharCode(65 + i))
                    .sort()
                    .join("、");
            case "true_false":
                return ua.value ? t("common.true") : t("common.false");
            case "fill_blank":
                return ua.value.join("；");
            case "subjective":
            case "coding":
                return ua.value;
        }
    }

    function isCorrectOption(q: Question, index: number): boolean {
        if (q.type === "single_choice") return q.answer === index;
        if (q.type === "multiple_choice") return q.answer.includes(index);
        return false;
    }

    /* ── AI 答疑 ─────────────────────────────────────────────────── */

    let chatHistory = $state<ChatTurn[]>([]);
    let chatInput = $state("");
    let chatLoading = $state(false);
    let chatScroll: HTMLElement | null = $state(null);

    async function sendChat() {
        const message = chatInput.trim();
        if (!message || chatLoading) return;
        chatLoading = true;
        const prior = [...chatHistory, { role: "user" as const, content: message }];
        chatHistory = prior;
        chatInput = "";
        await scrollChat();
        try {
            const reply = await service.chatGlobal(
                questions,
                results,
                analysis ?? "",
                chatHistory.slice(0, -1),
                message
            );
            chatHistory = [...chatHistory, { role: "assistant", content: reply }];
        } catch (e) {
            chatHistory = [...chatHistory, { role: "assistant", content: t("chat.errorReply", (e as Error).message) }];
        } finally {
            chatLoading = false;
            await scrollChat();
        }
    }

    async function scrollChat() {
        await new Promise((r) => setTimeout(r, 0));
        chatScroll?.scrollTo({ top: chatScroll.scrollHeight, behavior: "smooth" });
    }

    function onChatKey(e: KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void sendChat();
        }
    }
</script>

<div class="flex flex-col gap-4 pb-4">
    <!-- 汇总 -->
    <Card.Root>
        <Card.Content class="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-3">
            <div class="flex flex-col">
                <span class={cn("text-2xl font-bold", scoreTone(pct))}>{pct.toFixed(0)}</span>
                <span class="text-muted-foreground text-xs">{t("result.score")}</span>
                <span class="text-muted-foreground text-xs">{total.toFixed(0)}/{max}</span>
            </div>
            <div class="flex flex-col">
                <span class={cn("text-2xl font-bold", scoreTone(accuracy))}>{accuracy.toFixed(0)}%</span>
                <span class="text-muted-foreground text-xs">{t("result.accuracy")}</span>
                <span class="text-muted-foreground text-xs">
                    {t("result.qCount", `${correctCount}/${results.length}`)}
                </span>
            </div>
            <div class="flex flex-col">
                <span class="text-2xl font-bold">{fmtDuration(duration)}</span>
                <span class="text-muted-foreground text-xs">{t("result.time")}</span>
                <span class="text-muted-foreground text-xs">
                    {t("result.wrongCount", String(wrongCount), String(unanswered))}
                </span>
            </div>
        </Card.Content>
    </Card.Root>

    <!--
        原先「薄弱点分析」与「学习建议」两个标签页渲染的是同一段 analysis 文本，
        属于重复内容。现合并为单一「解析与建议」标签页。
    -->
    <Tabs.Root value={activeTab} onValueChange={(v) => (activeTab = v as typeof activeTab)}>
        <Tabs.List>
            <Tabs.Trigger value="questions">{t("result.tabQuestions")}</Tabs.Trigger>
            <Tabs.Trigger value="analysis">{t("result.tabAnalysisAdvice")}</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="questions" class="flex flex-col gap-3 pt-3">
            <!-- 题目状态一览 -->
            <div class="flex flex-wrap gap-1.5">
                {#each results as r, i (r.questionId)}
                    <button
                        type="button"
                        class={cn(
                            "size-8 rounded-full border text-xs font-semibold transition-transform hover:scale-110 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2",
                            qStatus(r) === "correct" && "bg-success text-success-foreground border-transparent",
                            qStatus(r) === "partial" && "bg-warning text-warning-foreground border-transparent",
                            qStatus(r) === "wrong" && "bg-destructive text-destructive-foreground border-transparent",
                            qStatus(r) === "unanswered" && "bg-muted text-muted-foreground border-transparent",
                            i === activeQ && "ring-ring ring-2"
                        )}
                        aria-label={t("result.jumpTo", String(i + 1), t(`result.status_${qStatus(r)}`))}
                        aria-current={i === activeQ}
                        onclick={() => (activeQ = i)}>{i + 1}</button
                    >
                {/each}
            </div>

            <div class="text-muted-foreground flex flex-wrap gap-4 text-xs">
                {#each [["all", t("result.all", String(results.length))], ["correct", t("result.correct", String(correctCount))], ["partial", t("result.partial", String(partialCount))], ["wrong", t("result.wrong", String(wrongCount))], ["unanswered", t("result.unanswered", String(unanswered))]] as [key, label] (key)}
                    <span class="flex items-center gap-1.5">
                        <span
                            class={cn(
                                "size-2.5 rounded-full",
                                key === "all" && "bg-muted-foreground",
                                key === "correct" && "bg-success",
                                key === "partial" && "bg-warning",
                                key === "wrong" && "bg-destructive",
                                key === "unanswered" && "bg-muted"
                            )}
                        ></span>{label}
                    </span>
                {/each}
            </div>

            <Progress value={results.length > 0 ? ((activeQ + 1) / results.length) * 100 : 0} />

            {#if activeQuestion && activeResult}
                <Card.Root>
                    <Card.Header>
                        <div class="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{t(`type.${activeQuestion.type}`)}</Badge>
                            <Badge variant="secondary">{t(`diff.${activeQuestion.difficulty}`)}</Badge>
                            {#each activeQuestion.tags ?? [] as tag (tag)}
                                <Badge variant="outline">{tag}</Badge>
                            {/each}
                            <span
                                class={cn(
                                    "ml-auto text-sm font-bold",
                                    scoreTone((activeResult.score / (activeResult.maxScore || 1)) * 100)
                                )}
                            >
                                {activeResult.score.toFixed(0)}/{activeResult.maxScore}
                            </span>
                        </div>
                    </Card.Header>
                    <Card.Content class="flex flex-col gap-3 text-sm">
                        <div class="rg-markdown">{@html renderMarkdownLatex(activeQuestion.question)}</div>

                        {#if activeQuestion.type === "single_choice" || activeQuestion.type === "multiple_choice"}
                            <div class="flex flex-col gap-1">
                                {#each activeQuestion.options as option, j (j)}
                                    <div
                                        class={cn(
                                            "rounded-md px-2.5 py-1.5",
                                            isCorrectOption(activeQuestion, j) && "bg-success/15 font-semibold"
                                        )}
                                    >
                                        <b>{String.fromCharCode(65 + j)}.</b>
                                        <span class="rg-markdown inline-block">{@html renderMarkdownLatex(option)}</span
                                        >
                                    </div>
                                {/each}
                            </div>
                        {/if}

                        <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                            <div>
                                <span class="text-muted-foreground">{t("result.yourAnswer")}</span>
                                <div class="rg-markdown">{@html renderMarkdownLatex(userText(activeResult))}</div>
                            </div>
                            {#if activeQuestion.type !== "subjective" && activeQuestion.type !== "coding"}
                                <div>
                                    <span class="text-muted-foreground">{t("result.correctAnswer")}</span>
                                    <div class="rg-markdown">
                                        {@html renderMarkdownLatex(correctText(activeQuestion))}
                                    </div>
                                </div>
                            {/if}
                        </div>

                        {#if activeQuestion.explanation}
                            <div class="border-border border-t pt-2">
                                <span class="text-muted-foreground text-xs">{t("result.explanation")}</span>
                                <div class="rg-markdown">{@html renderMarkdownLatex(activeQuestion.explanation)}</div>
                            </div>
                        {/if}

                        {#if activeResult.comment}
                            <div class="border-border border-t pt-2">
                                <span class="text-muted-foreground text-xs">{t("result.comment")}</span>
                                <div class="rg-markdown">{@html renderMarkdownLatex(activeResult.comment)}</div>
                            </div>
                        {/if}
                    </Card.Content>
                </Card.Root>
            {:else}
                <div class="text-muted-foreground py-8 text-center text-sm">{t("result.questionMissing")}</div>
            {/if}

            <div class="flex flex-wrap justify-end gap-2">
                {#if wrongCount > 0}
                    <Button variant="secondary" size="sm" onclick={() => onretrywrong()}
                        >{t("result.retryWrong")}</Button
                    >
                {/if}
                <Button variant="ghost" size="sm" onclick={() => ondiscard()}>{t("result.discard")}</Button>
                <Button variant="outline" size="sm" disabled={savingDoc} onclick={() => onsavewrong()}
                    >{t("result.saveWrong")}</Button
                >
                <Button size="sm" disabled={savingDoc} onclick={() => onsave()}>{t("result.save")}</Button>
            </div>
        </Tabs.Content>

        <Tabs.Content value="analysis" class="pt-3">
            {#if analysis}
                <Card.Root>
                    <Card.Content class="rg-markdown pt-4 text-sm">{@html renderMarkdownLatex(analysis)}</Card.Content>
                </Card.Root>
            {:else}
                <div class="text-muted-foreground py-8 text-center text-sm">{t("result.noAnalysis")}</div>
            {/if}
        </Tabs.Content>
    </Tabs.Root>

    <!-- 整卷 AI 答疑 -->
    <Card.Root>
        <Card.Header>
            <Card.Title class="text-sm">{t("chat.globalTitle")}</Card.Title>
            <Card.Description>{t("chat.globalHint")}</Card.Description>
        </Card.Header>
        <Card.Content class="flex flex-col gap-2">
            <div
                class="flex max-h-60 min-h-16 flex-col gap-2 overflow-y-auto"
                bind:this={chatScroll}
                aria-live="polite"
            >
                {#if chatHistory.length === 0}
                    <p class="text-muted-foreground py-3 text-center text-xs">{t("chat.globalEmpty")}</p>
                {/if}
                {#each chatHistory as turn, i (i)}
                    <div
                        class={cn(
                            "max-w-[90%] rounded-md px-2.5 py-2 text-sm",
                            turn.role === "user" ? "bg-primary/10 self-end" : "bg-muted self-start"
                        )}
                    >
                        <span class="text-muted-foreground text-2xs font-semibold">
                            {turn.role === "user" ? t("common.me") : t("common.ai")}
                        </span>
                        <div class="rg-markdown break-words">{@html renderMarkdownLatex(turn.content)}</div>
                    </div>
                {/each}
                {#if chatLoading}
                    <div class="bg-muted text-muted-foreground self-start rounded-md px-2.5 py-2 text-sm italic">
                        {t("common.thinking")}
                    </div>
                {/if}
            </div>
            <div class="flex items-end gap-2">
                <Textarea
                    class="max-h-20 min-h-9 flex-1 resize-none"
                    placeholder={t("chat.globalPlaceholder")}
                    aria-label={t("chat.globalPlaceholder")}
                    value={chatInput}
                    disabled={chatLoading}
                    oninput={(e) => (chatInput = e.currentTarget.value)}
                    onkeydown={onChatKey}
                />
                <Button size="sm" onclick={() => void sendChat()} disabled={chatLoading || !chatInput.trim()}>
                    {t("common.send")}
                </Button>
            </div>
        </Card.Content>
    </Card.Root>
</div>
