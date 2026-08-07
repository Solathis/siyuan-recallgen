<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy } from "svelte";
    import { button, input, textarea, card, cn } from "./components";
    import type { QuizService, ChatTurn } from "../quiz/service";
    import type { GradingResult, Question } from "@/types/quiz";

    export let service: QuizService;
    export let questions: Question[];
    export let results: GradingResult[];
    export let analysis: string;

    let history: ChatTurn[] = [];
    let inputText = "";
    let loading = false;
    let scrollEl: HTMLElement | null = null;

    const dispatch = createEventDispatcher<{ close: void }>();

    onMount(() => { scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" }); });

    function onInput(e: Event) {
        inputText = (e.target as HTMLTextAreaElement).value;
    }

    function onInputGrow(e: Event) {
        const el = e.target as HTMLTextAreaElement;
        inputText = el.value;
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 120) + "px";
    }

    async function send() {
        const msg = inputText.trim();
        if (!msg || loading) return;
        loading = true;
        history = [...history, { role: "user", content: msg }];
        inputText = "";
        await tick();
        scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
        try {
            const reply = await service.chat(questions, results, analysis, history.slice(0, -1), msg);
            history = [...history, { role: "assistant", content: reply }];
        } catch (e) {
            history = [...history, { role: "assistant", content: `（出错了：${(e as Error).message}）` }];
        } finally {
            loading = false;
            await tick();
            scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
        }
    }

    function onKey(e: KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
        }
    }

    function tick(): Promise<void> {
        return new Promise((r) => setTimeout(r, 0));
    }
</script>

<div class="rg-chat">
    <div class="rg-chat__head">
        <span class="rg-chat__title">AI 答疑对话</span>
        <button class={button({ variant: "ghost", size: "sm" })} on:click={() => dispatch("close")}>收起</button>
    </div>
    <div class="rg-chat__msgs" bind:this={scrollEl}>
        {#if history.length === 0}
            <p class="rg-chat__empty">可以向 AI 追问本次答题中的任何问题，例如"第 3 题为什么选 B？"、"XX 概念怎么理解？"</p>
        {/if}
        {#each history as turn, i}
            <div class="rg-chat__msg" class:rg-chat__msg--user={turn.role === "user"} class:rg-chat__msg--ai={turn.role === "assistant"}>
                <span class="rg-chat__role">{turn.role === "user" ? "我" : "AI"}</span>
                <span class="rg-chat__text">{turn.content}</span>
            </div>
        {/each}
        {#if loading}
            <div class="rg-chat__msg rg-chat__msg--ai">
                <span class="rg-chat__role">AI</span>
                <span class="rg-chat__typing">思考中…</span>
            </div>
        {/if}
    </div>
    <div class="rg-chat__input">
        <textarea
            class={textarea}
            placeholder="输入问题，Enter 发送，Shift+Enter 换行"
            value={inputText}
            on:input={onInputGrow}
            on:keydown={onKey}
            disabled={loading}
        ></textarea>
        <button class={button({ variant: "default", size: "sm" })} on:click={send} disabled={loading || !inputText.trim()}>
            发送
        </button>
    </div>
</div>

<style>
    .rg-chat { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); padding: 12px; background: var(--b3-theme-background); }
    .rg-chat__head { display: flex; align-items: center; justify-content: space-between; }
    .rg-chat__title { font-size: 14px; font-weight: 600; color: var(--b3-theme-on-background); }
    .rg-chat__msgs { display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; min-height: 80px; }
    .rg-chat__empty { font-size: 13px; color: var(--b3-theme-on-surface-light); text-align: center; padding: 16px 8px; }
    .rg-chat__msg { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: var(--b3-border-radius); font-size: 13px; line-height: 1.6; }
    .rg-chat__msg--user { background: var(--b3-theme-primary-light); align-self: flex-end; max-width: 85%; }
    .rg-chat__msg--ai { background: var(--b3-theme-background-light); align-self: flex-start; max-width: 90%; }
    .rg-chat__role { font-size: 11px; color: var(--b3-theme-on-surface-light); font-weight: 600; }
    .rg-chat__text { white-space: pre-wrap; word-break: break-word; }
    .rg-chat__typing { color: var(--b3-theme-on-surface-light); font-style: italic; }
    .rg-chat__input { display: flex; gap: 8px; align-items: flex-end; }
    .rg-chat__input textarea { flex: 1; min-height: 40px; resize: none; }
</style>
