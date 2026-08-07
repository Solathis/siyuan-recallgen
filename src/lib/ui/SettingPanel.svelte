<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import SettingsAI from "./SettingsAI.svelte";
    import SettingsGeneral from "./SettingsGeneral.svelte";
    import SettingsPrompts from "./SettingsPrompts.svelte";
    import SettingsHeatmap from "./SettingsHeatmap.svelte";
    import SettingsData from "./SettingsData.svelte";
    import type { RecallGenConfig } from "@/types/config";
    import type { ScoreRecord } from "@/types/quiz";

    export let config: RecallGenConfig;
    export let scores: ScoreRecord[] = [];
    export let onTestConnection: () => Promise<boolean> = async () => false;
    export let onClearScores: () => Promise<void> = async () => {};
    export let onClearProgress: () => Promise<void> = async () => {};

    const dispatch = createEventDispatcher<{ save: RecallGenConfig }>();

    const SECTIONS = [
        { key: "ai", label: "AI 服务", icon: "🔌" },
        { key: "general", label: "题目与答题", icon: "📝" },
        { key: "prompts", label: "提示词", icon: "💬" },
        { key: "heatmap", label: "热力图", icon: "📊" },
        { key: "data", label: "数据管理", icon: "🗑️" },
    ] as const;

    let active = "ai";
    function handleSave(e: { detail: RecallGenConfig }) { dispatch("save", e.detail); }
</script>

<div class="rg-setting-layout">
    <nav class="rg-setting-nav">
        {#each SECTIONS as s}
            <button
                type="button"
                class="rg-nav-btn"
                class:active={active === s.key}
                on:click={() => active = s.key}
            >
                <span class="rg-nav-icon">{s.icon}</span>
                <span class="rg-nav-label">{s.label}</span>
            </button>
        {/each}
    </nav>
    <div class="rg-setting-content">
        {#if active === "ai"}
            <SettingsAI {config} {onTestConnection} on:save={handleSave} />
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

<style>
    .rg-setting-layout {
        display: flex;
        gap: 0;
        min-height: 60vh;
        max-height: 70vh;
    }
    .rg-setting-nav {
        flex-shrink: 0;
        width: 160px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px 0;
        border-right: 1px solid var(--b3-border-color);
        background: var(--b3-theme-background-light);
        overflow-y: auto;
    }
    .rg-nav-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border: none;
        background: transparent;
        color: var(--b3-theme-on-background);
        font-size: 13px;
        text-align: left;
        cursor: pointer;
        transition: background .12s;
        border-left: 3px solid transparent;
    }
    .rg-nav-btn:hover { background: var(--b3-list-hover); }
    .rg-nav-btn.active {
        background: var(--b3-theme-background);
        border-left-color: var(--b3-theme-primary);
        font-weight: 600;
    }
    .rg-nav-icon { font-size: 16px; flex-shrink: 0; }
    .rg-nav-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rg-setting-content {
        flex: 1;
        min-width: 0;
        overflow-y: auto;
        padding: 12px 16px;
    }
    @media (max-width: 640px) {
        .rg-setting-layout { flex-direction: column; max-height: none; }
        .rg-setting-nav {
            width: 100%;
            flex-direction: row;
            border-right: none;
            border-bottom: 1px solid var(--b3-border-color);
            overflow-x: auto;
            padding: 6px 8px;
        }
        .rg-nav-btn { border-left: none; border-bottom: 3px solid transparent; padding: 8px 12px; }
        .rg-nav-btn.active { border-bottom-color: var(--b3-theme-primary); border-left-color: transparent; }
        .rg-setting-content { padding: 12px; }
    }
</style>
