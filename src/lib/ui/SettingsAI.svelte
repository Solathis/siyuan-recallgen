<script lang="ts">
    import { showMessage } from "siyuan";
    import { Badge } from "@/lib/components/ui/badge";
    import { Button } from "@/lib/components/ui/button";
    import * as Card from "@/lib/components/ui/card";
    import { Input } from "@/lib/components/ui/input";
    import * as Select from "@/lib/components/ui/select";
    import { Separator } from "@/lib/components/ui/separator";
    import { Switch } from "@/lib/components/ui/switch";
    import { Field, FieldLabel, FieldLegend } from "@/lib/components/ui/field";
    import { t } from "../i18n";
    import type { AIEndpoint, AIModel, AIProvider, AIProtocol, RecallGenConfig } from "@/types/config";

    let {
        config,
        onTestConnection = async () => "",
        onsave,
    }: {
        config: RecallGenConfig;
        onTestConnection?: () => Promise<string>;
        onsave: (config: RecallGenConfig) => void;
    } = $props();

    let connState = $state<"idle" | "testing" | "ok" | "fail">("idle");
    let connError = $state("");
    let connResult = $state("");
    let showKeys = $state<Record<string, boolean>>({});
    /** 测试用模型直接取配置值，避免本地副本与配置脱钩（原实现会残留已被删除的模型 id） */
    const testModelId = $derived(config.ai.testModelId);

    /* ── 基础工具 ────────────────────────────────────────────────── */

    function patchAi(patch: Partial<RecallGenConfig["ai"]>) {
        onsave({ ...config, ai: { ...config.ai, ...patch } });
    }

    function genId(prefix: string): string {
        return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    }

    function modelsOf(endpointId: string): AIModel[] {
        return config.ai.models.filter((m) => m.endpointId === endpointId);
    }

    /* ── 测试连接 ────────────────────────────────────────────────── */

    const testEndpointId = $derived(
        config.ai.models.find((m) => m.id === testModelId)?.endpointId ?? config.ai.endpoints[0]?.id ?? ""
    );

    function onTestEndpointChange(endpointId: string) {
        const first = modelsOf(endpointId)[0];
        if (!first) return;
        patchAi({ testModelId: first.id });
    }

    function onTestModelChange(modelId: string) {
        patchAi({ testModelId: modelId });
    }

    /* ── 端点 CRUD ───────────────────────────────────────────────── */

    function addEndpoint() {
        const endpoint: AIEndpoint = {
            id: genId("ep"),
            name: t("settings.ai.endpointNum", String(config.ai.endpoints.length + 1)),
            provider: "openai",
            protocol: "chat",
            baseUrl: "",
            apiKey: "",
        };
        patchAi({ endpoints: [...config.ai.endpoints, endpoint] });
    }

    function removeEndpoint(id: string) {
        const used = config.ai.models.filter((m) => m.endpointId === id);
        if (used.length > 0) {
            // 原生 alert 会阻塞且样式与思源不一致，统一用思源的提示
            showMessage(t("settings.ai.alertModelsInUse", String(used.length)), 7000, "error");
            return;
        }
        patchAi({ endpoints: config.ai.endpoints.filter((e) => e.id !== id) });
    }

    function patchEndpoint(id: string, patch: Partial<AIEndpoint>) {
        patchAi({ endpoints: config.ai.endpoints.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
    }

    function onProviderChange(id: string, provider: string) {
        // Ollama 只支持 chat 协议，切换时同步纠正
        if (provider === "ollama") patchEndpoint(id, { provider: provider as AIProvider, protocol: "chat" });
        else patchEndpoint(id, { provider: provider as AIProvider });
    }

    function onProtocolChange(id: string, protocol: string) {
        patchEndpoint(id, { protocol: protocol as AIProtocol });
    }

    /* ── 模型 CRUD ───────────────────────────────────────────────── */

    /** 生成不与同端点已有模型重名的默认名（原实现从空串起判，导致新模型名恒为空） */
    function nextModelName(endpointId: string, excludeId?: string): string {
        const existing = new Set(
            modelsOf(endpointId)
                .filter((m) => m.id !== excludeId)
                .map((m) => m.name)
        );
        let index = existing.size + 1;
        let candidate = t("settings.ai.modelNum", String(index));
        while (existing.has(candidate)) {
            index += 1;
            candidate = t("settings.ai.modelNum", String(index));
        }
        return candidate;
    }

    function addModel(endpointId: string) {
        const model: AIModel = {
            id: genId("m"),
            name: nextModelName(endpointId),
            endpointId,
            temperature: 0.7,
            maxTokens: 16384,
        };
        patchAi({ models: [...config.ai.models, model] });
    }

    function removeModel(id: string) {
        const roles = config.ai.roles;
        if (roles.generator === id || roles.reviewer === id || roles.grader === id) {
            showMessage(t("settings.ai.alertModelInRole"), 7000, "error");
            return;
        }
        patchAi({ models: config.ai.models.filter((m) => m.id !== id) });
    }

    /**
     * 更新模型。
     * 重名时不再「提示后直接 return」把界面留在已输入的新名字上（原实现会造成 UI 与状态脱钩），
     * 而是回退到可用名，保证界面与配置始终一致。
     */
    function patchModel(id: string, patch: Partial<AIModel>) {
        const current = config.ai.models.find((m) => m.id === id);
        if (!current) return;

        const next = { ...current, ...patch };
        if (patch.name !== undefined) {
            const trimmed = patch.name.trim();
            const duplicated = modelsOf(current.endpointId).some((m) => m.id !== id && m.name === trimmed);
            if (duplicated) {
                showMessage(t("settings.ai.alertDupModelName", trimmed), 7000, "error");
                next.name = nextModelName(current.endpointId, id);
            } else if (!trimmed) {
                next.name = nextModelName(current.endpointId, id);
            }
        }
        // 温度与 MaxTokens 做区间收敛，避免写入 0 或负数导致调用必然失败
        if (next.temperature !== undefined) {
            next.temperature = Math.max(0, Math.min(2, next.temperature));
        }
        if (next.maxTokens !== undefined) {
            next.maxTokens = Math.max(256, Math.min(200_000, Math.round(next.maxTokens)));
        }

        patchAi({ models: config.ai.models.map((m) => (m.id === id ? next : m)) });
    }

    async function testConn() {
        connState = "testing";
        connError = "";
        connResult = "";
        try {
            connResult = await onTestConnection();
            connState = "ok";
        } catch (e) {
            connState = "fail";
            connError = (e as Error).message;
        }
    }

    const timeoutSeconds = $derived(Math.round(config.ai.timeout / 1000));
</script>

<Card.Root>
    <Card.Header>
        <Card.Title>{t("settings.ai.title")}</Card.Title>
        <Card.Description>{t("settings.ai.desc")}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
        {#each config.ai.endpoints as endpoint (endpoint.id)}
            <div class="border-border flex flex-col gap-3 rounded-lg border p-3">
                <div class="flex items-center gap-2">
                    <Input
                        class="flex-1 font-medium"
                        value={endpoint.name}
                        aria-label={t("settings.ai.endpointName")}
                        placeholder={t("settings.ai.endpointName")}
                        oninput={(e) => patchEndpoint(endpoint.id, { name: e.currentTarget.value })}
                    />
                    <Button variant="ghost" size="sm" data-tap onclick={() => removeEndpoint(endpoint.id)}>
                        {t("settings.ai.deleteEndpoint")}
                    </Button>
                </div>

                <div class="grid grid-cols-1 gap-3 @xl:grid-cols-2">
                    <Field>
                        <FieldLabel for={`rg-provider-${endpoint.id}`}>{t("settings.ai.provider")}</FieldLabel>
                        <Select.Root
                            type="single"
                            value={endpoint.provider}
                            onValueChange={(v) => onProviderChange(endpoint.id, v)}
                        >
                            <Select.Trigger id={`rg-provider-${endpoint.id}`} class="w-full">
                                {endpoint.provider === "openai"
                                    ? t("settings.ai.openaiCompat")
                                    : t("settings.ai.ollama")}
                            </Select.Trigger>
                            <Select.Content>
                                <Select.Item value="openai">{t("settings.ai.openaiCompat")}</Select.Item>
                                <Select.Item value="ollama">{t("settings.ai.ollama")}</Select.Item>
                            </Select.Content>
                        </Select.Root>
                    </Field>
                    <Field>
                        <FieldLabel for={`rg-protocol-${endpoint.id}`}>{t("settings.ai.protocol")}</FieldLabel>
                        <Select.Root
                            type="single"
                            value={endpoint.protocol}
                            onValueChange={(v) => onProtocolChange(endpoint.id, v)}
                        >
                            <Select.Trigger
                                id={`rg-protocol-${endpoint.id}`}
                                class="w-full"
                                disabled={endpoint.provider === "ollama"}
                            >
                                {endpoint.protocol === "chat"
                                    ? "Chat Completions"
                                    : endpoint.protocol === "responses"
                                      ? "Responses API"
                                      : "Messages API"}
                            </Select.Trigger>
                            <Select.Content>
                                <Select.Item value="chat">Chat Completions</Select.Item>
                                <Select.Item value="responses">Responses API</Select.Item>
                                <Select.Item value="messages">Messages API</Select.Item>
                            </Select.Content>
                        </Select.Root>
                    </Field>
                </div>

                <Field>
                    <FieldLabel for={`rg-baseurl-${endpoint.id}`}>{t("settings.ai.baseUrl")}</FieldLabel>
                    <!-- 限宽 + 等宽字体：URL 是技术字符串，铺满整行既难核对也不好看 -->
                    <Input
                        id={`rg-baseurl-${endpoint.id}`}
                        class="max-w-md font-mono text-xs"
                        value={endpoint.baseUrl}
                        placeholder="https://api.openai.com/v1"
                        oninput={(e) => patchEndpoint(endpoint.id, { baseUrl: e.currentTarget.value })}
                    />
                </Field>

                <Field>
                    <FieldLabel for={`rg-apikey-${endpoint.id}`}>{t("settings.ai.apiKey")}</FieldLabel>
                    <div class="flex max-w-md gap-2">
                        <Input
                            id={`rg-apikey-${endpoint.id}`}
                            class="flex-1 font-mono text-xs"
                            type={showKeys[endpoint.id] ? "text" : "password"}
                            value={endpoint.apiKey}
                            placeholder="sk-..."
                            autocomplete="off"
                            oninput={(e) => patchEndpoint(endpoint.id, { apiKey: e.currentTarget.value })}
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            data-tap
                            onclick={() => (showKeys[endpoint.id] = !showKeys[endpoint.id])}
                        >
                            {showKeys[endpoint.id] ? t("settings.ai.hideKey") : t("settings.ai.showKey")}
                        </Button>
                    </div>
                </Field>

                <Separator />

                <div class="flex flex-col gap-2">
                    <div class="flex items-center justify-between">
                        <span class="text-muted-foreground text-xs font-semibold">{t("settings.ai.models")}</span>
                        <Button variant="outline" size="sm" data-tap onclick={() => addModel(endpoint.id)}>
                            {t("settings.ai.addModel")}
                        </Button>
                    </div>
                    {#if modelsOf(endpoint.id).length > 0}
                        <div
                            class="text-muted-foreground hidden grid-cols-[1fr_5rem_6rem_auto] gap-2 text-2xs font-semibold @2xl:grid"
                        >
                            <span>{t("settings.ai.colName")}</span>
                            <span class="text-center">{t("settings.ai.colTemp")}</span>
                            <span class="text-center">{t("settings.ai.colMaxTokens")}</span>
                            <span class="text-center">{t("settings.ai.colAction")}</span>
                        </div>
                    {/if}
                    {#each modelsOf(endpoint.id) as model (model.id)}
                        <div class="grid grid-cols-2 items-center gap-2 @2xl:grid-cols-[1fr_5rem_6rem_auto]">
                            <Input
                                value={model.name}
                                aria-label={t("settings.ai.colName")}
                                placeholder="gpt-4o-mini"
                                oninput={(e) => patchModel(model.id, { name: e.currentTarget.value })}
                            />
                            <Input
                                type="number"
                                step="0.1"
                                min="0"
                                max="2"
                                class="text-center"
                                aria-label={t("settings.ai.colTemp")}
                                value={model.temperature}
                                onchange={(e) =>
                                    patchModel(model.id, { temperature: parseFloat(e.currentTarget.value) })}
                            />
                            {#if model.maxTokens === 0}
                                <Select.Root
                                    type="single"
                                    value="auto"
                                    onValueChange={(v) =>
                                        patchModel(model.id, { maxTokens: v === "custom" ? 16384 : parseInt(v, 10) })}
                                >
                                    <Select.Trigger class="h-8 w-20 text-xs" aria-label={t("settings.ai.colMaxTokens")}>
                                        {t("settings.ai.maxTokensAuto")}
                                    </Select.Trigger>
                                    <Select.Content>
                                        <Select.Item value="auto">{t("settings.ai.maxTokensAuto")}</Select.Item>
                                        <Select.Item value="custom">{t("settings.ai.maxTokensCustom")}</Select.Item>
                                    </Select.Content>
                                </Select.Root>
                            {:else}
                                <Input
                                    type="number"
                                    step="1024"
                                    min="0"
                                    class="text-center"
                                    aria-label={t("settings.ai.colMaxTokens")}
                                    value={model.maxTokens}
                                    onchange={(e) =>
                                        patchModel(model.id, { maxTokens: parseInt(e.currentTarget.value, 10) || 0 })}
                                />
                            {/if}
                            <Button variant="ghost" size="sm" data-tap onclick={() => removeModel(model.id)}>
                                {t("common.delete")}
                            </Button>
                        </div>
                    {:else}
                        <span class="text-muted-foreground text-xs">{t("settings.ai.noModels")}</span>
                    {/each}
                </div>
            </div>
        {:else}
            <span class="text-muted-foreground text-xs">{t("settings.ai.noEndpoints")}</span>
        {/each}

        <Button variant="outline" data-tap onclick={addEndpoint} class="self-start">
            {t("settings.ai.addEndpoint")}
        </Button>

        <Separator />
        <span class="text-sm font-semibold">{t("settings.ai.testConn")}</span>

        <div class="flex flex-col gap-3">
            <Field>
                <FieldLabel for="rg-test-endpoint">{t("settings.ai.testEndpoint")}</FieldLabel>
                <Select.Root type="single" value={testEndpointId} onValueChange={onTestEndpointChange}>
                    <Select.Trigger id="rg-test-endpoint" class="w-full">
                        {config.ai.endpoints.find((e) => e.id === testEndpointId)?.name ?? ""}
                    </Select.Trigger>
                    <Select.Content>
                        {#each config.ai.endpoints as endpoint (endpoint.id)}
                            <Select.Item value={endpoint.id}>{endpoint.name}</Select.Item>
                        {/each}
                    </Select.Content>
                </Select.Root>
            </Field>
            <Field>
                <FieldLabel for="rg-test-model">{t("settings.ai.testModel")}</FieldLabel>
                <Select.Root type="single" value={testModelId} onValueChange={onTestModelChange}>
                    <Select.Trigger id="rg-test-model" class="w-full">
                        {config.ai.models.find((m) => m.id === testModelId)?.name ?? ""}
                    </Select.Trigger>
                    <Select.Content>
                        {#each modelsOf(testEndpointId) as model (model.id)}
                            <Select.Item value={model.id}>{model.name}</Select.Item>
                        {/each}
                    </Select.Content>
                </Select.Root>
            </Field>
            <Field>
                <FieldLabel for="rg-test-prompt">{t("settings.ai.testPrompt")}</FieldLabel>
                <Input
                    id="rg-test-prompt"
                    value={config.ai.testPrompt}
                    oninput={(e) => patchAi({ testPrompt: e.currentTarget.value })}
                />
            </Field>

            <div class="flex flex-wrap items-center gap-3" role="status" aria-live="polite">
                <Button
                    variant="outline"
                    size="sm"
                    data-tap
                    onclick={() => void testConn()}
                    disabled={connState === "testing"}
                >
                    {connState === "testing" ? t("settings.ai.testing") : t("settings.ai.testConn")}
                </Button>
                {#if connState === "ok"}
                    <Badge variant="success">{t("settings.ai.connOk")}</Badge>
                {/if}
                {#if connState === "fail"}
                    <Badge variant="destructive">{t("settings.ai.connFail")}</Badge>
                {/if}
            </div>

            {#if connState === "fail" && connError}
                <pre
                    role="alert"
                    class="bg-destructive/10 text-destructive max-h-20 overflow-auto rounded-md p-2 text-xs">{connError}</pre>
            {/if}
            {#if connResult}
                <div class="bg-success/10 rounded-md p-2">
                    <span class="text-success block text-xs font-semibold">{t("settings.ai.aiReply")}</span>
                    <p class="rg-markdown text-sm break-words whitespace-pre-wrap">{connResult}</p>
                </div>
            {/if}
        </div>

        <Separator />
        <span class="text-sm font-semibold">{t("settings.ai.globalSettings")}</span>

        <div class="flex flex-col gap-3">
            <Field>
                <FieldLabel for="rg-ai-timeout">{t("settings.ai.timeout")}</FieldLabel>
                <Input
                    id="rg-ai-timeout"
                    type="number"
                    min="5"
                    value={timeoutSeconds}
                    onchange={(e) => patchAi({ timeout: Math.max(5, parseInt(e.currentTarget.value, 10) || 5) * 1000 })}
                />
            </Field>
            <div class="flex items-center gap-3">
                <Switch
                    checked={config.ai.jsonSchemaEnabled}
                    onCheckedChange={(checked) => patchAi({ jsonSchemaEnabled: checked })}
                    aria-label={t("settings.ai.jsonSchema")}
                />
                <div class="flex flex-col gap-0.5">
                    <FieldLegend variant="label">{t("settings.ai.jsonSchema")}</FieldLegend>
                    <span class="text-muted-foreground text-xs">{t("settings.ai.jsonSchemaDesc")}</span>
                </div>
            </div>
        </div>
    </Card.Content>
</Card.Root>
