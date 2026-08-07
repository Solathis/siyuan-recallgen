<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import SettingsAI from "./SettingsAI.svelte";
    import SettingsGeneral from "./SettingsGeneral.svelte";
    import SettingsPrompts from "./SettingsPrompts.svelte";
    import SettingsHeatmap from "./SettingsHeatmap.svelte";
    import SettingsData from "./SettingsData.svelte";
    import { cn } from "./components";
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

    type SectionKey = typeof SECTIONS[number]["key"];
    let active: SectionKey = "ai";

    function handleSave(e: { detail: RecallGenConfig }) { dispatch("save", e.detail); }
</script>

<div class="rg-setting-layout">
    <nav class="rg-setting-nav">
        {#each SECTIONS as s}
            <button
                type="button"
                class={cn("rg-nav-btn", active === s.key && "rg-nav-btn--active")}
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
        height: 100%;
        min-height: 0;
        overflow: hidden;
    }
    .rg-setting-nav {
        flex-shrink: 0;
        width: 152px;
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding: 8px 6px;
        border-right: 1px solid var(--b3-border-color);
        background: var(--b3-theme-background-light);
        overflow-y: auto;
    }
    .rg-nav-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 40px;
        padding: 0 12px;
        border: none;
        border-left: 3px solid transparent;
        border-radius: var(--b3-border-radius);
        background: transparent;
        color: var(--b3-theme-on-background);
        font-size: 13px;
        text-align: left;
        cursor: pointer;
        transition: background .12s;
    }
    .rg-nav-btn:hover { background: var(--b3-list-hover); }
    .rg-nav-btn--active {
        background: var(--b3-theme-background);
        border-left-color: var(--b3-theme-primary);
        font-weight: 600;
    }
    .rg-nav-icon { font-size: 15px; flex-shrink: 0; line-height: 1; }
    .rg-nav-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rg-setting-content {
        flex: 1;
        min-width: 0;
        overflow-y: auto;
        padding: 12px 16px;
    }
    @media (max-width: 640px) {
        .rg-setting-layout { flex-direction: column; }
        .rg-setting-nav {
            width: 100%;
            flex-direction: row;
            border-right: none;
            border-bottom: 1px solid var(--b3-border-color);
            overflow-x: auto;
            padding: 6px 8px;
        }
        .rg-nav-btn {
            height: 36px;
            padding: 0 10px;
            border-left: none;
            border-bottom: 3px solid transparent;
            border-radius: var(--b3-border-radius);
        }
        .rg-nav-btn--active {
            border-bottom-color: var(--b3-theme-primary);
            border-left-color: transparent;
        }
        .rg-setting-content { padding: 12px; }
    }
</style>
