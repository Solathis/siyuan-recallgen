<script lang="ts">
    /**
     * 设置 →「AI 端点与模型」顶部的「快速接入」：选一家服务商、填 API Key 就能出题。
     *
     * 接入面板在页内展开，不用弹窗：设置本身就在思源的对话框里，再弹一层要和思源比层级。
     * 默认勾选「最新」的模型（models.dev 的发布日期）；当前不可用的出题/审题/判分角色会自动改指向它。
     */
    import { onMount } from "svelte";
    import { showMessage } from "siyuan";
    import CheckIcon from "@lucide/svelte/icons/check";
    import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
    import ExternalLinkIcon from "@lucide/svelte/icons/external-link";
    import RefreshCwIcon from "@lucide/svelte/icons/refresh-cw";
    import { Badge } from "@/lib/components/ui/badge";
    import { Button } from "@/lib/components/ui/button";
    import { Checkbox } from "@/lib/components/ui/checkbox";
    import { Field, FieldLabel } from "@/lib/components/ui/field";
    import { Input } from "@/lib/components/ui/input";
    import { Label } from "@/lib/components/ui/label";
    import * as Collapsible from "@/lib/components/ui/collapsible";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import {
        PROVIDER_PRESETS,
        SNAPSHOT_CATALOG,
        modelSource,
        presetById,
        presetDesc,
        presetModels,
        presetName,
        type ModelCatalog,
        type ProviderPreset,
    } from "../ai/providers/catalog";
    import { connectPreset, connectedPreset, presetEndpointId } from "../ai/providers/connect";
    import { pickDefaultModel, type CatalogModel } from "../ai/providers/models";
    import type { QuizService } from "../quiz/service";
    import type { RecallGenConfig } from "@/types/config";
    import ProviderLogo from "./ProviderLogo.svelte";

    let {
        config,
        onsave,
        service = undefined,
    }: {
        config: RecallGenConfig;
        onsave: (config: RecallGenConfig) => void;
        /** 没传时（单测）不提供刷新与测试连接 */
        service?: Pick<
            QuizService,
            "getProviderCatalog" | "refreshProviderCatalog" | "testConnection" | "detectProviderModels"
        >;
    } = $props();

    let catalog = $state.raw<ModelCatalog>(SNAPSHOT_CATALOG);
    let quickConnectOpen = $state(false);
    let refreshing = $state(false);
    let detecting = $state<Record<string, boolean>>({});
    let detectMessage = $state<Record<string, string>>({});
    let detectedSpecs = $state<Array<{ id: string; info: CatalogModel | null }>>([]);
    onMount(() => {
        void service
            ?.getProviderCatalog()
            .then((next) => (catalog = next))
            .catch(() => undefined);
    });

    let openId = $state<string | null>(null);
    let apiKey = $state("");
    let showKey = $state(false);
    /** 勾选的模型名（即 API 里的 model 参数） */
    let chosen = $state<string[]>([]);
    /** 手动添加的模型名（华为云这类目录里没有模型的服务商，或 models.dev 还没收录的新模型） */
    let custom = $state<string[]>([]);
    let customDraft = $state("");
    let makeDefault = $state(false);
    let test = $state<{ state: "idle" | "testing" | "ok" | "fail"; message: string }>({ state: "idle", message: "" });

    const openPreset = $derived(presetById(openId ?? undefined));
    const models = $derived(openPreset ? presetModels(openPreset, catalog) : []);
    const latest = $derived(pickDefaultModel(models));
    /** 默认模型：勾选里最新的那个；只勾了手动添加的就用第一个 */
    const defaultModel = $derived(
        models.find((m) => chosen.includes(m.id) && m.id === latest?.id)?.id ??
            models.find((m) => chosen.includes(m.id))?.id ??
            chosen[0] ??
            ""
    );
    const connected = $derived(openPreset ? connectedPreset(config.ai, openPreset.id) : undefined);

    function toggle(preset: ProviderPreset): void {
        if (openId === preset.id) {
            openId = null;
            return;
        }
        openId = preset.id;
        const endpoint = connectedPreset(config.ai, preset.id);
        const list = presetModels(preset, catalog);
        const own = config.ai.models.filter((m) => m.endpointId === presetEndpointId(preset.id)).map((m) => m.name);
        apiKey = endpoint?.apiKey ?? "";
        detectedSpecs = [];
        chosen = own.length > 0 ? own : [pickDefaultModel(list)?.id].filter((id): id is string => Boolean(id));
        custom = own.filter((name) => !list.some((m) => m.id === name));
        customDraft = "";
        makeDefault = false;
        showKey = false;
        test = { state: "idle", message: "" };
    }

    function toggleModel(id: string): void {
        chosen = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    }

    function addCustom(): void {
        const name = customDraft.trim();
        if (!name) return;
        if (!custom.includes(name) && !models.some((m) => m.id === name)) custom = [...custom, name];
        if (!chosen.includes(name)) chosen = [...chosen, name];
        customDraft = "";
    }

    function selected(): Pick<CatalogModel, "id" | "output" | "temperature">[] {
        return chosen.map((id) => {
            const found = models.find((model) => model.id === id);
            if (found) return found;
            const source = detectedSpecs.find((model) => model.id === id);
            return source?.info ?? { id, output: 0, temperature: true };
        });
    }

    function draft(preset: ProviderPreset) {
        return connectPreset(config.ai, {
            preset,
            name: presetName(preset),
            apiKey,
            models: selected(),
            defaultModel,
            makeDefault,
        });
    }

    function save(): void {
        if (!openPreset || !canSave) return;
        onsave({ ...config, ai: draft(openPreset) });
        showMessage(t("provider.connectedMsg", presetName(openPreset)), 4000);
    }

    async function testConn(): Promise<void> {
        if (!openPreset || !service || !canSave) return;
        test = { state: "testing", message: "" };
        const ai = draft(openPreset);
        const model = ai.models.find(
            (m) => m.endpointId === presetEndpointId(openPreset.id) && m.name === defaultModel
        );
        try {
            const reply = await service.testConnection(ai, model?.id);
            test = { state: "ok", message: reply };
        } catch (e) {
            test = { state: "fail", message: (e as Error).message };
        }
    }

    function remove(): void {
        if (!openPreset) return;
        const endpointId = presetEndpointId(openPreset.id);
        const used = new Set(config.ai.models.filter((m) => m.endpointId === endpointId).map((m) => m.id));
        const roles = config.ai.roles;
        if (used.has(roles.generator) || used.has(roles.reviewer) || used.has(roles.grader)) {
            showMessage(t("settings.ai.alertModelInRole"), 7000, "error");
            return;
        }
        const testModelId = used.has(config.ai.testModelId)
            ? (config.ai.models.find((m) => !used.has(m.id))?.id ?? config.ai.testModelId)
            : config.ai.testModelId;
        onsave({
            ...config,
            ai: {
                ...config.ai,
                endpoints: config.ai.endpoints.filter((e) => e.id !== endpointId),
                models: config.ai.models.filter((m) => !used.has(m.id)),
                testModelId,
            },
        });
        openId = null;
    }

    async function refresh(): Promise<void> {
        if (!service) return;
        refreshing = true;
        try {
            catalog = await service.refreshProviderCatalog();
            showMessage(t("provider.refreshed", catalog.fetchedAt.slice(0, 10)), 4000);
        } catch (e) {
            showMessage(t("provider.refreshFailed", (e as Error).message), 7000, "error");
        } finally {
            refreshing = false;
        }
    }

    async function detect(preset: ProviderPreset): Promise<void> {
        if (!service?.detectProviderModels) return;
        const endpoint = config.ai.endpoints.find((item) => item.presetId === preset.id) ?? {
            id: presetEndpointId(preset.id),
            name: presetName(preset),
            provider: "openai" as const,
            protocol: preset.protocol,
            baseUrl: preset.baseUrl,
            apiKey: apiKey.trim(),
        };
        const draftEndpoint = { ...endpoint, apiKey: apiKey.trim(), baseUrl: endpoint.baseUrl || preset.baseUrl };
        detecting = { ...detecting, [preset.id]: true };
        detectMessage = { ...detectMessage, [preset.id]: "" };
        try {
            const result = await service.detectProviderModels(draftEndpoint);
            const detectedIds = result.models.map((item) => item.id);
            const known = models.map((item) => item.id);
            detectedSpecs = result.models;
            chosen = [...new Set([...detectedIds.filter((id) => known.includes(id)), ...custom, ...detectedIds])];
            custom = detectedIds.filter((id) => !known.includes(id));
            detectMessage = {
                ...detectMessage,
                [preset.id]: t("provider.detected", String(detectedIds.length), result.specsFrom),
            };
        } catch (e) {
            detectMessage = { ...detectMessage, [preset.id]: (e as Error).message };
        } finally {
            detecting = { ...detecting, [preset.id]: false };
        }
    }

    const canSave = $derived(apiKey.trim().length > 0 && chosen.length > 0);

    function contextLabel(tokens: number): string {
        if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
        return `${Math.round(tokens / 1000)}K`;
    }
