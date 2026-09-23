<script lang="ts">
    import {
        card,
        field,
        input,
        select,
        switchCls,
        checkbox,
        slider,
        alert,
        alertTitle,
        alertDescription,
        cn,
    } from "./components";
    import { showMessage } from "siyuan";
    import { t } from "../i18n";
    import type { RecallGenConfig, StorageLocation } from "@/types/config";
    import type { QuestionType } from "@/types/quiz";

    export let config: RecallGenConfig;
    /** 保存回调：Svelte 5 挂载方式下不再使用事件派发 */
    export let onsave: (config: RecallGenConfig) => void = () => {};

    const TYPE_OPTIONS: { key: QuestionType; label: string }[] = [
        { key: "single_choice", label: t("type.single_choice") },
        { key: "multiple_choice", label: t("type.multiple_choice") },
        { key: "fill_blank", label: t("type.fill_blank") },
        { key: "true_false", label: t("type.true_false") },
        { key: "subjective", label: t("type.subjective") },
        { key: "coding", label: t("type.coding") },
    ];

    function v(e: Event): string {
        return (e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
    }
    function vn(e: Event): number {
        return parseInt(v(e)) || 0;
    }
    function checked(e: Event): boolean {
        return (e.target as HTMLInputElement).checked;
    }

    /**
     * 滑块的本地镜像值：拖动过程只更新镜像，松开时才写回配置。
     * 取值包在函数里，避免在响应式上下文之外直接引用 config。
     */
    function initialExtraScope() {
        return config.general.extraScopePct;
    }
    function initialPanelWidth() {
        return config.general.panelWidth;
    }
    let _extraScope = initialExtraScope();
    let _panelWidth = initialPanelWidth();

    $: diffOk =
        config.general.difficulty.easy + config.general.difficulty.medium + config.general.difficulty.hard ===
        config.general.difficulty.total;
    $: totalValid = config.general.difficulty.total >= 1 && config.general.difficulty.total <= 50;

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
    function patchGeneral(patch: Partial<typeof config.general>) {
        onsave({ ...config, general: { ...config.general, ...patch } });
    }
    /** 难度分档统一收敛到 0-50 的整数，避免写入负数或超大值 */
    function clampCount(value: number): number {
        return Math.max(0, Math.min(50, Math.round(value)));
    }
    function patchDifficulty(patch: Partial<typeof config.general.difficulty>) {
        const merged = { ...config.general.difficulty, ...patch };
        for (const key of ["total", "easy", "medium", "hard"] as const) {
            merged[key] = clampCount(merged[key]);
        }
        patchGeneral({ difficulty: merged });
    }
    function onLangChange(e: Event) {
        patchGeneral({ language: v(e) as "zh" | "en" });
    }
    function onStorageChange(e: Event) {
        patchGeneral({ storageLocation: v(e) as StorageLocation });
    }
</script>

<div class={card.root}>
    <div class={card.header}>
        <h3 class={card.title}>{t("settings.general.title")}</h3>
        <p class={card.description}>{t("settings.general.desc")}</p>
    </div>
    <div class={cn(card.content, field.group)}>
        <div class={field.field}>
            <span class={field.label}>{t("settings.general.allowedTypes")}</span>
            <div class="rg-checks">
                {#each TYPE_OPTIONS as opt}
                    <label class="rg-check-item">
                        <input
                            class={checkbox}
                            type="checkbox"
                            checked={config.general.allowedTypes.includes(opt.key)}
                            on:change={() => toggleType(opt.key)}
                        />
                        {opt.label}
                    </label>
                {/each}
            </div>
        </div>
        <div class={field.field}>
            <label class={field.label} for="rg-total">{t("settings.general.totalCount")}</label>
            <input
                id="rg-total"
                class={cn(input, !totalValid && "rg-input--invalid")}
                type="number"
                min="1"
                max="50"
                value={config.general.difficulty.total}
                on:input={(e) => patchDifficulty({ total: vn(e) })}
            />
        </div>
        <div class="rg-row-3">
            <div class={field.field}>
                <label class={field.label} for="rg-easy">{t("diff.easy")}</label>
                <input
                    id="rg-easy"
                    class={input}
                    type="number"
                    value={config.general.difficulty.easy}
                    on:input={(e) => patchDifficulty({ easy: vn(e) })}
                />
            </div>
            <div class={field.field}>
                <label class={field.label} for="rg-med">{t("diff.medium")}</label>
                <input
                    id="rg-med"
                    class={input}
                    type="number"
                    value={config.general.difficulty.medium}
                    on:input={(e) => patchDifficulty({ medium: vn(e) })}
                />
            </div>
            <div class={field.field}>
                <label class={field.label} for="rg-hard">{t("diff.hard")}</label>
                <input
                    id="rg-hard"
                    class={input}
                    type="number"
                    value={config.general.difficulty.hard}
                    on:input={(e) => patchDifficulty({ hard: vn(e) })}
                />
            </div>
        </div>
        {#if !diffOk}
            <div class={alert("warning")}>
                <p class={alertTitle}>{t("settings.general.diffInvalid")}</p>
                <p class={alertDescription}>
                    {t("settings.general.diffInvalidDesc", String(config.general.difficulty.total))}
                </p>
            </div>
        {/if}
        <div class={field.field}>
            <span class={field.label}>{t("settings.general.extraScope", String(_extraScope))}</span>
            <span class={field.description}>{t("settings.general.extraScopeDesc")}</span>
            <input
                class={slider}
                type="range"
                min="0"
                max="50"
                step="5"
                bind:value={_extraScope}
                on:change={() => patchGeneral({ extraScopePct: _extraScope })}
            />
        </div>
        <div class={field.field}>
            <span class={field.label}>{t("settings.general.panelWidth", String(_panelWidth))}</span>
            <span class={field.description}>{t("settings.general.panelWidthDesc")}</span>
            <input
                class={slider}
                type="range"
                min="600"
                max="1600"
                step="50"
                bind:value={_panelWidth}
                on:change={() => patchGeneral({ panelWidth: _panelWidth })}
            />
        </div>
        <label class="rg-check-item">
            <input
                class={switchCls}
                type="checkbox"
                checked={config.general.countdownEnabled}
                on:change={(e) => patchGeneral({ countdownEnabled: checked(e) })}
            />
            {t("settings.general.countdown")}
        </label>
        {#if config.general.countdownEnabled}
            <div class={field.field}>
                <label class={field.label} for="rg-cd">{t("settings.general.countdownMinutes")}</label>
                <input
                    id="rg-cd"
                    class={cn(input, config.general.countdownMinutes <= 0 && "rg-input--invalid")}
                    type="number"
                    min="1"
                    value={config.general.countdownMinutes}
                    on:input={(e) => patchGeneral({ countdownMinutes: Math.max(0, vn(e)) })}
                />
                {#if config.general.countdownMinutes <= 0}
                    <span class={field.description} style="color:var(--b3-card-error)"
                        >{t("settings.general.countdownHint")}</span
                    >
                {/if}
            </div>
        {/if}
        <div class={field.field}>
            <label class={field.label} for="rg-loc">{t("settings.general.storageLocation")}</label>
            <select id="rg-loc" class={select} value={config.general.storageLocation} on:change={onStorageChange}>
                <option value="sibling">{t("settings.general.storageSibling")}</option>
                <option value="notebook">{t("settings.general.storageNotebook")}</option>
            </select>
        </div>
        {#if config.general.storageLocation === "notebook"}
            <div class={field.field}>
                <label class={field.label} for="rg-nb">{t("settings.general.notebookId")}</label>
                <input
                    id="rg-nb"
                    class={input}
                    type="text"
                    value={config.general.notebookId}
                    on:input={(e) => patchGeneral({ notebookId: v(e) })}
                />
            </div>
        {/if}
        <div class={field.field}>
            <label class={field.label} for="rg-lang">{t("settings.general.language")}</label>
            <select id="rg-lang" class={select} value={config.general.language} on:change={onLangChange}>
                <option value="zh">中文</option>
                <option value="en">English</option>
            </select>
        </div>
    </div>
</div>

<style>
    .rg-row-3 {
        display: flex;
        gap: 12px;
    }
    .rg-row-3 > * {
        flex: 1;
        min-width: 0;
    }
    .rg-checks {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
    }
    .rg-check-item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        cursor: pointer;
        color: var(--b3-theme-on-background);
    }
    :global(.rg-input--invalid) {
        border-color: var(--b3-card-error);
    }
    @media (max-width: 640px) {
        .rg-row-3 {
            flex-direction: column;
        }
    }
</style>
