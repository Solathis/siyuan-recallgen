<script lang="ts">
    import * as Card from "@/lib/components/ui/card";
    import * as Select from "@/lib/components/ui/select";
    import { Field, FieldLabel } from "@/lib/components/ui/field";
    import { t } from "../i18n";
    import type { AIRoles, RecallGenConfig } from "@/types/config";

    let { config, onsave }: { config: RecallGenConfig; onsave: (config: RecallGenConfig) => void } = $props();

    type RoleKey = keyof AIRoles;

    const ROLES: { key: RoleKey; icon: string }[] = [
        { key: "generator", icon: "✍️" },
        { key: "reviewer", icon: "🔍" },
        { key: "grader", icon: "⚖️" },
    ];

    function patchRoles(patch: Partial<AIRoles>) {
        onsave({ ...config, ai: { ...config.ai, roles: { ...config.ai.roles, ...patch } } });
    }

    /** 角色当前模型所属端点 */
    function endpointIdOf(role: RoleKey): string {
        const model = config.ai.models.find((m) => m.id === config.ai.roles[role]);
        return model?.endpointId ?? config.ai.endpoints[0]?.id ?? "";
    }

    function modelsOf(endpointId: string) {
        return config.ai.models.filter((m) => m.endpointId === endpointId);
    }

    function onRoleEndpoint(role: RoleKey, endpointId: string) {
        const first = modelsOf(endpointId)[0];
        if (first) patchRoles({ [role]: first.id } as Partial<AIRoles>);
    }

    function labelOf(role: RoleKey): string {
        return t(`settings.roles.${role}`);
    }
    function descOf(role: RoleKey): string {
        return t(`settings.roles.${role}Desc`);
    }
</script>

<Card.Root>
    <Card.Header>
        <Card.Title>{t("settings.roles.title")}</Card.Title>
        <Card.Description>{t("settings.roles.desc")}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-3">
        {#each ROLES as role (role.key)}
            <div class="border-border flex flex-col gap-3 rounded-lg border p-3">
                <div class="flex items-start gap-2.5">
                    <span class="text-xl leading-none" aria-hidden="true">{role.icon}</span>
                    <div class="flex flex-col">
                        <span class="text-sm font-semibold">{labelOf(role.key)}</span>
                        <span class="text-muted-foreground text-xs">{descOf(role.key)}</span>
                    </div>
                </div>
                <div class="grid grid-cols-1 gap-3 @xl:grid-cols-2">
                    <Field>
                        <FieldLabel for={`rg-role-endpoint-${role.key}`}>{t("settings.roles.endpoint")}</FieldLabel>
                        <Select.Root
                            type="single"
                            value={endpointIdOf(role.key)}
                            onValueChange={(v) => onRoleEndpoint(role.key, v)}
                        >
                            <Select.Trigger id={`rg-role-endpoint-${role.key}`} class="w-full">
                                {config.ai.endpoints.find((e) => e.id === endpointIdOf(role.key))?.name ?? ""}
                            </Select.Trigger>
                            <Select.Content>
                                {#each config.ai.endpoints as endpoint (endpoint.id)}
                                    <Select.Item value={endpoint.id}>{endpoint.name}</Select.Item>
                                {/each}
                            </Select.Content>
                        </Select.Root>
                    </Field>
                    <Field>
                        <FieldLabel for={`rg-role-model-${role.key}`}>{t("settings.roles.model")}</FieldLabel>
                        <Select.Root
                            type="single"
                            value={config.ai.roles[role.key]}
                            onValueChange={(v) => patchRoles({ [role.key]: v } as Partial<AIRoles>)}
                        >
                            <Select.Trigger id={`rg-role-model-${role.key}`} class="w-full">
                                {config.ai.models.find((m) => m.id === config.ai.roles[role.key])?.name ?? ""}
                            </Select.Trigger>
                            <Select.Content>
                                {#each modelsOf(endpointIdOf(role.key)) as model (model.id)}
                                    <Select.Item value={model.id}>{model.name}</Select.Item>
                                {/each}
                            </Select.Content>
                        </Select.Root>
                    </Field>
                </div>
            </div>
        {/each}
        <p class="text-muted-foreground text-xs">{t("settings.roles.hint")}</p>
    </Card.Content>
</Card.Root>