</script>

<section class="flex flex-col gap-3" aria-label={t("provider.title")}>
    <Collapsible.Root bind:open={quickConnectOpen} class="flex flex-col gap-3">
        <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="flex flex-col gap-0.5">
                <h3 class="m-0 text-sm font-semibold">{t("provider.title")}</h3>
                <p class="text-muted-foreground m-0 text-xs">{t("provider.desc")}</p>
            </div>
            <div class="flex items-center gap-2">
                {#if service}
                    <Button variant="ghost" size="sm" data-tap disabled={refreshing} onclick={() => void refresh()}>
                        <RefreshCwIcon class={cn(refreshing && "animate-spin")} aria-hidden="true" />
                        {refreshing ? t("provider.refreshing") : t("provider.refresh")}
                    </Button>
                {/if}
                <Collapsible.Trigger>
                    {#snippet child({ props })}
                        <Button {...props} variant="outline" size="sm" data-tap>
                            <ChevronDownIcon
                                class={cn("transition-transform", quickConnectOpen && "rotate-180")}
                                aria-hidden="true"
                            />
                            {quickConnectOpen ? t("provider.collapse") : t("provider.expand")}
                        </Button>
                    {/snippet}
                </Collapsible.Trigger>
            </div>
        </div>
        <Collapsible.Content class="flex flex-col gap-3">
            <div class="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
                {#each PROVIDER_PRESETS as preset (preset.id)}
                    {@const isOn = Boolean(connectedPreset(config.ai, preset.id))}
                    <Button
                        variant="outline"
                        data-tap
                        class={cn(
                            "h-auto flex-col items-start gap-2 p-3 text-left whitespace-normal",
                            openId === preset.id && "border-rg-accent bg-rg-accent-soft"
                        )}
                        aria-expanded={openId === preset.id}
                        data-provider-card
                        onclick={() => toggle(preset)}
                    >
                        <span class="flex w-full items-center gap-2">
                            <ProviderLogo icon={preset.icon} name={presetName(preset)} />
                            <span class="min-w-0 flex-1 truncate text-sm font-medium">{presetName(preset)}</span>
                        </span>
                        <span class="text-muted-foreground line-clamp-2 text-2xs font-normal">{presetDesc(preset)}</span
                        >
                        {#if isOn}
                            <Badge variant="success" class="gap-1"
                                ><CheckIcon aria-hidden="true" />{t("provider.connected")}</Badge
                            >
                        {:else}
                            <Badge variant="outline" class="text-muted-foreground">{t("provider.notConnected")}</Badge>
                        {/if}
                    </Button>
                {/each}
            </div>

            {#if openPreset}
                {#key openPreset.id}
                    <div
                        class="border-rg-accent-line animate-in fade-in-0 slide-in-from-top-1 flex flex-col gap-4 rounded-lg border p-4 duration-200"
                    >
                        <div class="flex flex-wrap items-center gap-3">
                            <ProviderLogo icon={openPreset.icon} name={presetName(openPreset)} class="size-10" />
                            <div class="flex min-w-0 flex-1 flex-col">
                                <span class="text-sm font-semibold">{presetName(openPreset)}</span>
                                <span
                                    class="text-muted-foreground truncate font-mono text-2xs"
                                    title={openPreset.baseUrl}>{openPreset.baseUrl}</span
                                >
                            </div>
                            <Button variant="link" size="sm" href={openPreset.keyUrl} target="_blank" rel="noreferrer">
                                {t("provider.getKey")}
                                <ExternalLinkIcon aria-hidden="true" />
                            </Button>
                        </div>

                        <Field>
                            <FieldLabel for="rg-provider-key">{t("settings.ai.apiKey")}</FieldLabel>
                            <div class="flex gap-2">
                                <Input
                                    id="rg-provider-key"
                                    class="flex-1 font-mono text-xs"
                                    type={showKey ? "text" : "password"}
                                    autocomplete="off"
                                    value={apiKey}
                                    oninput={(e) => (apiKey = e.currentTarget.value)}
                                />
                                <Button variant="outline" size="sm" data-tap onclick={() => (showKey = !showKey)}>
                                    {showKey ? t("settings.ai.hideKey") : t("settings.ai.showKey")}
                                </Button>
                            </div>
                        </Field>

                        <div class="flex flex-col gap-2">
                            <div class="flex flex-wrap items-baseline justify-between gap-2">
                                <span class="text-sm font-medium">{t("settings.ai.models")}</span>
                                <span class="text-muted-foreground text-2xs">
                                    {modelSource(openPreset) === "models.dev"
                                        ? t("provider.sourceModelsDev", catalog.fetchedAt.slice(0, 10))
                                        : t("provider.sourceBuiltin")}
                                </span>
                            </div>
                            {#if service?.detectProviderModels}
                                <div class="flex flex-wrap items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        data-tap
                                        disabled={detecting[openPreset.id] || !apiKey.trim()}
                                        onclick={() => void detect(openPreset)}
                                    >
                                        {detecting[openPreset.id]
                                            ? t("provider.detecting")
                                            : t("provider.detectModels")}
                                    </Button>
                                    {#if detectMessage[openPreset.id]}
                                        <span class="text-muted-foreground text-xs" role="status"
                                            >{detectMessage[openPreset.id]}</span
                                        >
                                    {/if}
                                </div>
                            {/if}
                            {#if models.length === 0 && custom.length === 0}
                                <p class="text-muted-foreground m-0 text-xs">{t("provider.noModels")}</p>
                            {/if}
                            <div class="grid grid-cols-1 gap-1.5 @xl:grid-cols-2">
                                {#each [...models.map((m) => m.id), ...custom] as id (id)}
                                    {@const info = models.find((m) => m.id === id)}
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        data-tap
                                        class={cn(
                                            "h-auto justify-start gap-2 py-1.5 text-left whitespace-normal",
                                            chosen.includes(id) && "border-rg-accent bg-rg-accent-soft"
                                        )}
                                        aria-pressed={chosen.includes(id)}
                                        onclick={() => toggleModel(id)}
                                    >
                                        <span
                                            class={cn(
                                                "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                                                chosen.includes(id) &&
                                                    "border-rg-accent bg-rg-accent text-rg-accent-foreground"
                                            )}
                                            aria-hidden="true"
                                        >
                                            {#if chosen.includes(id)}<CheckIcon class="size-3" />{/if}
                                        </span>
                                        <span class="min-w-0 flex-1 truncate font-mono text-xs">{id}</span>
                                        {#if latest?.id === id}<Badge class="text-2xs">{t("provider.latest")}</Badge
                                            >{/if}
                                        {#if info?.reasoning}<Badge variant="secondary" class="text-2xs"
                                                >{t("provider.reasoning")}</Badge
                                            >{/if}
                                        {#if info && info.context > 0}
                                            <span class="text-muted-foreground text-2xs tabular-nums"
                                                >{contextLabel(info.context)}</span
                                            >
                                        {/if}
                                    </Button>
                                {/each}
                            </div>
                            <div class="flex gap-2">
                                <Input
                                    class="flex-1 font-mono text-xs"
                                    placeholder={t("provider.customPlaceholder")}
                                    aria-label={t("provider.customPlaceholder")}
                                    value={customDraft}
                                    oninput={(e) => (customDraft = e.currentTarget.value)}
                                    onkeydown={(e) => e.key === "Enter" && addCustom()}
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    data-tap
                                    disabled={!customDraft.trim()}
                                    onclick={addCustom}
                                >
                                    {t("provider.addCustom")}
                                </Button>
                            </div>
                        </div>

                        <div class="flex items-center gap-2">
                            <Checkbox
                                id="rg-provider-default"
                                checked={makeDefault}
                                onCheckedChange={(v) => (makeDefault = v === true)}
                            />
                            <Label for="rg-provider-default" class="text-sm font-normal"
                                >{t("provider.makeDefault")}</Label
                            >
                        </div>

                        <div class="flex flex-wrap items-center gap-2">
                            {#if service}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    data-tap
                                    disabled={!canSave || test.state === "testing"}
                                    onclick={() => void testConn()}
                                >
                                    {test.state === "testing" ? t("settings.ai.testing") : t("settings.ai.testConn")}
                                </Button>
                            {/if}
                            <Button size="sm" data-tap disabled={!canSave} onclick={save}>
                                {connected ? t("provider.save") : t("provider.connect")}
                            </Button>
                            {#if connected}
                                <Button variant="ghost" size="sm" data-tap class="text-destructive" onclick={remove}>
                                    {t("provider.remove")}
                                </Button>
                            {/if}
                            <span class="text-xs" role="status" aria-live="polite">
                                {#if test.state === "ok"}
                                    <Badge variant="success">{t("settings.ai.connOk")}</Badge>
                                {:else if test.state === "fail"}
                                    <span class="text-destructive break-all"
                                        >{t("settings.ai.connFail")} · {test.message}</span
                                    >
                                {/if}
                            </span>
                        </div>
                    </div>
                {/key}
            {/if}
        </Collapsible.Content>
    </Collapsible.Root>
</section>
