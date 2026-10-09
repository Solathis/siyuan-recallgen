<script lang="ts">
    import { onMount } from "svelte";
    import { Badge } from "@/lib/components/ui/badge";
    import { Button } from "@/lib/components/ui/button";
    import { applyPreset, makePreset, matchesPreset, removePreset, savePreset } from "../quiz/presets";
    import { showMessage } from "siyuan";
    import * as Card from "@/lib/components/ui/card";
    import { Checkbox } from "@/lib/components/ui/checkbox";
    import { Input } from "@/lib/components/ui/input";
    import { Slider } from "@/lib/components/ui/slider";
    import { Label } from "@/lib/components/ui/label";
    import * as Select from "@/lib/components/ui/select";
    import { Switch } from "@/lib/components/ui/switch";
    import { t } from "../i18n";
    import type { QuizService } from "../quiz/service";
    import type { MultipleChoicePolicy, RecallGenConfig, StorageLocation } from "@/types/config";
    import type { QuestionType } from "@/types/quiz";

    let {
        config,
        onsave,
        service,
    }: {
        config: RecallGenConfig;
        onsave: (config: RecallGenConfig) => void;
        /** 用于拉取笔记本列表；缺省时退化为手填 ID */
        service?: QuizService;
    } = $props();

    const TYPE_OPTIONS: QuestionType[] = [
        "single_choice",
        "multiple_choice",
        "fill_blank",
        "true_false",
        "subjective",
        "coding",
    ];

    /* ── 配置写入 ────────────────────────────────────────────────── */

    function patchGeneral(patch: Partial<RecallGenConfig["general"]>) {
        onsave({ ...config, general: { ...config.general, ...patch } });
    }

    function toggleType(type: QuestionType) {
        const current = config.general.allowedTypes;
        const next = current.includes(type) ? current.filter((x) => x !== type) : [...current, type];
        // 一个题型都不选会让生成必然失败，直接拒绝而不是留下无效配置
        if (next.length === 0) {
            showMessage(t("settings.general.atLeastOneType"), 7000, "error");
            return;
        }
        patchGeneral({ allowedTypes: next });
    }

    /** 难度分档收敛到 0-50 的整数，避免写入负数或超大值 */
    function clampCount(value: number): number {
        return Math.max(0, Math.min(50, Math.round(value)));
    }

    function patchDifficulty(patch: Partial<RecallGenConfig["general"]["difficulty"]>) {
        const merged = { ...config.general.difficulty, ...patch };
        for (const key of ["total", "easy", "medium", "hard"] as const) {
            merged[key] = clampCount(merged[key]);
        }
        patchGeneral({ difficulty: merged });
    }

    /* ── 试卷预设 ────────────────────────────────────────────────── */

    let presetName = $state("");

    function saveCurrentAsPreset() {
        const name = presetName.trim();
        if (!name) {
            showMessage(t("settings.general.presetNameRequired"), 5000, "error");
            return;
        }
        const preset = makePreset(name, config.general, `preset-${Date.now().toString(36)}`);
        patchGeneral({ presets: savePreset(config.general.presets ?? [], preset) });
        presetName = "";
        showMessage(t("settings.general.presetSaved", preset.name), 4000);
    }

    const diffSum = $derived(
        config.general.difficulty.easy + config.general.difficulty.medium + config.general.difficulty.hard
    );
    const diffOk = $derived(diffSum === config.general.difficulty.total);

    /* ── 笔记本列表 ──────────────────────────────────────────────── */

    let notebooks = $state<{ id: string; name: string }[]>([]);
    let notebooksLoaded = $state(false);

    onMount(async () => {
        if (!service) return;
        notebooks = await service.listNotebooks().catch(() => []);
        notebooksLoaded = true;
    });

    const selectedNotebookName = $derived(
        notebooks.find((n) => n.id === config.general.notebookId)?.name ?? config.general.notebookId
    );
</script>

