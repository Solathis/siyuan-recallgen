<script lang="ts">
    import { t } from "../i18n";
    import { onMount } from "svelte";
    import { Button } from "@/lib/components/ui/button";
    import { Textarea } from "@/lib/components/ui/textarea";
    import type { QuizService } from "../quiz/service";
    import type { PromptConfig } from "@/types/config";
    import { workflowId, type WorkflowState, type PromptSuggestion } from "../quiz/review-workflow";
    import ReviewQueue from "./ReviewQueue.svelte";
    let { service, mode = "versions" }: { service: QuizService; mode?: "versions" | "feedback" } = $props();
    let filter = $state("");
    let editing = $state(false);
    let editorKey = $state<keyof PromptConfig>("generate");
    let data = $state<WorkflowState>({ versions: [], activeId: "", pending: [], records: [], suggestions: [] });
    let baseId = $state("");
    let compareId = $state("");
    let scenario = $state("");
    let summary = $state("");
    let draft = $state<PromptConfig>({ generate: "", review: "", gradeSubjective: "", analysis: "" });
    let selected = $state<string[]>([]);
    let applied = $state<string[]>([]);
    let error = $state("");
    let busy = $state(false);
    const keys = ["generate", "review", "gradeSubjective", "analysis"] as const;
    const base = $derived(data.versions.find((v) => v.id === baseId));
    const compare = $derived(data.versions.find((v) => v.id === compareId));
    const visible = $derived(
        data.versions.filter((v) => !v.automatic && !v.deleted && (!filter || v.scenarios.includes(filter)))
    );
    async function refresh() {
        data = await service.workflow!.snapshot();
    }
    function branch(id: string) {
        const version = data.versions.find((v) => v.id === id);
        if (!version) return;
        baseId = id;
        editing = true;
        draft = JSON.parse(JSON.stringify(version.prompts));
        summary = "";
        applied = [];
        selected = [];
    }
    async function run(action: () => Promise<void>) {
        busy = true;
        error = "";
        try {
            await action();
            await refresh();
        } catch (e) {
            error = String(e);
        } finally {
            busy = false;
        }
    }
    onMount(() => {
        void run(async () => {
            await refresh();
            draft = JSON.parse(JSON.stringify(service.getConfig().prompts));
        });
    });
    async function save() {
        if (!summary.trim()) throw new Error("请填写变更摘要");
        await service.workflow!.saveVersion({
            id: workflowId(),
            parentId: baseId,
            createdAt: Date.now(),
            source: applied.length ? "analysis" : baseId ? "derived" : "manual",
            scenarios: scenario
                .split(/[,，]/)
                .map((s) => s.trim())
                .filter(Boolean),
            summary,
            prompts: JSON.parse(JSON.stringify(draft)),
        });
    }
    function applySuggestions() {
        const next = JSON.parse(JSON.stringify(draft));
        for (const id of selected) {
            const suggestion = data.suggestions.find((s) => s.id === id)!;
            const records = data.records.filter((r) => suggestion.evidenceIds.includes(r.id));
            if (records.some((r) => r.versionId !== baseId)) throw new Error("请先从建议对应的提示词版本创建分支");
            if (!next[suggestion.target].includes(suggestion.before))
                throw new Error("原文不匹配或建议冲突，请逐条核对");
            next[suggestion.target] = next[suggestion.target].replace(suggestion.before, suggestion.after);
        }
        draft = next;
        applied = [...new Set([...applied, ...selected])];
        selected = [];
    }
    function evidence(s: PromptSuggestion) {
        return data.records.filter((r) => s.evidenceIds.includes(r.id));
    }
</script>

