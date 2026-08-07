<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import Heatmap from "./Heatmap.svelte";
    import Tabs from "./components/Tabs.svelte";
    import TabsList from "./components/TabsList.svelte";
    import TabsTrigger from "./components/TabsTrigger.svelte";
    import TabsContent from "./components/TabsContent.svelte";
    import { button, badge, card, field, input, textarea, select, label, slider, switchCls, checkbox, alert, alertTitle, alertDescription, cn } from "./components";
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
        config = { ...config, general: { ...config.general, difficulty: { ...config.general.difficulty, ...patch } } };
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

<div class="rg-setting-panel">
    <Tabs bind:value={activeTab}>
        <TabsList>
            <TabsTrigger value="ai">AI 服务</TabsTrigger>
            <TabsTrigger value="general">题目与答题</TabsTrigger>
            <TabsTrigger value="prompts">提示词</TabsTrigger>
            <TabsTrigger value="heatmap">热力图</TabsTrigger>
            <TabsTrigger value="data">数据管理</TabsTrigger>
        </TabsList>

        <TabsContent value="ai">
            <div class={card.root}>
                <div class={card.header}>
                    <h3 class={card.title}>AI 服务配置</h3>
                    <p class={card.description}>配置 LLM 接口，经思源内核 forwardProxy 代理转发</p>
                </div>
                <div class={cn(card.content, field.group)}>
                    <div class={field.field}>
                        <label class={field.label} for="rg-provider">服务商</label>
                        <select id="rg-provider" class={select} value={config.ai.provider} on:change={onProviderChange}>
                            <option value="openai">OpenAI 兼容</option>
                            <option value="ollama">Ollama</option>
                            <option value="custom">自定义</option>
                        </select>
                    </div>
                    <div class={field.field}>
                        <label class={field.label} for="rg-baseurl">Base URL</label>
                        <input id="rg-baseurl" class={input} type="text" value={config.ai.baseUrl} on:input={(e) => patchAi({ baseUrl: v(e) })} />
                    </div>
                    <div class={field.field}>
                        <label class={field.label} for="rg-key">API Key</label>
                        <input id="rg-key" class={input} type="password" value={config.ai.apiKey} on:input={(e) => patchAi({ apiKey: v(e) })} />
                    </div>
                    <div class={field.field}>
                        <label class={field.label} for="rg-model">模型</label>
                        <input id="rg-model" class={input} type="text" value={config.ai.model} on:input={(e) => patchAi({ model: v(e) })} />
                    </div>
                    <div class={field.field}>
                        <label class={field.label}>Temperature（{config.ai.temperature.toFixed(1)}）</label>
                        <input class={slider} type="range" min="0" max="2" step="0.1" value={config.ai.temperature} on:input={(e) => patchAi({ temperature: vf(e) })} />
                    </div>
                    <div class="rg-row-2">
                        <div class={field.field}>
                            <label class={field.label} for="rg-tokens">最大 Tokens</label>
                            <input id="rg-tokens" class={input} type="number" value={config.ai.maxTokens} on:input={(e) => patchAi({ maxTokens: vn(e) })} />
                        </div>
                        <div class={field.field}>
                            <label class={field.label} for="rg-timeout">超时（秒）</label>
                            <input id="rg-timeout" class={input} type="number" value={Math.round(config.ai.timeout / 1000)} on:input={(e) => patchAi({ timeout: vn(e) * 1000 })} />
                        </div>
                    </div>
                    <div class="rg-row">
                        <button class={button({ variant: "outline", size: "sm" })} on:click={testConn} disabled={connState === "testing"}>
                            {connState === "testing" ? "测试中…" : "测试连接"}
                        </button>
                        {#if connState === "ok"}<span class={badge("success")}>连接成功</span>{/if}
                        {#if connState === "fail"}<span class={badge("destructive")}>连接失败</span>{/if}
                    </div>
                </div>
            </div>
        </TabsContent>

        <TabsContent value="general">
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
                    <button class={button({ variant: "default", size: "sm" })} on:click={commitDifficulty} disabled={!diffOk}>保存难度分布</button>
                    <div class={field.field}>
                        <label class={field.label} for="rg-lang">默认语言</label>
                        <select id="rg-lang" class={select} value={config.general.language} on:change={onLangChange}>
                            <option value="zh">中文</option>
                            <option value="en">English</option>
                        </select>
                    </div>
                    <label class="rg-check-item">
                        <input class={switchCls} type="checkbox" checked={config.general.countdownEnabled} on:change={(e) => patchGeneral({ countdownEnabled: checked(e) })} />
                        启用倒计时
                    </label>
                    {#if config.general.countdownEnabled}
                        <div class={field.field}>
                            <label class={field.label} for="rg-cd">倒计时分钟</label>
                            <input id="rg-cd" class={input} type="number" value={config.general.countdownMinutes} on:input={(e) => patchGeneral({ countdownMinutes: vn(e) })} />
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
        </TabsContent>

        <TabsContent value="prompts">
            <div class={cn(card.root)}>
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
        </TabsContent>

        <TabsContent value="heatmap">
            <div class={card.root}>
                <div class={card.header}>
                    <h3 class={card.title}>热力图设置</h3>
                    <p class={card.description}>成绩日历与配色区间</p>
                </div>
                <div class={cn(card.content, field.group)}>
                    <Heatmap {scores} config={config.heatmap} />
                    <div class={field.field}>
                        <label class={field.label} for="rg-metric">聚合方式</label>
                        <select id="rg-metric" class={select} value={config.heatmap.metric} on:change={onMetricChange}>
                            <option value="max">每日最高分</option>
                            <option value="avg">每日平均分</option>
                        </select>
                    </div>
                    <div class={field.field}>
                        <label class={field.label} for="rg-days">显示天数</label>
                        <input id="rg-days" class={input} type="number" value={config.heatmap.days} on:input={(e) => patchHeatmap({ days: vn(e) || 90 })} />
                    </div>
                    <div class={field.field}>
                        <span class={field.label}>配色区间</span>
                        <div class="rg-ranges">
                            {#each config.heatmap.ranges as r, i}
                                <div class="rg-range-row">
                                    <input class={cn(input, "rg-range-num")} type="number" placeholder="min" value={r.min} on:input={(e) => patchRange(i, { min: vn(e) })} />
                                    <input class={cn(input, "rg-range-num")} type="number" placeholder="max" value={r.max} on:input={(e) => patchRange(i, { max: vn(e) })} />
                                    <input class="rg-color-picker" type="color" value={r.color} on:input={(e) => patchRange(i, { color: v(e) })} />
                                    <button class={button({ variant: "ghost", size: "icon" })} on:click={() => removeRange(i)}>✕</button>
                                </div>
                            {/each}
                            <button class={button({ variant: "outline", size: "sm" })} on:click={addRange}>+ 添加区间</button>
                        </div>
                    </div>
                </div>
            </div>
        </TabsContent>

        <TabsContent value="data">
            <div class={card.root}>
                <div class={card.header}>
                    <h3 class={card.title}>数据管理</h3>
                    <p class={card.description}>清除本地存储的记录</p>
                </div>
                <div class={cn(card.content, "rg-data-actions")}>
                    <button class={button({ variant: "outline" })} on:click={onClearScores}>清空成绩记录</button>
                    <button class={button({ variant: "destructive" })} on:click={onClearProgress}>清空答题进度</button>
                </div>
            </div>
        </TabsContent>
    </Tabs>
</div>

<style>
    .rg-setting-panel { padding: 12px 0; }
    .rg-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .rg-row-2 { display: flex; gap: 12px; }
    .rg-row-2 > * { flex: 1; }
    .rg-row-3 { display: flex; gap: 12px; }
    .rg-row-3 > * { flex: 1; min-width: 0; }
    .rg-checks { display: flex; flex-wrap: wrap; gap: 12px; }
    .rg-check-item { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
    .rg-prompt-head { display: flex; justify-content: space-between; align-items: center; }
    :global(.rg-prompt-ta) { min-height: 100px; font-family: var(--b3-font-family-code, monospace); font-size: 12px; }
    .rg-ranges { display: flex; flex-direction: column; gap: 8px; }
    .rg-range-row { display: flex; align-items: center; gap: 8px; }
    :global(.rg-range-num) { width: 72px; }
    .rg-color-picker { width: 36px; height: 34px; padding: 2px; border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); background: var(--b3-theme-background); cursor: pointer; }
    .rg-data-actions { display: flex; gap: 12px; flex-wrap: wrap; }
    :global(.rg-input--invalid) { border-color: var(--b3-card-error); }
    @media (max-width: 640px) {
        .rg-row-2, .rg-row-3 { flex-direction: column; }
    }
</style>
