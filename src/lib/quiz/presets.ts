import type { GeneralConfig, QuizPreset, RecallGenConfig } from "@/types/config";

/**
 * 试卷预设：把「题型 + 难度分布 + 超纲比例」存成具名组合，便于快速切换。
 * 纯函数实现，便于单测；不接触存储与界面。
 */

/** 预设名长度上限 */
export const MAX_PRESET_NAME = 24;

export function makePreset(name: string, general: GeneralConfig, id: string): QuizPreset {
    return {
        id,
        name: name.trim().slice(0, MAX_PRESET_NAME),
        allowedTypes: [...general.allowedTypes],
        difficulty: { ...general.difficulty },
        extraScopePct: general.extraScopePct,
    };
}

/**
 * 保存预设。同名时覆盖（保持原 id），避免出现多个同名预设难以区分。
 * 返回新的预设数组。
 */
export function savePreset(presets: QuizPreset[], preset: QuizPreset): QuizPreset[] {
    const existing = presets.find((item) => item.name === preset.name);
    if (existing) {
        return presets.map((item) => (item.name === preset.name ? { ...preset, id: existing.id } : item));
    }
    return [...presets, preset];
}

export function removePreset(presets: QuizPreset[], id: string): QuizPreset[] {
    return presets.filter((item) => item.id !== id);
}

/** 应用预设：只覆盖预设包含的字段，其余设置保持不变 */
export function applyPreset(config: RecallGenConfig, preset: QuizPreset): RecallGenConfig {
    return {
        ...config,
        general: {
            ...config.general,
            allowedTypes: [...preset.allowedTypes],
            difficulty: { ...preset.difficulty },
            extraScopePct: preset.extraScopePct,
        },
    };
}

/** 当前设置是否与某个预设一致（用于界面上标出正在使用的预设） */
export function matchesPreset(general: GeneralConfig, preset: QuizPreset): boolean {
    const sameTypes =
        general.allowedTypes.length === preset.allowedTypes.length &&
        [...general.allowedTypes].sort().join(",") === [...preset.allowedTypes].sort().join(",");
    const d = general.difficulty;
    return (
        sameTypes &&
        d.total === preset.difficulty.total &&
        d.easy === preset.difficulty.easy &&
        d.medium === preset.difficulty.medium &&
        d.hard === preset.difficulty.hard &&
        general.extraScopePct === preset.extraScopePct
    );
}
