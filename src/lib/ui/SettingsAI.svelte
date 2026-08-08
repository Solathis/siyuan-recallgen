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

    // ── 测试连接：端点+模型级联 ──

    function testEndpointId(): string {
        const model = config.ai.models.find((m) => m.id === testModelId);
        return model?.endpointId ?? config.ai.endpoints[0]?.id ?? "";
    }
    function modelsOf(epId: string): AIModel[] {
        return config.ai.models.filter((m) => m.endpointId === epId);
    }
    function onTestEndpointChange(e: Event) {
        const epId = v(e);
        const first = modelsOf(epId)[0];
        if (first) {
            testModelId = first.id;
            patchAi({ testModelId: first.id });
        }
    }
    function onTestModelChange(e: Event) {
        testModelId = v(e);
        patchAi({ testModelId });
    }

    // ── 端点 CRUD ──────────────────────────────────────────────

    function modelsOfEndpoint(epId: string): AIModel[] {
        return config.ai.models.filter((m) => m.endpointId === epId);
    }

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
            alert(`该端点下有 ${modelsUsing.length} 个模型，请先删除这些模型`);
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

    // ── 模型 CRUD ──────────────────────────────────────────────

    function addModel(epId: string) {
        const existing = modelsOf(epId);
        // 同端点下不允许同名模型
        let name = "";
        let n = existing.length + 1;
        while (existing.some((m) => m.name === name)) { name = `模型 ${n++}`; }
        const m: AIModel = {
            id: genId("m"),
            name,
            endpointId: epId,
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
        // 同端点下不允许同名模型
        if (patch.name !== undefined) {
            const model = config.ai.models.find((m) => m.id === id);
            if (model) {
                const dup = config.ai.models.some((m) => m.endpointId === model.endpointId && m.id !== id && m.name === patch.name);
                if (dup) {
                    alert(`该端点下已存在同名模型「${patch.name}」`);
                    return;
                }
            }
        }
        patchAi({
            models: config.ai.models.map((m) => m.id === id ? { ...m, ...patch } : m),
        });
    }
    function onModelTemp(id: string, e: Event) {
        patchModel(id, { temperature: parseFloat(v(e)) || 0 });
    }

    // ── 测试连接 ──

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
        <p class={card.description}>每个端点下管理其模型，在「AI 身份」中分配角色</p>
    </div>
    <div class={cn(card.content, field.group)}>
        <!-- ── 按端点分组的端点+模型 ── -->
        {#each config.ai.endpoints as ep (ep.id)}
            <div class="rg-ep-block">
                <div class="rg-ep-head">
                    <input class={cn(input, "rg-ep-name")} type="text" value={ep.name} on:input={(e) => patchEndpoint(ep.id, { name: v(e) })} placeholder="端点名称" />
                    <button class={button({ variant: "ghost", size: "sm" })} on:click={() => removeEndpoint(ep.id)} type="button">删除端点</button>
                </div>
                <div class="rg-ep-config">
                    <div class="rg-row">
                        <label class={field.label}>服务商</label>
                        <select class={select} value={ep.provider} on:change={(e) => onEpProvider(ep.id, e)}>
                            <option value="openai">OpenAI 兼容</option>
                            <option value="ollama">Ollama</option>
                        </select>
                    </div>
                    <div class="rg-row">
                        <label class={field.label}>协议</label>
                        <select class={select} value={ep.protocol} on:change={(e) => onEpProtocol(ep.id, e)} disabled={ep.provider === "ollama"}>
                            <option value="chat">Chat Completions</option>
                            <option value="responses">Responses API</option>
                            <option value="messages">Messages API</option>
                        </select>
                    </div>
                    <div class="rg-row">
                        <label class={field.label}>Base URL</label>
                        <input class={input} type="text" value={ep.baseUrl} on:input={(e) => patchEndpoint(ep.id, { baseUrl: v(e) })} placeholder="https://api.openai.com/v1" />
                    </div>
                    <div class="rg-row">
                        <label class={field.label}>API Key</label>
                        <div class="rg-key-row">
                            <input class={cn(input, "rg-key-input")} type={showKeys[ep.id] ? "text" : "password"} value={ep.apiKey} on:input={(e) => patchEndpoint(ep.id, { apiKey: v(e) })} placeholder="sk-..." />
                            <button class={button({ variant: "outline", size: "sm" })} on:click={() => showKeys[ep.id] = !showKeys[ep.id]} type="button">
                                {showKeys[ep.id] ? "隐藏" : "显示"}
                            </button>
                        </div>
                    </div>
                </div>

                <!-- 该端点下的模型 -->
                <div class="rg-models-area">
                    <div class="rg-models-head">
                        <span class="rg-models-title">模型</span>
                        <button class={button({ variant: "outline", size: "sm" })} on:click={() => addModel(ep.id)} type="button">+ 添加模型</button>
                    </div>
                    {#if modelsOf(ep.id).length > 0}
                        <div class="rg-model-header">
                            <span class="rg-model-header-name">模型名称</span>
                            <span class="rg-model-header-num">温度</span>
                            <span class="rg-model-header-num">Max Tokens</span>
                            <span class="rg-model-header-op">操作</span>
                        </div>
                    {/if}
                    {#each modelsOf(ep.id) as m (m.id)}
                        <div class="rg-model-row">
                            <input class={cn(input, "rg-model-name")} type="text" value={m.name} on:input={(e) => patchModel(m.id, { name: v(e) })} placeholder="模型名称（如 gpt-4o-mini）" />
                            <input class={cn(input, "rg-model-num")} type="number" step="0.1" min="0" max="2" value={m.temperature} on:input={(e) => onModelTemp(m.id, e)} title="温度" />
                            <input class={cn(input, "rg-model-num")} type="number" step="256" min="256" value={m.maxTokens} on:input={(e) => patchModel(m.id, { maxTokens: vn(e) })} title="Max Tokens" />
                            <button class={button({ variant: "ghost", size: "sm" })} on:click={() => removeModel(m.id)} type="button">删除</button>
                        </div>
                    {:else}
                        <span class={field.description}>该端点下暂无模型</span>
                    {/each}
                </div>
            </div>
        {:else}
            <span class={field.description}>暂无端点，请点击下方按钮添加</span>
        {/each}

        <button class={button({ variant: "outline" })} on:click={addEndpoint} type="button">+ 添加端点</button>

        <!-- ── 测试连接 ── -->
        <div class="rg-section-sep"></div>
        <div class="rg-section-head"><span class="rg-section-title">测试连接</span></div>
        <div class={field.group}>
            <div class="rg-row">
                <label class={field.label}>端点</label>
                <select class={select} value={testEndpointId()} on:change={onTestEndpointChange}>
                    {#each config.ai.endpoints as ep}
                        <option value={ep.id}>{ep.name}</option>
                    {/each}
                </select>
            </div>
            <div class="rg-row">
                <label class={field.label}>模型</label>
                <select class={select} value={testModelId} on:change={onTestModelChange}>
                    {#each modelsOf(testEndpointId()) as m}
                        <option value={m.id}>{m.name}</option>
                    {/each}
                </select>
            </div>
            <div class="rg-row">
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
        <div class="rg-section-sep"></div>
        <div class="rg-section-head"><span class="rg-section-title">全局设置</span></div>
        <div class={field.group}>
            <div class="rg-row">
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
    .rg-ep-block { border: 1px solid var(--b3-border-color); border-radius: calc(var(--b3-border-radius) * 1.2); padding: 12px; display: flex; flex-direction: column; gap: 10px; background: color-mix(in srgb, var(--b3-theme-background) 97%, var(--b3-border-color) 3%); }
    .rg-ep-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .rg-ep-name { flex: 1; font-weight: 600; }
    .rg-ep-config { display: flex; flex-direction: column; gap: 8px; }
    .rg-row { display: flex; align-items: center; gap: 8px; }
    .rg-row label { width: 72px; flex-shrink: 0; font-size: 13px; }
    .rg-row input, .rg-row select { flex: 1; }
    .rg-key-row { display: flex; gap: 8px; flex: 1; }
    .rg-key-input { flex: 1; }
    .rg-models-area { border-top: 1px dashed var(--b3-border-color); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
    .rg-models-head { display: flex; justify-content: space-between; align-items: center; }
    .rg-models-title { font-size: 13px; font-weight: 600; color: var(--b3-theme-on-surface-light); }
    .rg-model-row { display: flex; align-items: center; gap: 6px; }
    .rg-model-name { flex: 1; }
    .rg-model-num { width: 80px; flex-shrink: 0; text-align: center; }
    .rg-model-header { display: flex; align-items: center; gap: 6px; padding: 0 0 2px; font-size: 11px; font-weight: 600; color: var(--b3-theme-on-surface-light); border-bottom: 1px solid var(--b3-border-color); }
    .rg-model-header-name { flex: 1; }
    .rg-model-header-num { width: 80px; flex-shrink: 0; text-align: center; }
    .rg-model-header-op { width: 48px; flex-shrink: 0; text-align: center; }
    .rg-section-sep { border-top: 1px solid var(--b3-border-color); margin: 4px 0; }
    .rg-section-head { display: flex; justify-content: space-between; align-items: center; margin: 4px 0 8px; }
    .rg-section-title { font-weight: 600; font-size: 14px; color: var(--b3-theme-on-background); }
    .rg-test-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .rg-check-item { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; color: var(--b3-theme-on-background); flex-wrap: wrap; }
    .rg-conn-error { font-size: 12px; font-family: monospace; color: var(--b3-card-error, #d23f31); background: color-mix(in srgb, var(--b3-card-error, #d23f31) 8%, transparent); padding: 6px 10px; border-radius: var(--b3-border-radius); word-break: break-all; max-height: 80px; overflow-y: auto; }
    .rg-conn-result { font-size: 12px; background: color-mix(in srgb, var(--b3-card-success, #65a84c) 8%, transparent); border: 1px solid color-mix(in srgb, var(--b3-card-success, #65a84c) 30%, transparent); border-radius: var(--b3-border-radius); padding: 8px 10px; }
    .rg-conn-result__label { font-weight: 600; color: var(--b3-card-success, #65a84c); display: block; margin-bottom: 4px; }
    .rg-conn-result__content { color: var(--b3-theme-on-background); line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
    @media (max-width: 640px) {
        .rg-row { flex-direction: column; align-items: stretch; }
        .rg-row label { width: auto; }
        .rg-model-row { flex-wrap: wrap; }
        .rg-model-num { width: 70px; }
    }
</style>
