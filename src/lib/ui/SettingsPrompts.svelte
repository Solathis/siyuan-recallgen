<script lang="ts">
    import { Button } from "@/lib/components/ui/button";
    import * as Card from "@/lib/components/ui/card";
    import { Textarea } from "@/lib/components/ui/textarea";
    import { Field, FieldLegend } from "@/lib/components/ui/field";
    import { t } from "../i18n";
    import { getDefaultPrompts, type RecallGenConfig } from "@/types/config";

    let { config, onsave }: { config: RecallGenConfig; onsave: (config: RecallGenConfig) => void } = $props();

    const PROMPT_KEYS = ["generate", "review", "gradeSubjective", "analysis"] as const;

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
        {#each PROMPT_KEYS as key (key)}
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
    </Card.Content>
</Card.Root>
