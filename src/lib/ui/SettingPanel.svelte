<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import SettingsAI from "./SettingsAI.svelte";
    import SettingsAIRoles from "./SettingsAIRoles.svelte";
    import SettingsGeneral from "./SettingsGeneral.svelte";
    import SettingsPrompts from "./SettingsPrompts.svelte";
    import SettingsHeatmap from "./SettingsHeatmap.svelte";
    import SettingsData from "./SettingsData.svelte";
    import { sidebarNav, sidebarNavItem, scrollArea } from "./components";
    import { t } from "../i18n";
    import type { RecallGenConfig } from "@/types/config";
    import type { ScoreIndexEntry } from "@/types/quiz";

    export let config: RecallGenConfig;
    export let scores: ScoreIndexEntry[] = [];
    export let onTestConnection: () => Promise<string> = async () => "";
    export let onClearScores: () => Promise<void> = async () => {};
    export let onClearProgress: () => Promise<void> = async () => {};

    const dispatch = createEventDispatcher<{ save: RecallGenConfig }>();

    const SECTIONS = [
        { key: "ai", label: t("settings.nav.ai"), icon: "🔌" },
        { key: "roles", label: t("settings.nav.roles"), icon: "👥" },
        { key: "general", label: t("settings.nav.general"), icon: "📝" },
        { key: "prompts", label: t("settings.nav.prompts"), icon: "💬" },
        { key: "heatmap", label: t("settings.nav.heatmap"), icon: "📊" },
        { key: "data", label: t("settings.nav.data"), icon: "🗑️" },
    ] as const;

    type SectionKey = (typeof SECTIONS)[number]["key"];
    let active: SectionKey = "ai";

    function handleSave(e: { detail: RecallGenConfig }) {
        config = e.detail;
        dispatch("save", e.detail);
    }
</script>

<div class="rg-setting-layout">
    <nav class={sidebarNav}>
        {#each SECTIONS as s}
            <button type="button" class={sidebarNavItem(active === s.key)} on:click={() => (active = s.key)}>
                <span class="rg-nav-icon">{s.icon}</span>
                <span class="rg-nav-label">{s.label}</span>
            </button>
        {/each}
    </nav>
    <div class="rg-setting-main">
        <div class={scrollArea}>
            <div class="rg-setting-inner">
                {#if active === "ai"}
                    <SettingsAI {config} {onTestConnection} on:save={handleSave} />
                {:else if active === "roles"}
                    <SettingsAIRoles {config} on:save={handleSave} />
                {:else if active === "general"}
                    <SettingsGeneral {config} on:save={handleSave} />
                {:else if active === "prompts"}
                    <SettingsPrompts {config} on:save={handleSave} />
                {:else if active === "heatmap"}
                    <SettingsHeatmap {config} {scores} on:save={handleSave} />
                {:else if active === "data"}
                    <SettingsData {onClearScores} {onClearProgress} />
                {/if}
            </div>
        </div>
    </div>
</div>

<style>
    .rg-setting-layout {
        display: flex;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        border: 1px solid var(--b3-border-color);
        border-radius: calc(var(--b3-border-radius) * 1.5);
        background: var(--b3-theme-background);
        flex: 1;
    }
    .rg-setting-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    .rg-setting-inner {
        padding: 16px 20px;
    }
    .rg-nav-icon {
        font-size: 15px;
        flex-shrink: 0;
        line-height: 1;
    }
    .rg-nav-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    @media (max-width: 640px) {
        .rg-setting-layout {
            flex-direction: column;
        }
        :global(.rg-sidebar-nav) {
            flex-direction: row;
            overflow-x: auto;
            overflow-y: hidden;
            border-right: none;
            border-bottom: 1px solid var(--b3-border-color);
        }
        :global(.rg-sidebar-nav__item) {
            height: 36px;
            padding: 0 10px;
            border-left: none;
            border-bottom: 3px solid transparent;
        }
        :global(.rg-sidebar-nav__item--active) {
            border-bottom-color: var(--b3-theme-primary);
            border-left-color: transparent;
        }
        .rg-setting-inner {
            padding: 12px;
        }
    }
</style>
