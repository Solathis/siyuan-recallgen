<script lang="ts">
    import { Progress } from "@/lib/components/ui/progress";

    let { value = null, label = "" }: { value?: number | null; label?: string } = $props();

    /** null 表示进度未知，使用无尽滑动动画 */
    const indeterminate = $derived(value === null);
    const pct = $derived(indeterminate ? 0 : Math.max(0, Math.min(100, value as number)));
</script>

<div class="flex w-full max-w-md flex-col gap-2">
    {#if label}
        <span class="text-muted-foreground text-xs" aria-live="polite">{label}</span>
    {/if}

    {#if indeterminate}
        <div
            class="bg-muted relative h-1 w-full overflow-hidden rounded-full"
            role="progressbar"
            aria-label={label || undefined}
        >
            <div class="bg-primary rg-indeterminate-bar absolute h-full w-1/3 rounded-full"></div>
        </div>
    {:else}
        <Progress value={pct} aria-label={label || undefined} />
    {/if}
</div>