<Card.Root>
    <Card.Header>
        <Card.Title>{t("settings.general.title")}</Card.Title>
        <Card.Description>{t("settings.general.desc")}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-5">
        <!-- 题型 -->
        <div class="flex flex-col gap-2">
            <span class="text-sm font-medium">{t("settings.general.allowedTypes")}</span>
            <div class="flex flex-wrap gap-x-5 gap-y-2">
                {#each TYPE_OPTIONS as type (type)}
                    <Label class="flex items-center gap-2 text-sm">
                        <Checkbox
                            checked={config.general.allowedTypes.includes(type)}
                            onCheckedChange={() => toggleType(type)}
                            aria-label={t(`type.${type}`)}
                        />
                        <span>{t(`type.${type}`)}</span>
                    </Label>
                {/each}
            </div>
        </div>

        <!-- 难度分布 -->
        <div class="flex flex-col gap-2">
            <span class="text-sm font-medium">{t("settings.general.difficulty")}</span>
            <div class="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
                {#each [["total", t("settings.general.totalCount")], ["easy", t("diff.easy")], ["medium", t("diff.medium")], ["hard", t("diff.hard")]] as [key, label] (key)}
                    <div class="flex flex-col gap-1.5">
                        <Label for={`rg-diff-${key}`}>{label}</Label>
                        <Input
                            id={`rg-diff-${key}`}
                            type="number"
                            min="0"
                            max="50"
                            value={config.general.difficulty[key as "total"]}
                            onchange={(e) => patchDifficulty({ [key]: Number(e.currentTarget.value) })}
                        />
                    </div>
                {/each}
            </div>
            {#if !diffOk}
                <p class="text-warning text-xs">
                    {t("settings.general.diffInvalidDesc", String(config.general.difficulty.total))}
                    {t("settings.general.diffSumNow", String(diffSum))}
                </p>
            {/if}
        </div>

        <!-- 超纲比例 -->
        <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
                <Label for="rg-extra-scope"
                    >{t("settings.general.extraScope", String(config.general.extraScopePct))}</Label
                >
            </div>
            <Slider
                id="rg-extra-scope"
                type="single"
                min={0}
                max={50}
                step={5}
                value={config.general.extraScopePct}
                onValueChange={(v) => patchGeneral({ extraScopePct: v })}
                aria-label={t("settings.general.extraScope")}
            />
            <p class="text-muted-foreground text-xs">{t("settings.general.extraScopeDesc")}</p>
        </div>

        <!-- 面板宽度 -->
        <div class="flex flex-col gap-2">
            <Label for="rg-panel-width">{t("settings.general.panelWidth", String(config.general.panelWidth))}</Label>
            <Slider
                id="rg-panel-width"
                type="single"
                min={600}
                max={1600}
                step={50}
                value={config.general.panelWidth}
                onValueChange={(v) => patchGeneral({ panelWidth: v })}
                aria-label={t("settings.general.panelWidth")}
            />
            <p class="text-muted-foreground text-xs">{t("settings.general.panelWidthDesc")}</p>
        </div>

        <!-- 倒计时 -->
        <div class="flex flex-col gap-2">
            <Label class="flex items-center gap-2 text-sm">
                <Switch
                    checked={config.general.countdownEnabled}
                    onCheckedChange={(checked) => patchGeneral({ countdownEnabled: checked })}
                    aria-label={t("settings.general.countdown")}
                />
                <span>{t("settings.general.countdown")}</span>
            </Label>
            {#if config.general.countdownEnabled}
                <div class="flex flex-col gap-1.5">
                    <Label for="rg-countdown">{t("settings.general.countdownMinutes")}</Label>
                    <Input
                        id="rg-countdown"
                        type="number"
                        min="1"
                        class="w-32"
                        value={config.general.countdownMinutes}
                        onchange={(e) =>
                            patchGeneral({ countdownMinutes: Math.max(1, Number(e.currentTarget.value) || 1) })}
                    />
                    <p class="text-muted-foreground text-xs">{t("settings.general.countdownHint")}</p>
                </div>
            {/if}
        </div>

        <!-- 单次复习题量上限 -->
        <div class="flex flex-col gap-1.5">
            <Label for="rg-review-limit">{t("settings.general.reviewLimit")}</Label>
            <Input
                id="rg-review-limit"
                type="number"
                min="0"
                max="200"
                class="w-32"
                value={config.general.reviewLimit}
                onchange={(e) =>
                    patchGeneral({
                        reviewLimit: Math.min(200, Math.max(0, Math.round(Number(e.currentTarget.value) || 0))),
                    })}
            />
            <p class="text-muted-foreground text-xs">{t("settings.general.reviewLimitHint")}</p>
        </div>

        <!-- 每日学习目标 -->
        <div class="flex flex-col gap-1.5">
            <Label for="rg-daily-goal">{t("settings.general.dailyGoal")}</Label>
            <Input
                id="rg-daily-goal"
                type="number"
                min="0"
                max="500"
                class="w-32"
                value={config.general.dailyGoal}
                onchange={(e) =>
                    patchGeneral({
                        dailyGoal: Math.min(500, Math.max(0, Math.round(Number(e.currentTarget.value) || 0))),
                    })}
            />
            <p class="text-muted-foreground text-xs">{t("settings.general.dailyGoalHint")}</p>
        </div>

        <!-- 存储位置 -->
        <div class="flex flex-col gap-2">
            <Label for="rg-storage">{t("settings.general.storageLocation")}</Label>
            <Select.Root
                type="single"
                value={config.general.storageLocation}
                onValueChange={(v) => patchGeneral({ storageLocation: v as StorageLocation })}
            >
                <Select.Trigger id="rg-storage" class="w-full @xl:w-72">
                    {config.general.storageLocation === "sibling"
                        ? t("settings.general.storageSibling")
                        : t("settings.general.storageNotebook")}
                </Select.Trigger>
                <Select.Content>
                    <Select.Item value="sibling">{t("settings.general.storageSibling")}</Select.Item>
                    <Select.Item value="notebook">{t("settings.general.storageNotebook")}</Select.Item>
                </Select.Content>
            </Select.Root>
            {#if config.general.storageLocation === "notebook"}
                <div class="flex flex-col gap-1.5">
                    <Label for="rg-notebook">{t("settings.general.notebook")}</Label>
                    <!-- 原先要求用户手填笔记本 ID，现改为下拉选择 -->
                    {#if notebooks.length > 0}
                        <Select.Root
                            type="single"
                            value={config.general.notebookId}
                            onValueChange={(v) => patchGeneral({ notebookId: v })}
                        >
                            <Select.Trigger id="rg-notebook" class="w-full @xl:w-72"
                                >{selectedNotebookName}</Select.Trigger
                            >
                            <Select.Content>
                                {#each notebooks as notebook (notebook.id)}
                                    <Select.Item value={notebook.id}>{notebook.name}</Select.Item>
                                {/each}
                            </Select.Content>
                        </Select.Root>
                    {:else}
                        <Input
                            id="rg-notebook"
                            placeholder={t("settings.general.notebookIdPlaceholder")}
                            value={config.general.notebookId}
                            oninput={(e) => patchGeneral({ notebookId: e.currentTarget.value })}
                        />
                        <p class="text-muted-foreground text-xs">
                            {notebooksLoaded
                                ? t("settings.general.noNotebook")
                                : t("settings.general.loadingNotebooks")}
                        </p>
                    {/if}
                </div>
            {/if}
        </div>

        <!-- 试卷预设 -->
        <div class="flex flex-col gap-2">
            <span class="text-sm font-medium">{t("settings.general.presets")}</span>
            <p class="text-muted-foreground text-xs">{t("settings.general.presetsDesc")}</p>
            {#if (config.general.presets ?? []).length > 0}
                <div class="flex flex-col gap-1.5">
                    {#each config.general.presets as preset (preset.id)}
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-xs">
                                {preset.name}
                                <span class="text-muted-foreground">
                                    {t(
                                        "settings.general.presetSummary",
                                        String(preset.difficulty.total),
                                        String(preset.allowedTypes.length)
                                    )}
                                </span>
                            </span>
                            {#if matchesPreset(config.general, preset)}
                                <Badge variant="outline">{t("settings.general.presetActive")}</Badge>
                            {/if}
                            <div class="ml-auto flex gap-1">
                                <Button
                                    variant="outline"
                                    size="xs"
                                    onclick={() => onsave(applyPreset(config, preset))}
                                    aria-label={`${t("settings.general.presetApply")} ${preset.name}`}
                                >
                                    {t("settings.general.presetApply")}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    onclick={() =>
                                        patchGeneral({
                                            presets: removePreset(config.general.presets ?? [], preset.id),
                                        })}
                                >
                                    {t("common.delete")}
                                </Button>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
            <div class="flex flex-wrap items-center gap-2">
                <Input
                    class="w-48"
                    placeholder={t("settings.general.presetNamePlaceholder")}
                    aria-label={t("settings.general.presetNamePlaceholder")}
                    bind:value={presetName}
                />
                <Button variant="outline" size="sm" onclick={saveCurrentAsPreset}>
                    {t("settings.general.presetSave")}
                </Button>
            </div>
        </div>

        <!-- 多选题计分策略 -->
        <div class="flex flex-col gap-2">
            <Label for="rg-mc-policy">{t("settings.general.mcPolicy")}</Label>
            <Select.Root
                type="single"
                value={config.general.multipleChoicePolicy ?? "partial"}
                onValueChange={(v) => patchGeneral({ multipleChoicePolicy: v as MultipleChoicePolicy })}
            >
                <Select.Trigger id="rg-mc-policy" class="w-full @xl:w-72">
                    {config.general.multipleChoicePolicy === "strict"
                        ? t("settings.general.mcPolicyStrict")
                        : t("settings.general.mcPolicyPartial")}
                </Select.Trigger>
                <Select.Content>
                    <Select.Item value="partial">{t("settings.general.mcPolicyPartial")}</Select.Item>
                    <Select.Item value="strict">{t("settings.general.mcPolicyStrict")}</Select.Item>
                </Select.Content>
            </Select.Root>
            <p class="text-muted-foreground text-xs">{t("settings.general.mcPolicyDesc")}</p>
        </div>

        <!-- 输出语言 -->
        <div class="flex flex-col gap-2">
            <Label for="rg-language">{t("settings.general.language")}</Label>
            <Select.Root
                type="single"
                value={config.general.language}
                onValueChange={(v) => patchGeneral({ language: v as "zh" | "en" })}
            >
                <Select.Trigger id="rg-language" class="w-full @xl:w-72">
                    {config.general.language === "zh"
                        ? t("settings.general.languageZh")
                        : t("settings.general.languageEn")}
                </Select.Trigger>
                <Select.Content>
                    <Select.Item value="zh">{t("settings.general.languageZh")}</Select.Item>
                    <Select.Item value="en">{t("settings.general.languageEn")}</Select.Item>
                </Select.Content>
            </Select.Root>
            <p class="text-muted-foreground text-xs">{t("settings.general.languageDesc")}</p>
        </div>
    </Card.Content>
</Card.Root>
