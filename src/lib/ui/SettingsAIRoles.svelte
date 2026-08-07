<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { card, field, select, cn } from "./components";
    import type { RecallGenConfig } from "@/types/config";

    export let config: RecallGenConfig;
    const dispatch = createEventDispatcher<{ save: RecallGenConfig }>();

    function v(e: Event): string { return (e.target as HTMLSelectElement).value; }

    function patchRoles(patch: Partial<typeof config.ai.roles>) {
        dispatch("save", { ...config, ai: { ...config.ai, roles: { ...config.ai.roles, ...patch } } });
    }

    /** 角色当前模型所属端点 ID */
    function endpointIdOf(roleKey: "generator" | "reviewer" | "grader"): string {
        const modelId = config.ai.roles[roleKey];
        const model = config.ai.models.find((m) => m.id === modelId);
        return model?.endpointId ?? config.ai.endpoints[0]?.id ?? "";
    }

    /** 指定端点下的模型 */
    function modelsOf(epId: string) {
        return config.ai.models.filter((m) => m.endpointId === epId);
    }

    function onRoleEndpoint(roleKey: "generator" | "reviewer" | "grader", e: Event) {
        const epId = v(e);
        const first = modelsOf(epId)[0];
        if (first) patchRoles({ [roleKey]: first.id } as Partial<typeof config.ai.roles>);
    }

    function onRoleModel(roleKey: "generator" | "reviewer" | "grader", e: Event) {
        patchRoles({ [roleKey]: v(e) } as Partial<typeof config.ai.roles>);
    }

    const ROLES = [
        { key: "generator" as const, label: "出题者", icon: "✍️", desc: "根据笔记内容生成复习题目" },
        { key: "reviewer" as const, label: "审题者", icon: "🔍", desc: "审核题目严谨性与正确性，不通过的题退回出题者重新生成" },
        { key: "grader" as const, label: "判题者", icon: "⚖️", desc: "评分主观题/编程题，并负责薄弱点分析与 AI 答疑" },
    ];
</script>

<div class={card.root}>
    <div class={card.header}>
        <h3 class={card.title}>AI 身份</h3>
        <p class={card.description}>为出题、审题、判题三个环节分别指定端点与模型</p>
    </div>
    <div class={cn(card.content, field.group)}>
        {#each ROLES as r}
            <div class="rg-role-card">
                <div class="rg-role-head">
                    <span class="rg-role-icon">{r.icon}</span>
                    <div class="rg-role-info">
                        <span class="rg-role-label">{r.label}</span>
                        <span class={field.description}>{r.desc}</span>
                    </div>
                </div>
                <div class="rg-role-row">
                    <label class={field.label}>端点</label>
                    <select class={select} value={endpointIdOf(r.key)} on:change={(e) => onRoleEndpoint(r.key, e)}>
                        {#each config.ai.endpoints as ep}
                            <option value={ep.id}>{ep.name}</option>
                        {/each}
                    </select>
                </div>
                <div class="rg-role-row">
                    <label class={field.label}>模型</label>
                    <select class={select} value={config.ai.roles[r.key]} on:change={(e) => onRoleModel(r.key, e)}>
                        {#each modelsOf(endpointIdOf(r.key)) as m}
                            <option value={m.id}>{m.name}</option>
                        {/each}
                    </select>
                </div>
            </div>
        {/each}

        <div class="rg-role-hint">
            <span class={field.description}>
                💡 出题者和审题者建议使用不同模型以获得更好效果。判题者也可用同一模型。
                审题循环最多重试 3 轮，未通过的题目会退回出题者重新生成。
            </span>
        </div>
    </div>
</div>

<style>
    .rg-role-card { border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    .rg-role-head { display: flex; align-items: flex-start; gap: 10px; }
    .rg-role-icon { font-size: 20px; line-height: 1.2; flex-shrink: 0; }
    .rg-role-info { display: flex; flex-direction: column; gap: 2px; }
    .rg-role-label { font-weight: 600; font-size: 14px; color: var(--b3-theme-on-background); }
    .rg-role-row { display: flex; align-items: center; gap: 8px; }
    .rg-role-row label { width: 56px; flex-shrink: 0; font-size: 13px; }
    .rg-role-row select { flex: 1; }
    .rg-role-hint { padding: 8px 0; }
    @media (max-width: 640px) {
        .rg-role-row { flex-direction: column; align-items: stretch; }
        .rg-role-row label { width: auto; }
    }
</style>
