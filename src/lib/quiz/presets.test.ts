import { describe, expect, it } from "vitest";
import { MAX_PRESET_NAME, applyPreset, makePreset, matchesPreset, removePreset, savePreset } from "./presets";
import { getDefaultConfig, type GeneralConfig, type QuizPreset, type RecallGenConfig } from "@/types/config";
import type { QuestionType } from "@/types/quiz";

function general(patch: Partial<GeneralConfig> = {}): GeneralConfig {
    return { ...getDefaultConfig().general, ...patch };
}

function config(patch: Partial<GeneralConfig> = {}): RecallGenConfig {
    const base = getDefaultConfig();
    return { ...base, general: { ...base.general, ...patch } };
}

describe("makePreset", () => {
    it("截取当前题型、难度与超纲比例", () => {
        const g = general({
            allowedTypes: ["single_choice", "coding"],
            difficulty: { total: 12, easy: 4, medium: 5, hard: 3 },
            extraScopePct: 15,
        });
        const preset = makePreset("冲刺", g, "p1");
        expect(preset).toEqual({
            id: "p1",
            name: "冲刺",
            allowedTypes: ["single_choice", "coding"],
            difficulty: { total: 12, easy: 4, medium: 5, hard: 3 },
            extraScopePct: 15,
        });
    });

    it("去掉首尾空白并截断到长度上限", () => {
        const preset = makePreset(`  ${"长".repeat(40)}  `, general(), "p1");
        expect(preset.name).toHaveLength(MAX_PRESET_NAME);
    });

    it("与配置解耦：修改配置不会影响已保存的预设", () => {
        const g = general({ allowedTypes: ["single_choice"] });
        const preset = makePreset("a", g, "p1");
        g.allowedTypes.push("coding");
        g.difficulty.total = 99;
        expect(preset.allowedTypes).toEqual(["single_choice"]);
        expect(preset.difficulty.total).not.toBe(99);
    });
});

describe("savePreset", () => {
    it("追加新预设", () => {
        const a: QuizPreset = {
            id: "a",
            name: "A",
            allowedTypes: [],
            difficulty: { total: 1, easy: 1, medium: 0, hard: 0 },
            extraScopePct: 0,
        };
        const b: QuizPreset = { ...a, id: "b", name: "B" };
        expect(savePreset([a], b)).toEqual([a, b]);
    });

    it("同名覆盖并保留原有 id", () => {
        const a: QuizPreset = {
            id: "a",
            name: "A",
            allowedTypes: ["coding"],
            difficulty: { total: 1, easy: 1, medium: 0, hard: 0 },
            extraScopePct: 0,
        };
        const incoming: QuizPreset = { ...a, id: "new", allowedTypes: ["subjective"] };
        const result = savePreset([a], incoming);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("a");
        expect(result[0].allowedTypes).toEqual(["subjective"]);
    });

    it("不修改传入数组", () => {
        const list: QuizPreset[] = [];
        savePreset(list, {
            id: "a",
            name: "A",
            allowedTypes: [],
            difficulty: { total: 1, easy: 1, medium: 0, hard: 0 },
            extraScopePct: 0,
        });
        expect(list).toHaveLength(0);
    });
});

describe("removePreset", () => {
    it("按 id 删除", () => {
        const a = {
            id: "a",
            name: "A",
            allowedTypes: [],
            difficulty: { total: 1, easy: 1, medium: 0, hard: 0 },
            extraScopePct: 0,
        };
        const b = { ...a, id: "b", name: "B" };
        expect(removePreset([a, b], "a")).toEqual([b]);
        expect(removePreset([a, b], "missing")).toEqual([a, b]);
    });
});

describe("applyPreset", () => {
    it("只覆盖预设包含的字段", () => {
        const base = config({ panelWidth: 1234, countdownEnabled: true });
        const preset: QuizPreset = {
            id: "p",
            name: "P",
            allowedTypes: ["true_false"],
            difficulty: { total: 5, easy: 1, medium: 2, hard: 2 },
            extraScopePct: 20,
        };
        const next = applyPreset(base, preset);
        expect(next.general.allowedTypes).toEqual(["true_false"]);
        expect(next.general.difficulty).toEqual({ total: 5, easy: 1, medium: 2, hard: 2 });
        expect(next.general.extraScopePct).toBe(20);
        expect(next.general.panelWidth).toBe(1234);
        expect(next.general.countdownEnabled).toBe(true);
        expect(next).not.toBe(base);
        expect(base.general.allowedTypes).not.toEqual(["true_false"]);
    });
});

describe("matchesPreset", () => {
    const preset: QuizPreset = {
        id: "p",
        name: "P",
        allowedTypes: ["single_choice", "coding"],
        difficulty: { total: 10, easy: 3, medium: 4, hard: 3 },
        extraScopePct: 10,
    };

    it("题型顺序无关", () => {
        expect(
            matchesPreset(
                general({
                    allowedTypes: ["coding", "single_choice"],
                    difficulty: { ...preset.difficulty },
                    extraScopePct: 10,
                }),
                preset
            )
        ).toBe(true);
    });

    it("题型集合不同则不匹配", () => {
        expect(
            matchesPreset(
                general({
                    allowedTypes: ["single_choice"],
                    difficulty: { ...preset.difficulty },
                    extraScopePct: 10,
                }),
                preset
            )
        ).toBe(false);
    });

    it("难度或超纲比例不同则不匹配", () => {
        const types: QuestionType[] = ["single_choice", "coding"];
        expect(
            matchesPreset(
                general({ allowedTypes: types, difficulty: { ...preset.difficulty, hard: 4 }, extraScopePct: 10 }),
                preset
            )
        ).toBe(false);
        expect(
            matchesPreset(
                general({ allowedTypes: types, difficulty: { ...preset.difficulty }, extraScopePct: 12 }),
                preset
            )
        ).toBe(false);
    });
});
