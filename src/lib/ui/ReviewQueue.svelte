<script lang="ts">
    import { t } from "../i18n";
    import { onMount } from "svelte";
    import { Button } from "@/lib/components/ui/button";
    import { Textarea } from "@/lib/components/ui/textarea";
    import type { QuizService } from "../quiz/service";
    import type { Question } from "@/types/quiz";
    import type { ReviewDraft } from "../quiz/review-workflow";
    import { validateReviewQuestion } from "../quiz/review-workflow";
    import { renderMarkdownLatex } from "./latex";
    let {
        service,
        initial = [],
        ondone,
    }: { service: QuizService; initial?: ReviewDraft[]; ondone?: (questions: Question[]) => void } = $props();
    let rows = $state<{ draft: ReviewDraft; json: string; options: string; answer: string }[]>([]);
    let error = $state("");
    let busy = $state(false);
    let message = $state("");
    let editing = $state<Record<string, boolean>>({});
    const typeNames: Record<string, string> = {
        single_choice: "单选",
        multiple_choice: "多选",
        true_false: "判断",
        fill_blank: "填空",
        subjective: "简答",
        coding: "编程",
    };
    function answerPreview(row: (typeof rows)[number]): string {
        if (row.draft.question.type === "subjective") return row.answer;
        try {
            const answer = JSON.parse(row.answer);
            if (row.draft.question.type === "true_false") return answer ? "正确" : "错误";
            if (["single_choice", "multiple_choice"].includes(row.draft.question.type)) {
                return (Array.isArray(answer) ? answer : [answer])
                    .map((n: number) => String.fromCharCode(65 + n))
                    .join("、");
            }
            return Array.isArray(answer) ? answer.flat().join("；") : String(answer);
        } catch {
            return "答案格式有误，请编辑检查";
        }
    }
    function load(drafts: ReviewDraft[]) {
        rows = drafts.map((draft) => ({
            draft,
            json: JSON.stringify(draft.question, null, 2),
            options: "options" in draft.question ? draft.question.options.join("\n") : "",
            answer:
                draft.question.type === "subjective"
                    ? draft.question.reference_answer
                    : JSON.stringify(draft.question.answer),
        }));
    }
    function build(row: (typeof rows)[number]): Question {
        const q = { ...row.draft.question } as unknown as Record<string, unknown>;
        if (q.type === "single_choice" || q.type === "multiple_choice") q.options = row.options.split("\n");
        if (q.type === "subjective") q.reference_answer = row.answer;
        else q.answer = JSON.parse(row.answer);
        return validateReviewQuestion(q as unknown as Question);
    }
    onMount(() => {
        if (initial.length) load(JSON.parse(JSON.stringify(initial)));
        else
            void service.workflow
                ?.snapshot()
                .then((s) => load(s.pending))
                .catch((e) => (error = String(e)));
    });
    async function submit() {
        busy = true;
        error = "";
        try {
            const drafts = rows.map((row) => ({
                ...row.draft,
                question: row.draft.action === "delete" ? row.draft.question : build(row),
            }));
            const accepted = await service.workflow!.commit(JSON.parse(JSON.stringify(drafts)));
            message = `已通过 ${accepted.length} 题；跳过的题目保留在待定区。`;
            load((await service.workflow!.snapshot()).pending);
            ondone?.(accepted);
        } catch (e) {
            error = String(e);
        } finally {
            busy = false;
        }
    }
</script>

