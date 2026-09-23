<script lang="ts">
    import { progress as p, cn } from "./components";
    export let value: number | null = null;
    export let label: string = "";
    $: indeterminate = value === null;
    $: pct = indeterminate ? 0 : Math.max(0, Math.min(100, value as number));
</script>

<div class="rg-progress-wrap">
    {#if label}<span class="rg-progress-label">{label}</span>{/if}
    <div class={p.root} role="progressbar" aria-valuenow={indeterminate ? undefined : pct}>
        <div class={cn(p.bar, indeterminate && p.indeterminate)} style={!indeterminate ? `width:${pct}%` : ""}></div>
    </div>
</div>

<style>
    .rg-progress-wrap {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        max-width: 480px;
    }
    .rg-progress-label {
        font-size: 13px;
        color: var(--b3-theme-on-surface-light);
    }
</style>
