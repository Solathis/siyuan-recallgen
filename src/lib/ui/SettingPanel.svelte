<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import Heatmap from "./Heatmap.svelte";
    import type { RecallGenConfig, AIProvider, StorageLocation } from "@/types/config";
    import { DEFAULT_PROMPTS } from "@/types/config";
    import type { QuestionType, ScoreRecord } from "@/types/quiz";

    export let config: RecallGenConfig;
    export let scores: ScoreRecord[] = [];
    export let onTestConnection: () => Promise<boolean> = async () => false;
    export let onClearScores: () => Promise<void> = async () => {};
    export let onClearProgress: () => Promise<void> = async () => {};

    const dispatch = createEventDispatcher<{ save: RecallGenConfig }>();
    let connState: "idle" | "testing" | "ok" | "fail" = "idle";
    let activeTab = "ai";

    const TYPE_OPTIONS: { key: QuestionType; label: string }[] = [
        { key: "single_choice", label: "单选题" },
        { key: "multiple_choice", label: "多选题" },
        { key: "fill_blank", label: "填空题" },
        { key: "true_false", label: "判断题" },
        { key: "subjective", label: "主观题" },
        { key: "coding", label: "编程题" },
    ];
    const PROMPT_KEYS = ["generate", "coding", "gradeSubjective", "gradeCoding", "analysis"] as const;
    const PROMPT_LABELS: Record<string, string> = {
        generate: "出题提示词", coding: "编程题指令", gradeSubjective: "主观题判分",
        gradeCoding: "编程题判分", analysis: "薄弱点分析",
    };

    // Svelte 标记内联表达式不支持 TS as，统一通过这些辅助函数取值
    function v(e: Event): string { return (e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value; }
    function vn(e: Event): number { return parseInt(v(e)) || 0; }
    function vf(e: Event): number { return parseFloat(v(e)) || 0; }
    function checked(e: Event): boolean { return (e.target as HTMLInputElement).checked; }

    $: diffOk = config.general.difficulty.easy + config.general.difficulty.medium + config.general.difficulty.hard === config.general.difficulty.total;
    $: totalValid = config.general.difficulty.total >= 1 && config.general.difficulty.total <= 50;

    function toggleType(t: QuestionType) {
        const arr = config.general.allowedTypes;
        const i = arr.indexOf(t);
        if (i >= 0) arr.splice(i, 1);
        else arr.push(t);
        config = { ...config, general: { ...config.general, allowedTypes: [...arr] } };
        dispatch("save", config);
    }

    function patchAi(patch: Partial<typeof config.ai>) {
        config = { ...config, ai: { ...config.ai, ...patch } };
        dispatch("save", config);
    }
    function patchGeneral(patch: Partial<typeof config.general>) {
        config = { ...config, general: { ...config.general, ...patch } };
        dispatch("save", config);
    }
    function patchHeatmap(patch: Partial<typeof config.heatmap>) {
        config = { ...config, heatmap: { ...config.heatmap, ...patch } };
        dispatch("save", config);
    }
    function patchDifficulty(patch: Partial<typeof config.general.difficulty>) {
        config = {
            ...config,
            general: { ...config.general, difficulty: { ...config.general.difficulty, ...patch } },
        };
    }
    function commitDifficulty() {
        if (diffOk) dispatch("save", config);
    }

    function resetPrompt(key: keyof typeof DEFAULT_PROMPTS) {
        config = { ...config, prompts: { ...config.prompts, [key]: DEFAULT_PROMPTS[key] } };
        dispatch("save", config);
    }
    function onPromptInput(key: keyof typeof config.prompts, e: Event) {
        config = { ...config, prompts: { ...config.prompts, [key]: v(e) } };
        dispatch("save", config);
    }

    async function testConn() {
        connState = "testing";
        try {
            const ok = await onTestConnection();
            connState = ok ? "ok" : "fail";
        } catch {
            connState = "fail";
        }
    }

    function addRange() {
        patchHeatmap({ ranges: [...config.heatmap.ranges, { min: 0, max: 0, color: "#cccccc" }] });
    }
    function removeRange(i: number) {
        patchHeatmap({ ranges: config.heatmap.ranges.filter((_, idx) => idx !== i) });
    }
    function patchRange(i: number, patch: Partial<{ min: number; max: number; color: string }>) {
        const ranges = config.heatmap.ranges.map((r, idx) => idx === i ? { ...r, ...patch } : r);
        config = { ...config, heatmap: { ...config.heatmap, ranges } };
        dispatch("save", config);
    }
    function onProviderChange(e: Event) { patchAi({ provider: v(e) as AIProvider }); }
    function onLangChange(e: Event) { patchGeneral({ language: v(e) as "zh" | "en" }); }
    function onStorageChange(e: Event) { patchGeneral({ storageLocation: v(e) as StorageLocation }); }
    function onMetricChange(e: Event) { patchHeatmap({ metric: v(e) as "max" | "avg" }); }
</script>

<div class="rg-settings">
    <nav class="rg-settings__tabs">
        {#each [["ai", "AI 服务"], ["general", "题目与答题"], ["prompts", "提示词"], ["heatmap", "热力图"], ["data", "数据管理"]] as [k, label]}
            <button class:active={activeTab === k} on:click={() => (activeTab = k)}>{label}</button>
        {/each}
    </nav>

    {#if activeTab === "ai"}
        <section class="rg-settings__section">
            <label class="rg-field"><span>服务商</span>
                <select class="b3-select" value={config.ai.provider} on:change={onProviderChange}>
                    <option value="openai">OpenAI 兼容</option>
                    <option value="ollama">Ollama</option>
                    <option value="custom">自定义</option>
                </select>
            </label>
            <label class="rg-field"><span>Base URL</span>
                <input class="b3-text-field" type="text" value={config.ai.baseUrl} on:input={(e) => patchAi({ baseUrl: v(e) })} />
            </label>
            <label class="rg-field"><span>API Key</span>
                <input class="b3-text-field" type="password" value={config.ai.apiKey} on:input={(e) => patchAi({ apiKey: v(e) })} />
            </label>
            <label class="rg-field"><span>模型</span>
                <input class="b3-text-field" type="text" value={config.ai.model} on:input={(e) => patchAi({ model: v(e) })} />
            </label>
            <label class="rg-field"><span>Temperature（{config.ai.temperature.toFixed(1)}）</span>
                <input type="range" min="0" max="2" step="0.1" value={config.ai.temperature}
                       on:input={(e) => patchAi({ temperature: vf(e) })} />
            </label>
            <label class="rg-field"><span>最大 Tokens</span>
                <input class="b3-text-field" type="number" value={config.ai.maxTokens} on:input={(e) => patchAi({ maxTokens: vn(e) })} />
            </label>
            <label class="rg-field"><span>超时（秒）</span>
                <input class="b3-text-field" type="number" value={Math.round(config.ai.timeout / 1000)} on:input={(e) => patchAi({ timeout: vn(e) * 1000 })} />
            </label>
            <div class="rg-settings__row">
                <button class="b3-button" on:click={testConn} disabled={connState === "testing"}>测试连接</button>
                {#if connState === "ok"}<span class="rg-ok">✓ 成功</span>{/if}
                {#if connState === "fail"}<span class="rg-fail">✗ 失败</span>{/if}
            </div>
        </section>
    {:else if activeTab === "general"}
        <section class="rg-settings__section">
            <fieldset class="rg-field">
                <legend>允许题型</legend>
                <div class="rg-checks">
                    {#each TYPE_OPTIONS as opt}
                        <label><input type="checkbox" checked={config.general.allowedTypes.includes(opt.key)} on:change={() => toggleType(opt.key)} />{opt.label}</label>
                    {/each}
                </div>
            </fieldset>
            <div class="rg-field"><span>题目数量（1-50）</span>
                <input class="b3-text-field" type="number" min="1" max="50" value={config.general.difficulty.total}
                       class:invalid={!totalValid}
                       on:input={(e) => patchDifficulty({ total: vn(e) })} />
            </div>
            <div class="rg-diff">
                <label>初级 <input class="b3-text-field" type="number" value={config.general.difficulty.easy} on:input={(e) => patchDifficulty({ easy: vn(e) })} /></label>
                <label>中级 <input class="b3-text-field" type="number" value={config.general.difficulty.medium} on:input={(e) => patchDifficulty({ medium: vn(e) })} /></label>
                <label>高级 <input class="b3-text-field" type="number" value={config.general.difficulty.hard} on:input={(e) => patchDifficulty({ hard: vn(e) })} /></label>
            </div>
            {#if !diffOk}<p class="rg-fail">难度数量之和须等于总题数</p>{/if}
            <button class="b3-button" on:click={commitDifficulty} disabled={!diffOk}>保存难度分布</button>
            <label class="rg-field"><span>默认语言</span>
                <select class="b3-select" value={config.general.language} on:change={onLangChange}>
                    <option value="zh">中文</option><option value="en">English</option>
                </select>
            </label>
            <label class="rg-checks"><input type="checkbox" checked={config.general.countdownEnabled} on:change={(e) => patchGeneral({ countdownEnabled: checked(e) })} />启用倒计时</label>
            {#if config.general.countdownEnabled}
                <label class="rg-field"><span>倒计时分钟</span>
                    <input class="b3-text-field" type="number" value={config.general.countdownMinutes} on:input={(e) => patchGeneral({ countdownMinutes: vn(e) })} />
                </label>
            {/if}
            <label class="rg-field"><span>题目存储位置</span>
                <select class="b3-select" value={config.general.storageLocation} on:change={onStorageChange}>
                    <option value="sibling">源文档同级</option><option value="notebook">固定笔记本</option>
                </select>
            </label>
            {#if config.general.storageLocation === "notebook"}
                <label class="rg-field"><span>笔记本 ID</span>
                    <input class="b3-text-field" type="text" value={config.general.notebookId} on:input={(e) => patchGeneral({ notebookId: v(e) })} />
                </label>
            {/if}
        </section>
    {:else if activeTab === "prompts"}
        <section class="rg-settings__section">
            {#each PROMPT_KEYS as key}
                <div class="rg-prompt">
                    <div class="rg-prompt__head"><span>{PROMPT_LABELS[key]}</span>
                        <button class="b3-button b3-button--small" on:click={() => resetPrompt(key)}>重置默认</button>
                    </div>
                    <textarea class="b3-text-field rg-prompt__ta"
                              on:input={(e) => onPromptInput(key, e)}>{config.prompts[key]}</textarea>
                </div>
            {/each}
        </section>
    {:else if activeTab === "heatmap"}
        <section class="rg-settings__section">
            <Heatmap {scores} config={config.heatmap} />
            <label class="rg-field"><span>聚合方式</span>
                <select class="b3-select" value={config.heatmap.metric} on:change={onMetricChange}>
                    <option value="max">每日最高分</option><option value="avg">每日平均分</option>
                </select>
            </label>
            <label class="rg-field"><span>显示天数</span>
                <input class="b3-text-field" type="number" value={config.heatmap.days} on:input={(e) => patchHeatmap({ days: vn(e) || 90 })} />
            </label>
            <div class="rg-ranges">
                {#each config.heatmap.ranges as r, i}
                    <div class="rg-range">
                        <input class="b3-text-field" type="number" placeholder="min" value={r.min} on:input={(e) => patchRange(i, { min: vn(e) })} />
                        <input class="b3-text-field" type="number" placeholder="max" value={r.max} on:input={(e) => patchRange(i, { max: vn(e) })} />
                        <input type="color" value={r.color} on:input={(e) => patchRange(i, { color: v(e) })} />
                        <button class="b3-button b3-button--small" on:click={() => removeRange(i)}>删除</button>
                    </div>
                {/each}
                <button class="b3-button" on:click={addRange}>添加区间</button>
            </div>
        </section>
    {:else if activeTab === "data"}
        <section class="rg-settings__section">
            <button class="b3-button" on:click={onClearScores}>清空成绩记录</button>
            <button class="b3-button" on:click={onClearProgress}>清空答题进度</button>
        </section>
    {/if}
</div>

<style>
    .rg-settings { padding: 12px 16px; }
    .rg-settings__tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--b3-border-color); margin-bottom: 12px; flex-wrap: wrap; }
    .rg-settings__tabs button { padding: 6px 10px; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; color: var(--b3-theme-on-surface); }
    .rg-settings__tabs button.active { border-bottom-color: var(--b3-theme-primary); color: var(--b3-theme-primary); }
    .rg-settings__section { display: flex; flex-direction: column; gap: 12px; max-width: 640px; }
    .rg-field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    .rg-field > span { color: var(--b3-theme-on-surface-light); }
    .rg-checks { display: flex; flex-wrap: wrap; gap: 12px; }
    .rg-diff { display: flex; gap: 12px; flex-wrap: wrap; }
    .rg-diff label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; flex: 1; min-width: 80px; }
    .rg-settings__row { display: flex; align-items: center; gap: 12px; }
    .rg-ok { color: #4caf50; } .rg-fail { color: var(--b3-card-error-color); }
    .rg-prompt__head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .rg-prompt__ta { width: 100%; min-height: 100px; resize: vertical; font-family: monospace; font-size: 12px; }
    .rg-ranges { display: flex; flex-direction: column; gap: 6px; }
    .rg-range { display: flex; gap: 6px; align-items: center; }
    .rg-range .b3-text-field { width: 70px; }
    :global(.b3-text-field.invalid) { border-color: var(--b3-card-error-color); }
    @media (max-width: 768px) { .rg-settings__section { max-width: 100%; } }
</style>
