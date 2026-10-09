<script lang="ts">
    /**
     * 只读高亮代码块。
     *
     * 结果页的参考代码用它：同一套 CodeMirror 主题与语法高亮，但不给编辑能力。
     * 原先结果页遇到编程题只显示一句「见答案」——参考答案就在题目数据里，
     * 却没有任何地方能看到。
     */
    import { onDestroy, onMount } from "svelte";
    import { showMessage } from "siyuan";
    import { Button } from "@/lib/components/ui/button";
    import { cn } from "@/lib/utils";
    import { copyText } from "../ui/clipboard";
    import { CodeViewer, hasLanguageSupport, languageLabel } from "./codemirror";
    import { t } from "../i18n";

    let {
        code,
        language,
        /** 代码块上方的说明，例如「参考代码」 */
        title = undefined,
        class: className = "",
    }: {
        code: string;
        language: string;
        title?: string;
        class?: string;
    } = $props();

    let host = $state<HTMLDivElement | null>(null);
    let viewer: CodeViewer | null = null;
    /** 没有对应语言包时给出说明，免得看起来像高亮坏了 */
    const supported = $derived(hasLanguageSupport(language));

    onMount(() => {
        const el = host;
        if (!el) return;
        const instance = new CodeViewer(el, language, code);
        viewer = instance;
        void instance.mount();
        return () => {
            viewer = null;
            instance.destroy();
        };
    });

    onDestroy(() => viewer?.destroy());

    async function copy() {
        const ok = await copyText(code);
        showMessage(ok ? t("code.copied") : t("code.copyFailed"), ok ? 2000 : 6000, ok ? "info" : "error");
    }
</script>

<div class={cn("border-border overflow-hidden rounded-md border", className)}>
    <div class="border-border bg-muted/40 flex items-center justify-between gap-2 border-b px-2.5 py-1">
        <span class="text-muted-foreground flex flex-wrap items-center gap-2 text-2xs">
            {#if title}
                <span class="font-medium">{title}</span>
            {/if}
            <span class="bg-muted rounded-sm px-1.5 py-0.5 font-mono">{languageLabel(language)}</span>
            {#if !supported}
                <span>{t("code.noHighlight")}</span>
            {/if}
        </span>
        <Button
            variant="ghost"
            size="xs"
            class="h-6 px-1.5 text-2xs"
            aria-label={t("code.copy")}
            title={t("code.copy")}
            onclick={() => void copy()}
        >
            {t("code.copy")}
        </Button>
    </div>
    <div class="min-h-16" style="--rg-code-max-h: 20rem" bind:this={host}></div>
</div>
