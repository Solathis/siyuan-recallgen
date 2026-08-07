<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { card, badge, button, progress as p, alert, alertTitle, alertDescription, separator, cn } from "./components";
    import type { GradingResult, Question } from "@/types/quiz";

    export let results: GradingResult[];
    export let questions: Question[];
    export let analysis: string | null;

    const dispatch = createEventDispatcher<{ save: void }>();

    const TYPE_LABEL: Record<string, string> = {
        single_choice: "单选题", multiple_choice: "多选题", fill_blank: "填空题",
        true_false: "判断题", subjective: "主观题", coding: "编程题",
    };

    $: total = results.reduce((s, r) => s + r.score, 0);
    $: max = results.reduce((s, r) => s + r.maxScore, 0);
    $: pct = max > 0 ? (total / max) * 100 : 0;
    $: passed = pct >= 60;

    function correctText(q: Question): string {
        switch (q.type) {
            case "single_choice": return String.fromCharCode(65 + q.answer);
            case "multiple_choice": return q.answer.map((i) => String.fromCharCode(65 + i)).sort().join("、");
            case "true_false": return q.answer ? "正确" : "错误";
            case "fill_blank": return q.answer.map((o) => o.join(" / ")).join("；");
            case "subjective": return q.reference_answer;
            case "coding": return "见参考答案";
        }
        return "";
    }
    function userText(r: GradingResult): string {
        const ua = r.userAnswer;
        if (!ua) return "（未作答）";
        switch (ua.type) {
            case "single_choice": return String.fromCharCode(65 + ua.value);
            case "multiple_choice": return ua.value.map((i) => String.fromCharCode(65 + i)).sort().join("、");
            case "true_false": return ua.value ? "正确" : "错误";
            case "fill_blank": return ua.value.join("；");
            case "subjective": case "coding": return ua.value;
        }
        return "";
    }
</script>

<div class="rg-result">
    <div class={cn(card.root, "rg-result__head")}>
        <div class={card.content}>
            <div class="rg-score-row">
                <div class="rg-score">
                    <span class="rg-score__num">{pct.toFixed(0)}</span><span class="rg-score__unit">分</span>
                    <span class={badge(passed ? "success" : "destructive")}>{passed ? "及格" : "未及格"}</span>
                </div>
                <span class="rg-score__total">{total.toFixed(0)} / {max}</span>
            </div>
            <div class={p.root} style="margin-top:8px">
                <div class={p.bar} style="width:{pct}%"></div>
            </div>
        </div>
    </div>

    <div class="rg-result__list">
        {#each results as r, i}
            {@const q = questions[i]}
            <details class="rg-qcard" class:ok={r.score >= 60} class:bad={r.score < 60}>
                <summary class="rg-qcard__summary">
                    <span class={badge(r.score >= 60 ? "success" : "destructive")}>{TYPE_LABEL[q.type] ?? q.type}</span>
                    <span class="rg-qcard__score">{r.score.toFixed(0)}/{r.maxScore}</span>
                    <span class="rg-qcard__q">{q.question}</span>
                </summary>
                <div class="rg-qcard__body">
                    <p><b>你的答案：</b>{userText(r)}</p>
                    {#if q.type !== "subjective" && q.type !== "coding"}
                        <p><b>正确答案：</b>{correctText(q)}</p>
                    {/if}
                    {#if q.explanation}
                        <p class="rg-explain"><b>解析：</b>{q.explanation}</p>
                    {/if}
                    {#if r.comment}
                        <p class="rg-comment"><b>评语：</b>{r.comment}</p>
                    {/if}
                </div>
            </details>
        {/each}
    </div>

    {#if analysis}
        <div class={alert("default")}>
            <p class={alertTitle}>薄弱点分析与复习指导</p>
            <p class={alertDescription}>{analysis}</p>
        </div>
    {/if}

    <hr class={separator} />
    <div class="rg-result__foot">
        <button class={button({ variant: "default" })} on:click={() => dispatch("save")}>保存到文档</button>
    </div>
</div>

<style>
    .rg-result { display: flex; flex-direction: column; gap: 12px; padding: 0 0 12px; }
    .rg-score-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .rg-score { display: flex; align-items: baseline; gap: 6px; }
    .rg-score__num { font-size: 28px; font-weight: 700; color: var(--b3-theme-primary); }
    .rg-score__unit { font-size: 13px; color: var(--b3-theme-on-surface); }
    .rg-score__total { font-size: 13px; color: var(--b3-theme-on-surface); }
    .rg-result__list { display: flex; flex-direction: column; gap: 8px; }
    .rg-qcard { border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); overflow: hidden; }
    .rg-qcard__summary { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; list-style: none; }
    .rg-qcard__summary::-webkit-details-marker { display: none; }
    .rg-qcard__score { font-size: 12px; font-weight: 600; color: var(--b3-theme-on-surface); min-width: 48px; }
    .rg-qcard.ok .rg-qcard__score { color: var(--b3-card-success); }
    .rg-qcard.bad .rg-qcard__score { color: var(--b3-card-error); }
    .rg-qcard__q { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rg-qcard__body { padding: 4px 12px 12px; font-size: 13px; line-height: 1.7; }
    .rg-explain { color: var(--b3-theme-on-surface); }
    .rg-comment { background: var(--b3-theme-background-light); padding: 6px 8px; border-radius: var(--b3-border-radius); }
    .rg-result__foot { display: flex; justify-content: flex-end; }
    @media (max-width: 768px) { .rg-qcard__q { white-space: normal; } }
</style>
