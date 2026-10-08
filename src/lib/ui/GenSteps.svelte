<script lang="ts">
    import CheckIcon from "@lucide/svelte/icons/check";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import type { GenPhase } from "../quiz/generator";
    import { stepStates } from "../quiz/gen-progress";

    /**
     * 出题流程步骤条。
     *
     * 原来只有一行小字「流程：生成 → 审题 → 重做不合格题（最多 3 轮）」，
     * 用户看不出现在走到哪一步、还剩几步；失败时也不知道是生成失败还是审题没过。
     * 这里把三步做成有状态的步骤条，当前阶段高亮，走过的打勾。
     *
     * 没配审题模型时不会走审题与重做，那两步直接不渲染——画出来又永远不亮，
     * 只会让人以为是卡住了。
     */
    let { phase, hasReviewer = false }: { phase: GenPhase; hasReviewer?: boolean } = $props();

    const LABELS: Record<GenPhase, string> = {
        generating: "gen.phase.generating",
        reviewing: "gen.phase.reviewing",
        regenerating: "gen.phase.regenerating",
    };

    const states = $derived(stepStates(phase));
    const steps = $derived(
        hasReviewer ? (["generating", "reviewing", "regenerating"] as GenPhase[]) : (["generating"] as GenPhase[])
    );
</script>

<ol class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
    {#each steps as step, index (step)}
        {@const state = states[step]}
        <li class="flex items-center gap-1.5" aria-current={state === "active" ? "step" : undefined}>
            <span
                class={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold",
                    state === "done" && "border-rg-accent bg-rg-accent text-rg-accent-foreground",
                    state === "active" && "border-rg-accent text-rg-accent bg-rg-accent-soft",
                    state === "pending" && "border-border text-muted-foreground"
                )}
                aria-hidden="true"
            >
                {#if state === "done"}
                    <CheckIcon class="size-3" />
                {:else}
                    {index + 1}
                {/if}
            </span>
            <span class={cn("text-xs", state === "pending" ? "text-muted-foreground" : "text-foreground font-medium")}
                >{t(LABELS[step])}</span
            >
        </li>
        {#if index < steps.length - 1}
            <span class="bg-border h-px w-5" aria-hidden="true"></span>
        {/if}
    {/each}
</ol>
