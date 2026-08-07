<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { button, badge, card, field, input, select, label, switchCls, cn } from "./components";
    import type { RecallGenConfig, AIEndpoint, AIModel, AIProvider, AIProtocol } from "@/types/config";

    export let config: RecallGenConfig;
    export let onTestConnection: () => Promise<string> = async () => "";

    const dispatch = createEventDispatcher<{ save: RecallGenConfig }>();
    let connState: "idle" | "testing" | "ok" | "fail" = "idle";
    let connError = "";
    let connResult = "";
    let showKeys: Record<string, boolean> = {};
    let testModelId = config.ai.testModelId;

    function v(e: Event): string { return (e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value; }
    function vn(e: Event): number { return parseInt(v(e)) || 0; }
    function checked(e: Event): boolean { return (e.target as HTMLInputElement).checked; }

    function patchAi(patch: Partial<typeof config.ai>) {
        dispatch("save", { ...config, ai: { ...config.ai, ...patch } });
    }

    function genId(prefix: string): string {
        return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    }

    // ── 端点 CRUD ──────────────────────────────────────────────

    function addEndpoint() {
        const ep: AIEndpoint = {
            id: genId("ep"),
            name: `端点 ${config.ai.endpoints.length + 1}`,
            provider: "openai",
            protocol: "chat",
            baseUrl: "",
            apiKey: "",
        };
        patchAi({ endpoints: [...config.ai.endpoints, ep] });
    }
    function removeEndpoint(id: string) {
        const modelsUsing = config.ai.models.filter((m) => m.endpointId === id);
        if (modelsUsing.length > 0) {
            alert(`该端点被 ${modelsUsing.length} 个模型引用，请先删除或迁移这些模型`);
            return;
        }
        patchAi({ endpoints: config.ai.endpoints.filter((e) => e.id !== id) });
    }
    function patchEndpoint(id: string, patch: Partial<AIEndpoint>) {
        patchAi({
            endpoints: config.ai.endpoints.map((e) => e.id === id ? { ...e, ...patch } : e),
        });
    }
    function onEpProvider(id: string, e: Event) {
        const provider = v(e) as AIProvider;
        if (provider === "ollama") patchEndpoint(id, { provider, protocol: "chat" });
        else patchEndpoint(id, { provider });
    }
    function onEpProtocol(id: string, e: Event) {
        patchEndpoint(id, { protocol: v(e) as AIProtocol });
    }
    function onEpTemp(id: string, e: Event) {
        patchModel(id, { temperature: parseFloat(v(e)) || 0 });
    }

    // ── 模型 CRUD ──────────────────────────────────────────────

    function addModel() {
        const ep = config.ai.endpoints[0];
        if (!ep) { alert("请先添加端点"); return; }
        const m: AIModel = {
            id: genId("m"),
            name: "",
            endpointId: ep.id,
            temperature: 0.7,
            maxTokens: 4096,
        };
        patchAi({ models: [...config.ai.models, m] });
    }
    function removeModel(id: string) {
        const roles = config.ai.roles;
        if (roles.generator === id || roles.reviewer === id || roles.grader === id) {
            alert("该模型被角色引用，请先在「AI 身份」中更换");
            return;
        }
        patchAi({ models: config.ai.models.filter((m) => m.id !== id) });
    }
    function patchModel(id: string, patch: Partial<AIModel>) {
        patchAi({
            models: config.ai.models.map((m) => m.id === id ? { ...m, ...patch } : m),
        });
    }

    // ── 测试连接 ──────────────────────────────────────────────

    function onTestModelChange(e: Event) {
        testModelId = v(e);
        patchAi({ testModelId });
    }
    async function testConn() {
        connState = "testing";
        connError = "";
        connResult = "";
        try {
            const content = await onTestConnection();
            connResult = content;
            connState = "ok";
        } catch (e) {
            connState = "fail";
            connError = (e as Error).message;
        }
    }
</script>

<div class={card.root}>
    <div class={card.header}>
        <h3 class={card.title}>AI 端点与模型</h3>
        <p class={card.description}>配置多个 API 端点和模型，在「AI 身份」中分配角色</p>
    </div>
    <div class={cn(card.content, field.group)}>
        <!-- ── 端点列表 ── -->
        <div class="rg-section-head">
            <span class="rg-section-title">API 端点</span>
            <button class={button({ variant: "outline", size: "sm" })} on:click={addEndpoint} type="button">+ 添加端点</button>
        </div>
        {#each config.ai.endpoints as ep (ep.id)}
            <div class="rg-ep-card">
                <div class="rg-ep-head">
                    <input class={cn(input, "rg-ep-name")} type="text" value={ep.name} on:input={(e) => patchEndpoint(ep.id, { name: v(e) })} placeholder="端点名称" />
                    <button class={button({ variant: "ghost", size: "sm" })} on:click={() => removeEndpoint(ep.id)} type="button">删除</button>
                </div>
                <div class="rg-ep-body">
                    <div class="rg-ep-row">
                        <label class={field.label}>服务商</label>
                        <select class={select} value={ep.provider} on:change={(e) => onEpProvider(ep.id, e)}>
                            <option value="openai">OpenAI 兼容</option>
                            <option value="ollama">Ollama</option>
                        </select>
                    </div>
                    <div class="rg-ep-row">
                        <label class={field.label}>协议</label>
                        <select class={select} value={ep.protocol} on:change={(e) => onEpProtocol(ep.id, e)} disabled={ep.provider === "ollama"}>
                            <option value="chat">Chat Completions</option>
                            <option value="responses">Responses API</option>
                            <option value="messages">Messages API</option>
                        </select>
                    </div>
                    <div class="rg-ep-row">
                        <label class={field.label}>Base URL</label>
                        <input class={input} type="text" value={ep.baseUrl} on:input={(e) => patchEndpoint(ep.id, { baseUrl: v(e) })} placeholder="https://api.openai.com/v1" />
                    </div>
                    <div class="rg-ep-row">
                        <label class={field.label}>API Key</label>
                        <div class="rg-key-row">
                            <input class={cn(input, "rg-key-input")} type={showKeys[ep.id] ? "text" : "password"} value={ep.apiKey} on:input={(e) => patchEndpoint(ep.id, { apiKey: v(e) })} placeholder="sk-..." />
                            <button class={button({ variant: "outline", size: "sm" })} on:click={() => showKeys[ep.id] = !showKeys[ep.id]} type="button">
                                {showKeys[ep.id] ? "隐藏" : "显示"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        {/each}

        <!-- ── 模型列表 ── -->
        <div class="rg-section-head">
            <span class="rg-section-title">AI 模型</span>
            <button class={button({ variant: "outline", size: "sm" })} on:click={addModel} type="button">+ 添加模型</button>
        </div>
        {#each config.ai.models as m (m.id)}
            <div class="rg-model-card">
                <div class="rg-model-head">
                    <input class={cn(input, "rg-model-name")} type="text" value={m.name} on:input={(e) => patchModel(m.id, { name: v(e) })} placeholder="模型名称（如 gpt-4o-mini）" />
                    <button class={button({ variant: "ghost", size: "sm" })} on:click={() => removeModel(m.id)} type="button">删除</button>
                </div>
                <div class="rg-model-body">
                    <div class="rg-ep-row">
                        <label class={field.label}>端点</label>
                        <select class={select} value={m.endpointId} on:change={(e) => patchModel(m.id, { endpointId: v(e) })}>
                            {#each config.ai.endpoints as ep}
                                <option value={ep.id}>{ep.name}</option>
                            {/each}
                        </select>
                    </div>
                    <div class="rg-ep-row">
                        <label class={field.label}>温度</label>
                        <input class={cn(input, "rg-model-num")} type="number" step="0.1" min="0" max="2" value={m.temperature} on:input={(e) => onEpTemp(m.id, e)} />
                    </div>
                    <div class="rg-ep-row">
                        <label class={field.label}>Max Tokens</label>
                        <input class={cn(input, "rg-model-num")} type="number" step="256" min="256" value={m.maxTokens} on:input={(e) => patchModel(m.id, { maxTokens: vn(e) })} />
                    </div>
                </div>
            </div>
        {/each}

        <!-- ── 测试连接 ── -->
        <div class="rg-section-head">
            <span class="rg-section-title">测试连接</span>
        </div>
        <div class={field.group}>
            <div class="rg-ep-row">
                <label class={field.label}>测试模型</label>
                <select class={select} value={testModelId} on:change={onTestModelChange}>
                    {#each config.ai.models as m}
                        <option value={m.id}>{m.name}</option>
                    {/each}
                </select>
            </div>
            <div class="rg-ep-row">
                <label class={field.label}>测试提示词</label>
                <input class={input} type="text" value={config.ai.testPrompt} on:input={(e) => patchAi({ testPrompt: v(e) })} />
            </div>
            <div class="rg-test-row">
                <button class={button({ variant: "outline", size: "sm" })} on:click={testConn} disabled={connState === "testing"} type="button">
                    {connState === "testing" ? "测试中…" : "测试连接"}
                </button>
                {#if connState === "ok"}<span class={badge("success")}>连接成功</span>{/if}
                {#if connState === "fail"}<span class={badge("destructive")}>连接失败</span>{/if}
            </div>
            {#if connState === "fail" && connError}
                <div class="rg-conn-error">{connError}</div>
            {/if}
            {#if connResult}
                <div class="rg-conn-result">
                    <span class="rg-conn-result__label">AI 回复：</span>
                    <div class="rg-conn-result__content">{connResult}</div>
                </div>
            {/if}
        </div>

        <!-- ── 全局设置 ── -->
        <div class="rg-section-head">
            <span class="rg-section-title">全局设置</span>
        </div>
        <div class={field.group}>
            <div class="rg-ep-row">
                <label class={field.label}>超时（秒）</label>
                <input class={input} type="number" value={Math.round(config.ai.timeout / 1000)} on:input={(e) => patchAi({ timeout: vn(e) * 1000 })} />
            </div>
            <label class="rg-check-item">
                <input class={switchCls} type="checkbox" checked={config.ai.jsonSchemaEnabled} on:change={(e) => patchAi({ jsonSchemaEnabled: checked(e) })} />
                <span>JSON Schema 严格模式</span>
                <span class={field.description}>开启→json_schema 严格约束；关闭→json_object 宽松模式（兼容性更好）</span>
            </label>
        </div>
    </div>
</div>

<style>
    .rg-section-head { display: flex; justify-content: space-between; align-items: center; margin: 12px 0 8px; }
    .rg-section-title { font-weight: 600; font-size: 14px; color: var(--b3-theme-on-background); }
    .rg-ep-card { border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
    .rg-ep-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .rg-ep-name { flex: 1; font-weight: 600; }
    .rg-ep-body { display: flex; flex-direction: column; gap: 8px; }
    .rg-ep-row { display: flex; align-items: center; gap: 8px; }
    .rg-ep-row label { width: 80px; flex-shrink: 0; font-size: 13px; }
    .rg-ep-row input, .rg-ep-row select { flex: 1; }
    .rg-model-card { border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
    .rg-model-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .rg-model-name { flex: 1; font-weight: 600; }
    .rg-model-body { display: flex; gap: 8px; flex-wrap: wrap; }
    .rg-model-body .rg-ep-row { flex: 1; min-width: 120px; }
    .rg-model-num { max-width: 100px; }
    .rg-key-row { display: flex; gap: 8px; flex: 1; }
    .rg-key-input { flex: 1; }
    .rg-test-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .rg-check-item { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; color: var(--b3-theme-on-background); flex-wrap: wrap; }
    .rg-conn-error { font-size: 12px; font-family: monospace; color: var(--b3-card-error, #d23f31); background: color-mix(in srgb, var(--b3-card-error, #d23f31) 8%, transparent); padding: 6px 10px; border-radius: var(--b3-border-radius); word-break: break-all; max-height: 80px; overflow-y: auto; }
    .rg-conn-result { font-size: 12px; background: color-mix(in srgb, var(--b3-card-success, #65a84c) 8%, transparent); border: 1px solid color-mix(in srgb, var(--b3-card-success, #65a84c) 30%, transparent); border-radius: var(--b3-border-radius); padding: 8px 10px; }
    .rg-conn-result__label { font-weight: 600; color: var(--b3-card-success, #65a84c); display: block; margin-bottom: 4px; }
    .rg-conn-result__content { color: var(--b3-theme-on-background); line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
    @media (max-width: 640px) {
        .rg-ep-row { flex-direction: column; align-items: stretch; }
        .rg-ep-row label { width: auto; }
        .rg-model-body { flex-direction: column; }
    }
</style>