<section class="flex flex-col gap-4 p-4" aria-label={t("workflow.ReviewQueue.22")}>
    <header>
        <h2 class="text-lg font-semibold">{t("workflow.ReviewQueue.1")}{rows.length} 题</h2>
        <p class="text-muted-foreground text-sm">{t("workflow.ReviewQueue.2")}</p>
        <p class="text-sm mt-2">
            通过 {rows.filter((r) => r.draft.action === "pass").length} · 待定 {rows.filter(
                (r) => r.draft.action === "skip"
            ).length} · 删除 {rows.filter((r) => r.draft.action === "delete").length}
        </p>
    </header>
    {#each rows as row (row.draft.id)}
        <article class="review-card" class:review-deleted={row.draft.action === "delete"}>
            <header class="review-card-header">
                <div>
                    <strong>第 {row.draft.original.id.match(/\d+$/)?.[0] ?? rows.indexOf(row) + 1} 题</strong><span
                        class="text-muted-foreground text-xs ml-3"
                        >{typeNames[row.draft.question.type]} · {row.draft.action === "pass"
                            ? "通过"
                            : row.draft.action === "skip"
                              ? "待定"
                              : "删除"}</span
                    >
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || row.draft.action === "delete"}
                    onclick={() => (editing[row.draft.id] = !editing[row.draft.id])}
                    >{editing[row.draft.id] ? "预览" : "编辑"}</Button
                >
            </header>
            {#if row.draft.action !== "delete"}
                {#if !editing[row.draft.id]}
                    <div class="rg-markdown">{@html renderMarkdownLatex(row.draft.question.question)}</div>
                    {#if ["single_choice", "multiple_choice"].includes(row.draft.question.type)}
                        <div class="review-options">
                            {#each row.options.split("\n") as option, index}<div class="flex gap-2">
                                    <span class="text-muted-foreground">{String.fromCharCode(65 + index)}.</span>
                                    <div class="rg-markdown">{@html renderMarkdownLatex(option)}</div>
                                </div>{/each}
                        </div>
                    {/if}
                    <div class="review-answer">
                        <span class="text-muted-foreground text-xs">正确答案</span>
                        <div class="rg-markdown">{@html renderMarkdownLatex(answerPreview(row))}</div>
                    </div>
                    {#if row.draft.question.tags?.length}<p class="text-muted-foreground text-xs">
                            {row.draft.question.tags.join(" · ")}
                        </p>{/if}
                    {#if row.draft.question.explanation}<details>
                            <summary>查看解析</summary>
                            <div class="rg-markdown mt-2">
                                {@html renderMarkdownLatex(row.draft.question.explanation)}
                            </div>
                        </details>{/if}
                {:else}
                    <div class="review-editor">
                        <label
                            >{t("workflow.ReviewQueue.3")}<Textarea
                                aria-label={t("workflow.ReviewQueue.23")}
                                bind:value={row.draft.question.question}
                                disabled={busy}
                            /></label
                        >
                        <label
                            >{t("workflow.ReviewQueue.4")}<select
                                aria-label={t("workflow.ReviewQueue.24")}
                                bind:value={row.draft.question.type}
                                disabled={busy}
                                ><option value="single_choice">{t("workflow.ReviewQueue.5")}</option><option
                                    value="multiple_choice">{t("workflow.ReviewQueue.6")}</option
                                ><option value="fill_blank">{t("workflow.ReviewQueue.7")}</option><option
                                    value="true_false">{t("workflow.ReviewQueue.8")}</option
                                ><option value="subjective">{t("workflow.ReviewQueue.9")}</option><option value="coding"
                                    >{t("workflow.ReviewQueue.10")}</option
                                ></select
                            ></label
                        >
                        {#if row.draft.question.type === "single_choice" || row.draft.question.type === "multiple_choice"}<label
                                >{t("workflow.ReviewQueue.11")}<Textarea
                                    aria-label={t("workflow.ReviewQueue.25")}
                                    bind:value={row.options}
                                /></label
                            >{/if}
                        <label
                            >{t("workflow.ReviewQueue.12")}{row.draft.question.type === "subjective"
                                ? "（参考答案文本）"
                                : '（JSON：单选 0，多选 [0,1]，判断 true，填空 [["答案"]]，编程用 JSON 字符串）'}<Textarea
                                aria-label={t("workflow.ReviewQueue.26")}
                                bind:value={row.answer}
                                disabled={busy}
                            /></label
                        >
                        <label
                            >{t("workflow.ReviewQueue.13")}<input
                                class="border rounded p-2 w-full"
                                aria-label={t("workflow.ReviewQueue.27")}
                                value={row.draft.question.tags?.join("，") ?? ""}
                                oninput={(e) =>
                                    (row.draft.question.tags = e.currentTarget.value
                                        .split(/[,，]/)
                                        .map((s) => s.trim())
                                        .filter(Boolean))}
                                disabled={busy}
                            /></label
                        >
                        <label
                            >{t("workflow.ReviewQueue.14")}<Textarea
                                aria-label={t("workflow.ReviewQueue.28")}
                                bind:value={row.draft.question.explanation}
                                disabled={busy}
                            /></label
                        >
                        <details>
                            <summary>{t("workflow.ReviewQueue.15")}</summary><Textarea
                                aria-label={t("workflow.ReviewQueue.29")}
                                class="min-h-48 font-mono text-xs"
                                bind:value={row.json}
                            /><Button
                                variant="outline"
                                onclick={() => {
                                    try {
                                        const q = validateReviewQuestion(JSON.parse(row.json));
                                        row.draft.question = q;
                                        row.options = "options" in q ? q.options.join("\n") : "";
                                        row.answer =
                                            q.type === "subjective" ? q.reference_answer : JSON.stringify(q.answer);
                                        error = "";
                                    } catch (e) {
                                        error = String(e);
                                    }
                                }}>{t("workflow.ReviewQueue.16")}</Button
                            >
                        </details>
                    </div>
                {/if}
            {/if}
            <footer class="review-actions" aria-label="处理方式">
                {#each ["pass", "skip", "delete"] as action}
                    <Button
                        size="sm"
                        variant={row.draft.action === action ? "default" : "outline"}
                        disabled={busy}
                        aria-pressed={row.draft.action === action}
                        onclick={() => (row.draft.action = action as ReviewDraft["action"])}
                        >{action === "pass" ? "通过" : action === "skip" ? "待定" : "删除"}</Button
                    >
                {/each}
            </footer>
            <details class="review-reason" open={!!row.draft.reason}>
                <summary>添加理由（可选）</summary><label class="text-sm"
                    >{t("workflow.ReviewQueue.21")}<Textarea
                        aria-label={t("workflow.ReviewQueue.31")}
                        bind:value={row.draft.reason}
                        disabled={busy}
                    /></label
                >
            </details>
        </article>
    {/each}
    {#if error}<p role="alert" class="text-destructive">{error}</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
    <div class="review-submit">
        <span class="text-muted-foreground text-sm">共 {rows.length} 题</span><Button
            onclick={submit}
            disabled={busy || !rows.length}>{busy ? "保存中…" : "确认审核并入库"}</Button
        >
    </div>
</section>

<style>
    .review-card {
        border: 1px solid var(--b3-border-color, #ddd);
        border-radius: 10px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .review-card-header,
    .review-submit {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }
    .review-options,
    .review-editor {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .review-editor :global(label) {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 13px;
    }
    .review-editor :global(select) {
        border: 1px solid var(--b3-border-color, #ddd);
        border-radius: 6px;
        padding: 6px;
        background: var(--b3-theme-background, white);
        color: inherit;
    }
    .review-answer {
        border-left: 3px solid var(--b3-theme-primary, #4285f4);
        padding-left: 12px;
    }
    .review-actions {
        display: flex;
        gap: 8px;
        border-top: 1px solid var(--b3-border-color, #ddd);
        padding-top: 12px;
    }
    .review-reason {
        font-size: 13px;
    }
    .review-reason :global(textarea) {
        margin-top: 8px;
    }
    summary {
        cursor: pointer;
        color: var(--b3-theme-on-surface, #777);
        font-size: 13px;
    }
    .review-deleted {
        background: var(--b3-theme-surface, #f5f5f5);
    }
    .review-submit {
        position: sticky;
        bottom: 0;
        padding: 12px 16px;
        background: var(--b3-theme-background, white);
        border: 1px solid var(--b3-border-color, #ddd);
        border-radius: 8px;
        z-index: 10;
    }
</style>
