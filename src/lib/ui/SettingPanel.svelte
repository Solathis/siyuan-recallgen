<script lang="ts">
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import type { RecallGenConfig } from "@/types/config";
    import type { ScoreIndexEntry } from "@/types/quiz";
    import SettingsAI from "./SettingsAI.svelte";
    import SettingsAIRoles from "./SettingsAIRoles.svelte";
    import SettingsData from "./SettingsData.svelte";
    import SettingsGeneral from "./SettingsGeneral.svelte";
    import SettingsHeatmap from "./SettingsHeatmap.svelte";
    import SettingsPrompts from "./SettingsPrompts.svelte";

    let {
        config,
        scores = [],
        onTestConnection = async () => "",
        onClearScores = async () => {},
        onClearProgress = async () => {},
        onSave = () => {},
        onClearBank = async () => {},
        onImportConfig = () => {},
        service,
    }: {
        config: RecallGenConfig;
        service?: import("../quiz/service").QuizService;
        scores?: ScoreIndexEntry[];
        onTestConnection?: () => Promise<string>;
        onClearScores?: () => Promise<void>;
        onClearProgress?: () => Promise<void>;
        onClearBank?: () => Promise<void>;
        onImportConfig?: (next: RecallGenConfig, result: import("../quiz/config-io").ImportResult) => void;
        /** 配置保存回调。Svelte 5 的 mount() 不再暴露 $on，因此改用回调属性 */
        onSave?: (config: RecallGenConfig) => void;
    } = $props();

    const SECTIONS = [
        { key: "ai", label: t("settings.nav.ai"), icon: "🔌" },
        { key: "roles", label: t("settings.nav.roles"), icon: "👥" },
        { key: "general", label: t("settings.nav.general"), icon: "📝" },
        { key: "prompts", label: t("settings.nav.prompts"), icon: "💬" },
        { key: "heatmap", label: t("settings.nav.heatmap"), icon: "📊" },
        { key: "data", label: t("settings.nav.data"), icon: "🗑️" },
    ] as const;

    type SectionKey = (typeof SECTIONS)[number]["key"];
    let active = $state<SectionKey>("ai");
    /**
     * 面板内的配置副本：弹窗打开后父组件的 props 不再更新，
     * 因此以本地副本为准，每次保存后同步刷新；读取初始值包在函数里以避开响应式捕获警告。
     */
    function initialConfig() {
        return config;
    }
    let localConfig = $state(initialConfig());

    /** 题库概览，用于数据管理分区展示与二次确认提示 */
    let bank = $state<{ total: number; due: number }>({ total: 0, due: 0 });
    $effect(() => {
        void service?.bankSummary().then((summary) => (bank = { total: summary.total, due: summary.due }));
    });

    function handleSave(next: RecallGenConfig) {
        localConfig = next;
        onSave(next);
    }
</script>

<div class="rg-scope flex h-full min-h-0 flex-1 overflow-hidden rounded-lg border">
    <!-- 窄屏改为横向滚动导航 -->
    <nav
        class="border-border flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:w-40 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0"
        aria-label={t("settings.title")}
    >
        {#each SECTIONS as section (section.key)}
            <button
                type="button"
                class={cn(
                    "flex h-9 shrink-0 items-center gap-2 rounded-md border-l-2 px-3 text-left text-sm whitespace-nowrap transition-colors",
                    active === section.key
                        ? "border-primary bg-background font-semibold"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground border-transparent"
                )}
                aria-current={active === section.key}
                onclick={() => (active = section.key)}
            >
                <span aria-hidden="true">{section.icon}</span>
                <span>{section.label}</span>
            </button>
        {/each}
    </nav>

    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div class="min-h-0 flex-1 overflow-y-auto p-4">
            {#if active === "ai"}
                <SettingsAI config={localConfig} {onTestConnection} onsave={handleSave} />
            {:else if active === "roles"}
                <SettingsAIRoles config={localConfig} onsave={handleSave} />
            {:else if active === "general"}
                <SettingsGeneral config={localConfig} onsave={handleSave} {service} />
            {:else if active === "prompts"}
                <SettingsPrompts config={localConfig} onsave={handleSave} />
            {:else if active === "heatmap"}
                <SettingsHeatmap config={localConfig} {scores} onsave={handleSave} />
            {:else if active === "data"}
                <SettingsData
                    {onClearScores}
                    {onClearProgress}
                    {onClearBank}
                    config={localConfig}
                    {onImportConfig}
                    scoreCount={scores.length}
                    bankSize={bank.total}
                    bankDue={bank.due}
                />
            {/if}
        </div>
    </div>
</div>
