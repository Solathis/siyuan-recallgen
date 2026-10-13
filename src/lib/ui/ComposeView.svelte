<script lang="ts">
    /**
     * 「粘贴材料出题」的输入界面。
     *
     * 生成复习题原先只有三条入口：选块、整篇文档、按日期范围取笔记——
     * 都要求内容已经在思源里。临时拿到一段讲义、一份代码或一段网页摘录时，
     * 用户得先新建一篇文档才能出题，这是纯粹的绕路。
     *
     * 这里只负责收集内容与标题，出题流程仍复用 QuizPanel 的那一条；
     * 操作栏与「按日期」共用 GenActionBar，同一个动作只有一种排版。
     */
    import { Button } from "@/lib/components/ui/button";
    import { Field, FieldDescription, FieldLabel } from "@/lib/components/ui/field";
    import { Input } from "@/lib/components/ui/input";
    import { Textarea } from "@/lib/components/ui/textarea";
    import { cn } from "@/lib/utils";
    import { MAX_CONTENT_CHARS } from "../quiz/content";
    import { t } from "../i18n";
    import GenActionBar from "./GenActionBar.svelte";

    /** 与块出题保持同一个下限：太短的内容模型给不出有依据的题目 */
    const MIN_CHARS = 50;

    /** 字数用千位分隔：200000 这种六位数一眼读不出量级 */
    function fmtChars(count: number): string {
        return count.toLocaleString();
    }

    let {
        ongenerate,
        oncancel = () => {},
        aiHint = "",
        aiBlocked = false,
    }: {
        /** 开始出题；调用方负责把内容交给生成流程 */
        ongenerate: (content: string, sourceTitle: string) => void;
        oncancel?: () => void;
        /** 生成前置条件不满足的原因（来自 QuizPanel 的 AI 配置检查） */
        aiHint?: string;
        aiBlocked?: boolean;
    } = $props();

    let content = $state("");
    let title = $state("");

    /** 超长内容直接截断并告知，避免把一整本书送进提示词（模型侧只会回一个 400） */
    const truncated = $derived(content.length > MAX_CONTENT_CHARS);
    const effective = $derived(truncated ? content.slice(0, MAX_CONTENT_CHARS) : content);
    const tooShort = $derived(effective.trim().length < MIN_CHARS);
    const canGenerate = $derived(!tooShort);

    function submit() {
        if (!canGenerate || aiBlocked) return;
        ongenerate(effective, title.trim() || t("compose.sourcePlaceholder"));
    }
</script>

<div class="flex min-h-0 flex-1 flex-col">
    <div class="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div class="mx-auto flex w-full max-w-2xl flex-col gap-6">
            <header class="flex flex-col gap-1">
                <h2 class="text-lg font-semibold">{t("compose.title")}</h2>
                <p class="text-muted-foreground text-sm">{t("compose.desc")}</p>
            </header>

            <Field>
                <div class="flex items-baseline justify-between gap-2">
                    <FieldLabel for="rg-compose-material">{t("compose.materialLabel")}</FieldLabel>
                    <!-- 字数与上限放在同一行右侧：超限提示与数字在同一个位置，不用来回找 -->
                    <span class={cn("text-2xs tabular-nums", truncated ? "text-destructive" : "text-muted-foreground")}>
                        {t("compose.charCount", fmtChars(effective.length), fmtChars(MAX_CONTENT_CHARS))}
                    </span>
                </div>
                <Textarea
                    id="rg-compose-material"
                    class="min-h-64 text-sm"
                    placeholder={t("compose.materialPlaceholder")}
                    value={content}
                    oninput={(e) => (content = e.currentTarget.value)}
                />
                {#if truncated}
                    <FieldDescription class="text-destructive">
                        {t("compose.truncated", fmtChars(MAX_CONTENT_CHARS))}
                    </FieldDescription>
                {:else if tooShort}
                    <FieldDescription>
                        {t("compose.tooShort", String(effective.trim().length), String(MIN_CHARS))}
                    </FieldDescription>
                {/if}
            </Field>

            <Field>
                <FieldLabel for="rg-compose-source">{t("compose.sourceLabel")}</FieldLabel>
                <Input
                    id="rg-compose-source"
                    value={title}
                    placeholder={t("compose.sourcePlaceholder")}
                    oninput={(e) => (title = e.currentTarget.value)}
                />
            </Field>
        </div>
    </div>

    <GenActionBar
        hint={aiHint || (tooShort ? t("compose.tooShort", String(effective.trim().length), String(MIN_CHARS)) : "")}
        hintTone={aiHint ? "destructive" : "muted"}
        primaryLabel={t("compose.generate")}
        onprimary={submit}
        primaryDisabled={aiBlocked || !canGenerate}
        {oncancel}
    >
        {#snippet extra()}
            <Button
                variant="ghost"
                size="sm"
                data-tap
                disabled={content.length === 0}
                onclick={() => {
                    content = "";
                    title = "";
                }}
            >
                {t("compose.clear")}
            </Button>
        {/snippet}
    </GenActionBar>
</div>
