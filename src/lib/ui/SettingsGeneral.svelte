<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { button, card, field, input, select, switchCls, checkbox, slider, alert, alertTitle, alertDescription, cn } from "./components";
    import type { RecallGenConfig, StorageLocation } from "@/types/config";
    import type { QuestionType } from "@/types/quiz";

    export let config: RecallGenConfig;
    const dispatch = createEventDispatcher<{ save: RecallGenConfig }>();

    const TYPE_OPTIONS: { key: QuestionType; label: string }[] = [
        { key: "single_choice", label: "单选题" },
        { key: "multiple_choice", label: "多选题" },
        { key: "fill_blank", label: "填空题" },
        { key: "true_false", label: "判断题" },
        { key: "subjective", label: "主观题" },
        { key: "coding", label: "编程题" },
    ];

    function v(e: Event): string { return (e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value; }
    function vn(e: Event): number { return parseInt(v(e)) || 0; }
    function checked(e: Event): boolean { return (e.target as HTMLInputElement).checked; }
    function vf(e: Event): number { return parseFloat(v(e)) || 0; }

    let _extraScope = config.general.extraScopePct;
    let _panelWidth = config.general.panelWidth;

    $: diffOk = config.general.difficulty.easy + config.general.difficulty.medium + config.general.difficulty.hard === config.general.difficulty.total;
    $: totalValid = config.general.difficulty.total >= 1 && config.general.difficulty.total <= 50;

    function toggleType(t: QuestionType) {
        const arr = config.general.allowedTypes;
        const i = arr.indexOf(t);
        if (i >= 0) arr.splice(i, 1);
        else arr.push(t);
        dispatch("save", { ...config, general: { ...config.general, allowedTypes: [...arr] } });
    }
    function patchGeneral(patch: Partial<typeof config.general>) {
        dispatch("save", { ...config, general: { ...config.general, ...patch } });
    }
    function patchDifficulty(patch: Partial<typeof config.general.difficulty>) {
        dispatch("save", { ...config, general: { ...config.general, difficulty: { ...config.general.difficulty, ...patch } } });
    }
    function onLangChange(e: Event) { patchGeneral({ language: v(e) as "zh" | "en" }); }
    function onStorageChange(e: Event) { patchGeneral({ storageLocation: v(e) as StorageLocation }); }
</script>

<div class={card.root}>
    <div class={card.header}>
        <h3 class={card.title}>题目与答题</h3>
        <p class={card.description}>题型开关、难度分布、答题行为</p>
    </div>
    <div class={cn(card.content, field.group)}>
        <div class={field.field}>
            <span class={field.label}>允许题型</span>
            <div class="rg-checks">
                {#each TYPE_OPTIONS as opt}
                    <label class="rg-check-item">
                        <input class={checkbox} type="checkbox" checked={config.general.allowedTypes.includes(opt.key)} on:change={() => toggleType(opt.key)} />
                        {opt.label}
                    </label>
                {/each}
            </div>
        </div>
        <div class={field.field}>
            <label class={field.label} for="rg-total">题目数量（1-50）</label>
            <input id="rg-total" class={cn(input, !totalValid && "rg-input--invalid")} type="number" min="1" max="50" value={config.general.difficulty.total} on:input={(e) => patchDifficulty({ total: vn(e) })} />
        </div>
        <div class="rg-row-3">
            <div class={field.field}>
                <label class={field.label} for="rg-easy">初级</label>
                <input id="rg-easy" class={input} type="number" value={config.general.difficulty.easy} on:input={(e) => patchDifficulty({ easy: vn(e) })} />
            </div>
            <div class={field.field}>
                <label class={field.label} for="rg-med">中级</label>
                <input id="rg-med" class={input} type="number" value={config.general.difficulty.medium} on:input={(e) => patchDifficulty({ medium: vn(e) })} />
            </div>
            <div class={field.field}>
                <label class={field.label} for="rg-hard">高级</label>
                <input id="rg-hard" class={input} type="number" value={config.general.difficulty.hard} on:input={(e) => patchDifficulty({ hard: vn(e) })} />
            </div>
        </div>
        {#if !diffOk}
            <div class={alert("warning")}>
                <p class={alertTitle}>难度分布不合法</p>
                <p class={alertDescription}>初级+中级+高级之和须等于总题数（{config.general.difficulty.total}）</p>
            </div>
        {/if}
        <div class={field.field}>
            <span class={field.label}>超纲比例（{_extraScope}%）</span>
            <span class={field.description}>允许 AI 出题时扩展到笔记外的相关知识点，0% = 仅限笔记内容</span>
            <input class={slider} type="range" min="0" max="50" step="5" bind:value={_extraScope} on:change={() => patchGeneral({ extraScopePct: _extraScope })} />
        </div>
        <div class={field.field}>
            <span class={field.label}>答题面板宽度（{_panelWidth}px）</span>
            <span class={field.description}>答题页内容区域的最大宽度，避免过宽或过窄</span>
            <input class={slider} type="range" min="600" max="1600" step="50" bind:value={_panelWidth} on:change={() => patchGeneral({ panelWidth: _panelWidth })} />
        </div>
        <label class="rg-check-item">
            <input class={switchCls} type="checkbox" checked={config.general.countdownEnabled} on:change={(e) => patchGeneral({ countdownEnabled: checked(e) })} />
            启用倒计时
        </label>
        {#if config.general.countdownEnabled}
            <div class={field.field}>
                <label class={field.label} for="rg-cd">答题时间（分钟）</label>
                <input id="rg-cd" class={cn(input, config.general.countdownMinutes <= 0 && "rg-input--invalid")} type="number" min="1" value={config.general.countdownMinutes} on:input={(e) => patchGeneral({ countdownMinutes: Math.max(0, vn(e)) })} />
                {#if config.general.countdownMinutes <= 0}
                    <span class={field.description} style="color:var(--b3-card-error)">请设置大于 0 的答题时间，否则倒计时不会生效</span>
                {/if}
            </div>
        {/if}
        <div class={field.field}>
            <label class={field.label} for="rg-loc">题目存储位置</label>
            <select id="rg-loc" class={select} value={config.general.storageLocation} on:change={onStorageChange}>
                <option value="sibling">源文档同级</option>
                <option value="notebook">固定笔记本</option>
            </select>
        </div>
        {#if config.general.storageLocation === "notebook"}
            <div class={field.field}>
                <label class={field.label} for="rg-nb">笔记本 ID</label>
                <input id="rg-nb" class={input} type="text" value={config.general.notebookId} on:input={(e) => patchGeneral({ notebookId: v(e) })} />
            </div>
        {/if}
    </div>
</div>

<style>
    .rg-row-3 { display: flex; gap: 12px; }
    .rg-row-3 > * { flex: 1; min-width: 0; }
    .rg-checks { display: flex; flex-wrap: wrap; gap: 12px; }
    .rg-check-item { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; color: var(--b3-theme-on-background); }
    :global(.rg-input--invalid) { border-color: var(--b3-card-error); }
    @media (max-width: 640px) { .rg-row-3 { flex-direction: column; } }
</style>
