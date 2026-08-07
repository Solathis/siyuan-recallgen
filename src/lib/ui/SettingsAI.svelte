<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { button, badge, card, field, input, select, label, switchCls, slider, cn } from "./components";
    import type { RecallGenConfig, AIProvider } from "@/types/config";

    export let config: RecallGenConfig;
    export let onTestConnection: () => Promise<boolean> = async () => false;

    const dispatch = createEventDispatcher<{ save: RecallGenConfig }>();
    let connState: "idle" | "testing" | "ok" | "fail" = "idle";

    function v(e: Event): string { return (e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value; }
    function vn(e: Event): number { return parseInt(v(e)) || 0; }
    function vf(e: Event): number { return parseFloat(v(e)) || 0; }
    function checked(e: Event): boolean { return (e.target as HTMLInputElement).checked; }

    let _temperature = config.ai.temperature;

    function patchAi(patch: Partial<typeof config.ai>) {
        dispatch("save", { ...config, ai: { ...config.ai, ...patch } });
    }
    function onProviderChange(e: Event) { patchAi({ provider: v(e) as AIProvider }); }
    async function testConn() {
        connState = "testing";
        try { connState = (await onTestConnection()) ? "ok" : "fail"; }
        catch { connState = "fail"; }
    }
</script>

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
            <label class={field.label}>Temperature（{_temperature.toFixed(1)}）</label>
            <input class={slider} type="range" min="0" max="2" step="0.1" bind:value={_temperature} on:change={() => patchAi({ temperature: _temperature })} />
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
        <label class="rg-check-item">
            <input class={switchCls} type="checkbox" checked={config.ai.jsonSchemaEnabled} on:change={(e) => patchAi({ jsonSchemaEnabled: checked(e) })} />
            <span>JSON Schema 约束输出</span>
            <span class={field.description}>开启后用 response_format 强制 AI 返回 JSON；关闭后仅靠提示词约束（兼容性更好但可能需 jsonrepair 修复）</span>
        </label>
    </div>
</div>

<style>
    .rg-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .rg-row-2 { display: flex; gap: 12px; }
    .rg-row-2 > * { flex: 1; }
    .rg-check-item { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; color: var(--b3-theme-on-background); flex-wrap: wrap; }
    @media (max-width: 640px) { .rg-row-2 { flex-direction: column; } }
</style>
