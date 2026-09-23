import { describe, expect, it } from "vitest";
import { DEFAULT_HEATMAP, getDefaultConfig, migrateAIConfig } from "./config";

describe("migrateAIConfig", () => {
    it("空输入时返回带默认端点与模型的配置", () => {
        const ai = migrateAIConfig(undefined);
        expect(ai.endpoints).toHaveLength(1);
        expect(ai.models).toHaveLength(1);
        expect(ai.roles).toEqual({ generator: "m-default", reviewer: "m-default", grader: "m-default" });
        expect(ai.timeout).toBe(120000);
    });

    it("已是新格式时保留端点与模型，仅补齐缺失字段", () => {
        const ai = migrateAIConfig({
            endpoints: [
                { id: "ep-1", name: "自定义", provider: "ollama", protocol: "chat", baseUrl: "http://x", apiKey: "" },
            ],
            models: [{ id: "m-1", name: "qwen", endpointId: "ep-1", temperature: 0.2, maxTokens: 2048 }],
            roles: { generator: "m-1", reviewer: "m-1", grader: "m-1" },
        });
        expect(ai.endpoints[0].name).toBe("自定义");
        expect(ai.models[0].name).toBe("qwen");
        expect(ai.roles.generator).toBe("m-1");
        // 未提供的字段用默认值补齐
        expect(ai.jsonSchemaEnabled).toBe(true);
        expect(ai.testModelId).toBe("m-default");
    });

    it("端点数组为空时退化为旧格式迁移分支", () => {
        const ai = migrateAIConfig({ endpoints: [], baseUrl: "http://legacy", apiKey: "k" } as never);
        expect(ai.endpoints).toHaveLength(1);
        expect(ai.endpoints[0].baseUrl).toBe("http://legacy");
        expect(ai.endpoints[0].apiKey).toBe("k");
        expect(ai.models[0].endpointId).toBe(ai.endpoints[0].id);
    });

    it("迁移旧版单端点扁平配置", () => {
        const ai = migrateAIConfig({
            provider: "ollama",
            protocol: "messages",
            baseUrl: "http://ollama:11434",
            apiKey: "secret",
            model: "llama3",
            temperature: 0.3,
            maxTokens: 8192,
            timeout: 30000,
        } as never);
        expect(ai.endpoints[0]).toMatchObject({
            provider: "ollama",
            protocol: "messages",
            baseUrl: "http://ollama:11434",
            apiKey: "secret",
        });
        expect(ai.models[0]).toMatchObject({ name: "llama3", temperature: 0.3, maxTokens: 8192 });
        expect(ai.roles.generator).toBe(ai.models[0].id);
        expect(ai.timeout).toBe(30000);
    });
});

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

    // ── 已确认缺陷，修复后把 it.fails 改回 it ────────────────────────────
    it.fails("深拷贝 general.allowedTypes（缺陷：与默认常量共享同一数组引用）", () => {
        const a = getDefaultConfig();
        a.general.allowedTypes.push("coding");
        expect(getDefaultConfig().general.allowedTypes).toHaveLength(6);
    });
});