<section class="flex flex-col gap-4" aria-label={t("workflow.PromptWorkbench.25")}>
    <header hidden>
        <h2 class="font-semibold text-lg">{t("workflow.PromptWorkbench.1")}</h2>
        <p class="text-sm text-muted-foreground">
            {t("workflow.PromptWorkbench.2")}{data.versions.find((v) => v.id === data.activeId)?.summary ?? "未建立"} · {data.activeId.slice(
                0,
                8
            )}
        </p>
    </header>
    {#if error}<p role="alert" class="text-destructive">{error}</p>{/if}
    {#if mode === "versions"}
        <Button
            variant="outline"
            onclick={() => {
                baseId = "";
                draft = JSON.parse(JSON.stringify(service.getConfig().prompts));
                editing = true;
            }}>{t("prompt.saveSnapshot")}</Button
        >
        <label
            >{t("prompt.filter")}<input
                class="border rounded p-2 w-full"
                aria-label={t("workflow.PromptWorkbench.26")}
                bind:value={filter}
                list="prompt-scenarios"
            /></label
        >
        <datalist id="prompt-scenarios"
            >{#each [...new Set(data.versions.flatMap((v) => v.scenarios))] as tag (tag)}<option value={tag}
                ></option>{/each}</datalist
        >
        <div class="divide-y rounded-md border">
            {#each visible as version (version.id)}
                <div class="px-3 py-1.5 flex flex-wrap gap-x-3 gap-y-1 items-center text-xs">
                    <span class="min-w-40 flex-1"
                        >{version.summary} · {version.id.slice(0, 8)} · {version.source} · {version.scenarios.join(
                            "、"
                        )}<small class="block text-muted-foreground"
                            >{t("workflow.PromptWorkbench.4")}{version.parentId?.slice(0, 8) ?? "无"} · {new Date(
                                version.createdAt
                            ).toLocaleString()}</small
                        ></span
                    >
                    <Button
                        size="sm"
                        class="h-7 px-2 text-xs"
                        variant="ghost"
                        disabled={busy}
                        onclick={() => branch(version.id)}>{t("workflow.PromptWorkbench.5")}</Button
                    >
                    <Button
                        size="sm"
                        class="h-7 px-2 text-xs"
                        variant="ghost"
                        disabled={busy}
                        onclick={() => {
                            if (window.confirm(t("prompt.confirmApply")))
                                void run(() => service.workflow!.activate(version.id));
                        }}>{t("workflow.PromptWorkbench.6")}</Button
                    >
                    <Button size="sm" class="h-7 px-2 text-xs" variant="ghost" onclick={() => (compareId = version.id)}
                        >{t("workflow.PromptWorkbench.7")}</Button
                    >
                    <Button
                        size="sm"
                        class="h-7 px-2 text-xs text-destructive"
                        variant="ghost"
                        disabled={busy}
                        onclick={() => {
                            if (window.confirm(t("prompt.confirmDelete")))
                                void run(async () => {
                                    await service.workflow!.deleteVersion(version.id);
                                    if (compareId === version.id) compareId = "";
                                    if (baseId === version.id) {
                                        baseId = "";
                                        editing = false;
                                    }
                                });
                        }}>{t("prompt.delete")}</Button
                    >
                </div>
            {/each}
        </div>
    {/if}
    {#if editing}
        <h3 class="font-semibold">{t("workflow.PromptWorkbench.8")}{base?.summary ?? "当前设置"}</h3>
        <div class="flex flex-wrap gap-2">
            {#each keys as key (key)}<Button
                    variant={editorKey === key ? "secondary" : "ghost"}
                    onclick={() => (editorKey = key)}>{t(`settings.prompts.${key}`)}</Button
                >{/each}
        </div>
        {#each keys.filter((key) => key === editorKey) as key (key)}
            <label
                >{key}<Textarea
                    class="min-h-28 font-mono text-xs"
                    aria-label={`版本 ${key}`}
                    bind:value={draft[key]}
                /></label
            >
            {#if compare && compare.prompts[key] !== draft[key]}
                <div class="grid grid-cols-2 gap-2 text-xs">
                    <pre class="whitespace-pre-wrap border p-2 overflow-auto">{t("workflow.PromptWorkbench.9")}{compare
                            .prompts[key]}</pre>
                    <pre class="whitespace-pre-wrap border p-2 overflow-auto">{t("workflow.PromptWorkbench.10")}{draft[
                            key
                        ]}</pre>
                </div>
            {/if}
        {/each}
        <label>{t("prompt.tags")}<input class="border rounded p-2 w-full" bind:value={scenario} /></label>
        <label
            >{t("workflow.PromptWorkbench.11")}<input
                class="border rounded p-2 w-full"
                aria-label={t("workflow.PromptWorkbench.27")}
                bind:value={summary}
            /></label
        >
        <Button disabled={busy} onclick={() => run(save)}>{t("workflow.PromptWorkbench.12")}</Button>
    {/if}
    {#if mode === "feedback"}
        <section class="border rounded p-4 flex flex-col gap-3">
            <h3 class="font-semibold">
                {t("workflow.PromptWorkbench.13")}{data.records.length}{t("workflow.PromptWorkbench.14")}
            </h3>
            <p class="text-sm text-muted-foreground">{t("workflow.PromptWorkbench.15")}</p>
            <Button disabled={busy || !data.records.length} onclick={() => run(() => service.workflow!.analyze())}
                >{busy ? "处理中…" : "分析审核记录"}</Button
            >
            {#each data.suggestions as suggestion (suggestion.id)}
                <article class="border rounded p-3 flex flex-col gap-2">
                    <label
                        ><input type="checkbox" bind:group={selected} value={suggestion.id} />{t(
                            "workflow.PromptWorkbench.16"
                        )}{suggestion.pattern}</label
                    >
                    <p>
                        {t("workflow.PromptWorkbench.17")}{suggestion.frequency}{t(
                            "workflow.PromptWorkbench.18"
                        )}{Math.min(50, data.records.length)}{t("workflow.PromptWorkbench.19")}{suggestion.target}
                    </p>
                    <pre class="whitespace-pre-wrap text-xs">{t(
                            "workflow.PromptWorkbench.20"
                        )}{suggestion.before}{"\n"}{t("workflow.PromptWorkbench.21")}{suggestion.after}</pre>
                    <details>
                        <summary>{t("workflow.PromptWorkbench.22")}</summary
                        >{#each evidence(suggestion) as record (record.id)}<div class="border-t py-2 text-sm">
                                <p>{record.id} · {record.action} · {record.reason}</p>
                                <pre class="whitespace-pre-wrap">{JSON.stringify(
                                        { original: record.original, revised: record.question },
                                        null,
                                        2
                                    )}</pre>
                            </div>{/each}
                    </details>
                </article>
            {/each}
            <Button
                variant="outline"
                disabled={!selected.length || busy}
                onclick={() => {
                    try {
                        const ids = [...selected];
                        const suggestion = data.suggestions.find((s) => ids.includes(s.id));
                        const record = data.records.find((r) => suggestion?.evidenceIds.includes(r.id));
                        if (record) branch(record.versionId);
                        selected = ids;
                        applySuggestions();
                        error = "";
                    } catch (e) {
                        error = String(e);
                    }
                }}>{t("workflow.PromptWorkbench.23")}</Button
            >
        </section>
        <details>
            <summary>{t("workflow.PromptWorkbench.24")}{data.pending.length} 题</summary><ReviewQueue
                {service}
                ondone={() => void refresh()}
            />
        </details>
    {/if}
</section>
