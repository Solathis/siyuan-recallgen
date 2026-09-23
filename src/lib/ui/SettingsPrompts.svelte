<script lang="ts">
    import { button, card, field, textarea, cn } from "./components";
    import { t } from "../i18n";
    import type { RecallGenConfig } from "@/types/config";
    import { getDefaultPrompts } from "@/types/config";

    export let config: RecallGenConfig;
    /** 保存回调：Svelte 5 挂载方式下不再使用事件派发 */
    export let onsave: (config: RecallGenConfig) => void = () => {};

    const PROMPT_KEYS = ["generate", "review", "gradeSubjective", "analysis"] as const;
    const PROMPT_LABELS: Record<string, string> = {
        generate: t("settings.prompts.generate"),
        review: t("settings.prompts.review"),
        gradeSubjective: t("settings.prompts.gradeSubjective"),
        analysis: t("settings.prompts.analysis"),
    };

    function v(e: Event): string {
        return (e.target as HTMLTextAreaElement).value;
    }
    function onPromptInput(key: keyof typeof config.prompts, e: Event) {
        onsave({ ...config, prompts: { ...config.prompts, [key]: v(e) } });
    }
    function resetPrompt(key: keyof typeof config.prompts) {
        // 按「输出语言」取对应语言的默认提示词，而不是固定用中文
        const defaults = getDefaultPrompts(config.general.language);
        onsave({ ...config, prompts: { ...config.prompts, [key]: defaults[key] } });
    }
</script>

<div class={card.root}>
    <div class={card.header}>
        <h3 class={card.title}>{t("settings.prompts.title")}</h3>
        <p class={card.description}>{t("settings.prompts.desc")}</p>
    </div>
    <div class={cn(card.content, field.group)}>
        {#each PROMPT_KEYS as key}
            <div class={field.field}>
                <div class="rg-prompt-head">
                    <span class={field.label}>{PROMPT_LABELS[key]}</span>
                    <button class={button({ variant: "ghost", size: "sm" })} on:click={() => resetPrompt(key)}
                        >{t("settings.prompts.reset")}</button
                    >
                </div>
                <textarea class={cn(textarea, "rg-prompt-ta")} on:input={(e) => onPromptInput(key, e)}
                    >{config.prompts[key]}</textarea
                >
            </div>
        {/each}
    </div>
</div>

<style>
    .rg-prompt-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    :global(.rg-prompt-ta) {
        min-height: 100px;
        font-family: var(--b3-font-family-code, monospace);
        font-size: 12px;
    }
</style>
