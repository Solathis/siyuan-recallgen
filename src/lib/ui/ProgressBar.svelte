<script lang="ts">
    /**
     * 通用进度条：indeterminate 态用于无法精确计数的长任务（AI 生成），
     * determinate 态用于按任务数推进（并发判分）。
     */
    export let value: number | null = null; // null => indeterminate；0-100 => determinate
    export let label: string = "";
    export let height: string = "6px";
</script>

<div class="rg-progress" style="--h:{height}">
    <div class="rg-progress__bar" class:indeterminate={value === null}
         style={value !== null ? `width:${Math.max(0, Math.min(100, value))}%` : ""}>
    </div>
</div>
{#if label}
    <div class="rg-progress__label">{label}</div>
{/if}

<style>
    .rg-progress {
        width: 100%;
        height: var(--h);
        background: var(--b3-theme-background-light);
        border-radius: 999px;
        overflow: hidden;
        position: relative;
    }
    .rg-progress__bar {
        height: 100%;
        background: var(--b3-theme-primary, #3573f0);
        border-radius: 999px;
        transition: width 0.3s ease;
    }
    .rg-progress__bar.indeterminate {
        width: 40%;
        position: absolute;
        animation: rg-indeterminate 1.2s infinite ease-in-out;
    }
    @keyframes rg-indeterminate {
        0% { left: -40%; }
        100% { left: 100%; }
    }
    .rg-progress__label {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        margin-top: 4px;
        text-align: center;
    }
</style>
