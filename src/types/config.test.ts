import { describe, expect, it } from "vitest";
import { DEFAULT_HEATMAP, getDefaultConfig } from "./config";

describe("getDefaultConfig", () => {
    it("返回结构完整的默认配置", () => {
        const cfg = getDefaultConfig();
        expect(cfg.ai.endpoints.length).toBeGreaterThan(0);
        expect(cfg.general.allowedTypes).toHaveLength(6);
        expect(cfg.general.difficulty).toEqual({ total: 15, easy: 6, medium: 6, hard: 3 });
        expect(cfg.heatmap.ranges.length).toBe(DEFAULT_HEATMAP.ranges.length);
    });

    it("深拷贝 heatmap.ranges / difficulty / endpoints / models，修改返回值不污染默认常量", () => {
        const a = getDefaultConfig();
        a.heatmap.ranges[0].color = "#000000";
        a.general.difficulty.total = 99;
        a.ai.endpoints[0].name = "改过了";
        a.ai.models[0].name = "改过了";
        a.general.allowedTypes.push("coding");

        const b = getDefaultConfig();
        expect(b.heatmap.ranges[0].color).toBe(DEFAULT_HEATMAP.ranges[0].color);
        expect(b.general.difficulty.total).toBe(15);
        expect(b.ai.endpoints[0].name).not.toBe("改过了");
        expect(b.ai.models[0].name).not.toBe("改过了");
    });

    it("难度分布各档之和等于总数", () => {
        const { difficulty } = getDefaultConfig().general;
        expect(difficulty.easy + difficulty.medium + difficulty.hard).toBe(difficulty.total);
    });

    it("深拷贝 general.allowedTypes（回归：曾与默认常量共享同一数组引用）", () => {
        const a = getDefaultConfig();
        a.general.allowedTypes.push("coding");
        expect(getDefaultConfig().general.allowedTypes).toHaveLength(6);
    });
});
