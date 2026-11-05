<script lang="ts">
    import { Button } from "@/lib/components/ui/button";
    import * as Card from "@/lib/components/ui/card";
    import { Textarea } from "@/lib/components/ui/textarea";
    import { Field, FieldLegend } from "@/lib/components/ui/field";
    import { t } from "../i18n";
    import { getDefaultPrompts, type RecallGenConfig } from "@/types/config";
    import PromptWorkbench from "./PromptWorkbench.svelte";

    let {
        config,
        onsave,
        service,
    }: {
        config: RecallGenConfig;
        onsave: (config: RecallGenConfig) => void;
        service?: import("../quiz/service").QuizService;
    } = $props();

    const PROMPT_KEYS = ["generate", "review", "gradeSubjective", "analysis"] as const;
    let page = $state("current");
    let promptKey = $state<(typeof PROMPT_KEYS)[number]>("generate");

    function labelOf(key: (typeof PROMPT_KEYS)[number]): string {
        return t(`settings.prompts.${key}`);
    }

    function patchPrompt(key: (typeof PROMPT_KEYS)[number], value: string) {
        onsave({ ...config, prompts: { ...config.prompts, [key]: value } });
    }

    function resetPrompt(key: (typeof PROMPT_KEYS)[number]) {
        // 按「输出语言」取对应语言的默认提示词，而不是固定用中文
        const defaults = getDefaultPrompts(config.general.language);
        patchPrompt(key, defaults[key]);
    }

    function resetAll() {
        const defaults = getDefaultPrompts(config.general.language);
        onsave({ ...config, prompts: { ...defaults } });
    }
</script>

<Card.Root>
    <Card.Header>
        <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
                <Card.Title>{t("settings.prompts.title")}</Card.Title>
                <Card.Description>{t("settings.prompts.desc")}</Card.Description>
            </div>
            <Button variant="outline" size="sm" data-tap onclick={resetAll}>{t("settings.prompts.resetAll")}</Button>
        </div>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
        <div class="flex gap-2" role="tablist">
            {#each ["current", "versions", "feedback"] as tab (tab)}
                <Button
                    role="tab"
                    aria-selected={page === tab}
                    variant={page === tab ? "secondary" : "ghost"}
                    onclick={() => (page = tab)}>{t(`prompt.${tab}`)}</Button
                >
            {/each}
        </div>
        {#if page === "current"}
            <p class="text-sm text-muted-foreground">{t("prompt.direct")}</p>
            {#if service?.workflow}<Button
                    variant="outline"
                    onclick={() => {
                        page = "versions";
                    }}>{t("prompt.saveSnapshot")}</Button
                >{/if}
            <div class="flex flex-wrap gap-2">
                {#each PROMPT_KEYS as key (key)}<Button
                        variant={promptKey === key ? "secondary" : "ghost"}
                        onclick={() => (promptKey = key)}>{labelOf(key)}</Button
                    >{/each}
            </div>
            {#each PROMPT_KEYS.filter((key) => key === promptKey) as key (key)}
                <Field>
                    <div class="flex items-center justify-between">
                        <FieldLegend variant="label">{labelOf(key)}</FieldLegend>
                        <Button variant="ghost" size="sm" data-tap onclick={() => resetPrompt(key)}>
                            {t("settings.prompts.reset")}
                        </Button>
                    </div>
                    <Textarea
                        class="min-h-28 font-mono text-xs"
                        aria-label={labelOf(key)}
                        value={config.prompts[key]}
                        oninput={(e) => patchPrompt(key, e.currentTarget.value)}
                    />
                </Field>
            {/each}
        {:else if service?.workflow}<PromptWorkbench
                {service}
                mode={page === "feedback" ? "feedback" : "versions"}
            />{/if}
    </Card.Content>
</Card.Root>
