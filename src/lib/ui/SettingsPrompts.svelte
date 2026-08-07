<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { button, card, field, textarea, cn } from "./components";
    import type { RecallGenConfig } from "@/types/config";
    import { DEFAULT_PROMPTS } from "@/types/config";

    export let config: RecallGenConfig;
    const dispatch = createEventDispatcher<{ save: RecallGenConfig }>();

    const PROMPT_KEYS = ["generate", "coding", "gradeSubjective", "gradeCoding", "analysis"] as const;
    const PROMPT_LABELS: Record<string, string> = {
        generate: "出题提示词", coding: "编程题指令", gradeSubjective: "主观题判分",
        gradeCoding: "编程题判分", analysis: "薄弱点分析",
    };

    function v(e: Event): string { return (e.target as HTMLTextAreaElement).value; }
    function onPromptInput(key: keyof typeof config.prompts, e: Event) {
        dispatch("save", { ...config, prompts: { ...config.prompts, [key]: v(e) } });
    }
    function resetPrompt(key: keyof typeof DEFAULT_PROMPTS) {
        dispatch("save", { ...config, prompts: { ...config.prompts, [key]: DEFAULT_PROMPTS[key] } });
    }
</script>

<div class={card.root}>
    <div class={card.header}>
        <h3 class={card.title}>提示词管理</h3>
        <p class={card.description}>各环节提示词均可编辑，支持重置默认</p>
    </div>
    <div class={cn(card.content, field.group)}>
        {#each PROMPT_KEYS as key}
            <div class={field.field}>
                <div class="rg-prompt-head">
                    <span class={field.label}>{PROMPT_LABELS[key]}</span>
                    <button class={button({ variant: "ghost", size: "sm" })} on:click={() => resetPrompt(key)}>重置默认</button>
                </div>
                <textarea class={cn(textarea, "rg-prompt-ta")} on:input={(e) => onPromptInput(key, e)}>{config.prompts[key]}</textarea>
            </div>
        {/each}
    </div>
</div>

<style>
    .rg-prompt-head { display: flex; justify-content: space-between; align-items: center; }
    :global(.rg-prompt-ta) { min-height: 100px; font-family: var(--b3-font-family-code, monospace); font-size: 12px; }
</style>
