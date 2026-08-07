<script lang="ts">
    import { onMount, onDestroy, createEventDispatcher } from "svelte";
    import { CodeEditor } from "../editor/codemirror";
    import type { Question, UserAnswer } from "@/types/quiz";

    export let question: Question;
    export let answer: UserAnswer | undefined;

    const dispatch = createEventDispatcher<{ change: UserAnswer }>();
    let editor: CodeEditor | null = null;
    let editorEl: HTMLDivElement;

    function emit(value: UserAnswer) {
        answer = value;
        dispatch("change", value);
    }

    function setSingle(idx: number) {
        emit({ type: "single_choice", value: idx });
    }
    function toggleMulti(idx: number) {
        const cur = answer?.type === "multiple_choice" ? [...answer.value] : [];
        const i = cur.indexOf(idx);
        if (i >= 0) cur.splice(i, 1);
        else cur.push(idx);
        emit({ type: "multiple_choice", value: cur.sort((a, b) => a - b) });
    }
    function setBlank(i: number, v: string) {
        const cur = answer?.type === "fill_blank" ? [...answer.value] : question.type === "fill_blank" ? question.answer.map(() => "") : [];
        cur[i] = v;
        emit({ type: "fill_blank", value: cur });
    }
    function setBool(v: boolean) {
        emit({ type: "true_false", value: v });
    }
    function setSubjective(v: string) {
        emit({ type: "subjective", value: v });
    }
    function onBlankInput(i: number, e: Event) {
        setBlank(i, (e.target as HTMLInputElement).value);
    }
    function onSubjectiveInput(e: Event) {
        setSubjective((e.target as HTMLTextAreaElement).value);
    }
    function setCoding(v: string) {
        emit({ type: "coding", value: v });
    }

    onMount(() => {
        if (question.type === "coding") {
            editor = new CodeEditor(
                editorEl,
                question.language,
                answer?.type === "coding" ? answer.value : (question.starter_code ?? ""),
                (doc) => setCoding(doc),
            );
            void editor.mount();
        }
    });

    onDestroy(() => {
        editor?.destroy();
        editor = null;
    });

    $: answered = answer !== undefined;
</script>

<div class="rg-q">
    <div class="rg-q__title">{question.question}</div>

    {#if question.type === "single_choice"}
        <div class="rg-q__options">
            {#each question.options as opt, i}
                <label class="rg-q__opt" class:checked={answered && answer?.type === "single_choice" && answer.value === i}>
                    <input type="radio" name={question.id} checked={answer?.type === "single_choice" && answer.value === i}
                           on:change={() => setSingle(i)} />
                    <span>{opt}</span>
                </label>
            {/each}
        </div>
    {:else if question.type === "multiple_choice"}
        <div class="rg-q__options">
            {#each question.options as opt, i}
                <label class="rg-q__opt" class:checked={answer?.type === "multiple_choice" && answer.value.includes(i)}>
                    <input type="checkbox" checked={answer?.type === "multiple_choice" && answer.value.includes(i)}
                           on:change={() => toggleMulti(i)} />
                    <span>{opt}</span>
                </label>
            {/each}
        </div>
    {:else if question.type === "fill_blank"}
        <div class="rg-q__blanks">
            {#each question.answer as _opts, i}
                <input class="b3-text-field" type="text" placeholder="第 {i + 1} 空"
                       value={answer?.type === "fill_blank" ? answer.value[i] ?? "" : ""}
                       on:input={(e) => onBlankInput(i, e)} />
            {/each}
        </div>
    {:else if question.type === "true_false"}
        <div class="rg-q__options">
            <label class="rg-q__opt" class:checked={answer?.type === "true_false" && answer.value === true}>
                <input type="radio" name={question.id} checked={answer?.type === "true_false" && answer.value === true}
                       on:change={() => setBool(true)} /><span>正确</span>
            </label>
            <label class="rg-q__opt" class:checked={answer?.type === "true_false" && answer.value === false}>
                <input type="radio" name={question.id} checked={answer?.type === "true_false" && answer.value === false}
                       on:change={() => setBool(false)} /><span>错误</span>
            </label>
        </div>
    {:else if question.type === "subjective"}
        <textarea class="b3-text-field rg-q__textarea" placeholder="输入你的作答（支持 Markdown）"
                  on:input={onSubjectiveInput}
        >{answer?.type === "subjective" ? answer.value : ""}</textarea>
    {:else if question.type === "coding"}
        <div class="rg-q__code" bind:this={editorEl}></div>
    {/if}
</div>

<style>
    .rg-q__title { font-size: 15px; line-height: 1.7; margin-bottom: 12px; white-space: pre-wrap; }
    .rg-q__options { display: flex; flex-direction: column; gap: 8px; }
    .rg-q__opt { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
    .rg-q__opt:hover { background: var(--b3-list-hover); }
    .rg-q__opt.checked { background: var(--b3-theme-primary-lightest); }
    .rg-q__blanks { display: flex; flex-direction: column; gap: 8px; }
    .rg-q__textarea { width: 100%; min-height: 160px; resize: vertical; }
    .rg-q__code { border: 1px solid var(--b3-border-color); border-radius: 6px; overflow: hidden; }
    :global(.rg-q__code .cm-editor) { font-size: 13px; }
    :global(.rg-q__code .cm-scroller) { min-height: 200px; }
</style>
