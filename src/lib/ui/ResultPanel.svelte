<script lang="ts">
    import { createEventDispatcher } from "svelte";
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

    function correctText(q: Question, r: GradingResult): string {
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

    function userText(q: Question, r: GradingResult): string {
        const ua = r.userAnswer;
        if (!ua) return "（未作答）";
        switch (ua.type) {
            case "single_choice": return String.fromCharCode(65 + ua.value);
            case "multiple_choice": return ua.value.map((i) => String.fromCharCode(65 + i)).sort().join("、");
            case "true_false": return ua.value ? "正确" : "错误";
            case "fill_blank": return ua.value.join("；");
            case "subjective":
            case "coding": return ua.value;
        }
        return "";
    }
</script>

<div class="rg-result">
    <header class="rg-result__head">
        <div class="rg-result__score">
            <span class="rg-result__num">{pct.toFixed(0)}</span><span class="rg-result__unit">分</span>
        </div>
        <div class="rg-result__bar">
            <div class="rg-result__fill" style="width:{pct}%"></div>
        </div>
        <div class="rg-result__total">{total.toFixed(0)} / {max}</div>
    </header>

    <div class="rg-result__list">
        {#each results as r, i}
            {@const q = questions[i]}
            <details class="rg-qcard" class:ok={r.score >= 60} class:bad={r.score < 60}>
                <summary>
                    <span class="rg-qcard__tag">{TYPE_LABEL[q.type] ?? q.type}</span>
                    <span class="rg-qcard__score">{r.score.toFixed(0)}/{r.maxScore}</span>
                    <span class="rg-qcard__q">{q.question}</span>
                </summary>
                <div class="rg-qcard__body">
                    <p><b>你的答案：</b>{userText(q, r)}</p>
                    {#if q.type !== "subjective" && q.type !== "coding"}
                        <p><b>正确答案：</b>{correctText(q, r)}</p>
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
        <section class="rg-analysis">
            <h4>薄弱点分析与复习指导</h4>
            <p>{analysis}</p>
        </section>
    {/if}

    <footer class="rg-result__foot">
        <button class="b3-button b3-button--text" on:click={() => dispatch("save")}>保存到文档</button>
    </footer>
</div>

<style>
    .rg-result { padding: 16px 20px; overflow-y: auto; }
    .rg-result__head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .rg-result__score { font-size: 24px; font-weight: 700; color: var(--b3-theme-primary); }
    .rg-result__unit { font-size: 12px; color: var(--b3-theme-on-surface-light); margin-left: 2px; }
    .rg-result__bar { flex: 1; height: 8px; background: var(--b3-theme-background-light); border-radius: 4px; overflow: hidden; }
    .rg-result__fill { height: 100%; background: var(--b3-theme-primary); transition: width .3s; }
    .rg-result__total { font-size: 13px; color: var(--b3-theme-on-surface-light); }
    .rg-qcard { border: 1px solid var(--b3-border-color); border-radius: 6px; margin-bottom: 8px; }
    .rg-qcard > summary { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; list-style: none; }
    .rg-qcard > summary::-webkit-details-marker { display: none; }
    .rg-qcard__tag { font-size: 11px; padding: 1px 6px; border-radius: 3px; background: var(--b3-theme-background-light); }
    .rg-qcard__score { font-size: 12px; font-weight: 600; color: var(--b3-theme-on-surface); min-width: 52px; }
    .rg-qcard.bad .rg-qcard__score { color: var(--b3-card-error-color); }
    .rg-qcard.ok .rg-qcard__score { color: var(--b3-theme-primary); }
    .rg-qcard__q { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rg-qcard__body { padding: 4px 10px 10px; font-size: 13px; line-height: 1.7; }
    .rg-explain { color: var(--b3-theme-on-surface-light); }
    .rg-comment { background: var(--b3-theme-background-light); padding: 6px 8px; border-radius: 4px; }
    .rg-analysis { margin-top: 16px; padding: 12px; background: var(--b3-theme-background-light); border-radius: 6px; }
    .rg-analysis h4 { margin: 0 0 8px; }
    .rg-result__foot { display: flex; justify-content: flex-end; margin-top: 16px; }
    @media (max-width: 768px) {
        .rg-result__head { flex-wrap: wrap; }
        .rg-qcard__q { white-space: normal; }
    }
</style>
