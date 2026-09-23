import { describe, expect, it } from "vitest";
import { getDefaultConfig, type RecallGenConfig } from "@/types/config";
import { buildConfigExport, CONFIG_EXPORT_VERSION, mergeImportedConfig, parseConfigExport } from "./config-io";

const base = (): RecallGenConfig => {
    const config = getDefaultConfig();
    config.ai.endpoints = [
        {
            id: "ep-1",
            name: "本机端点",
            provider: "openai",
            protocol: "chat",
            baseUrl: "https://api.example.com/v1",
            apiKey: "sk-本机",
        },
    ];
    config.ai.models = [{ id: "m-1", name: "gpt-4o-mini", endpointId: "ep-1", temperature: 0.5, maxTokens: 4096 }];
    config.ai.roles = { generator: "m-1", reviewer: "m-1", grader: "m-1" };
    config.ai.testModelId = "m-1";
    config.prompts.generate = "本机出题提示词";
    config.general.difficulty = { total: 10, easy: 4, medium: 4, hard: 2 };
    return config;
};

describe("buildConfigExport", () => {
    it("默认剔除 API Key", () => {
        const file = parseConfigExport(buildConfigExport(base()));
        expect(file.config.ai.endpoints[0].apiKey).toBe("");
        expect(file.includesSecrets).toBe(false);
    });

    it("显式要求时包含 API Key", () => {
        const file = parseConfigExport(buildConfigExport(base(), true));
        expect(file.config.ai.endpoints[0].apiKey).toBe("sk-本机");
        expect(file.includesSecrets).toBe(true);
    });

    it("不修改传入的配置对象", () => {
        const config = base();
        buildConfigExport(config);
        expect(config.ai.endpoints[0].apiKey).toBe("sk-本机");
    });

    it("带有格式标识与版本号", () => {
        const file = parseConfigExport(buildConfigExport(base()));
        expect(file.app).toBe("recallgen");
        expect(file.version).toBe(CONFIG_EXPORT_VERSION);
        expect(typeof file.exportedAt).toBe("string");
    });
});

describe("parseConfigExport", () => {
    it("非 JSON 时给出可读错误", () => {
        expect(() => parseConfigExport("{不是 json")).toThrow(/合法 JSON/);
    });

    it("不是本插件的文件时拒绝", () => {
        expect(() => parseConfigExport('{"app":"other","config":{}}')).toThrow(/不是 RecallGen/);
    });

    it("版本高于当前支持时拒绝", () => {
        expect(() =>
            parseConfigExport(`{"app":"recallgen","version":${CONFIG_EXPORT_VERSION + 1},"config":{}}`)
        ).toThrow(/高于当前支持/);
    });

    it("缺少 config 字段时拒绝", () => {
        expect(() => parseConfigExport('{"app":"recallgen"}')).toThrow(/缺少 config/);
    });

    it("缺少版本号时按当前版本处理", () => {
        expect(parseConfigExport('{"app":"recallgen","config":{}}').version).toBe(CONFIG_EXPORT_VERSION);
    });
});

describe("mergeImportedConfig - 端点与模型", () => {
    it("导入端点和模型后覆盖原有的 AI 配置", () => {
        const exported = buildConfigExport(
            {
                ...base(),
                ai: {
                    ...base().ai,
                    endpoints: [
                        {
                            id: "ep-2",
                            name: "导入端点",
                            provider: "ollama",
                            protocol: "chat",
                            baseUrl: "http://localhost:11434",
                            apiKey: "",
                        },
                    ],
                    models: [{ id: "m-2", name: "qwen", endpointId: "ep-2", temperature: 0.2, maxTokens: 2048 }],
                    roles: { generator: "m-2", reviewer: "m-2", grader: "m-2" },
                    testModelId: "m-2",
                },
            },
            true
        );
        const { config, warnings } = mergeImportedConfig(base(), exported);
        expect(config.ai.endpoints[0].name).toBe("导入端点");
        expect(config.ai.models[0].name).toBe("qwen");
        expect(config.ai.roles.generator).toBe("m-2");
        expect(warnings).toEqual([]);
    });

    it("不含 Key 的文件导入时沿用本机同名端点的 Key", () => {
        const exported = buildConfigExport(base()); // 已剔除 Key
        const { config, warnings } = mergeImportedConfig(base(), exported);
        expect(config.ai.endpoints[0].apiKey).toBe("sk-本机");
        expect(warnings.some((w) => w.includes("沿用本机已有的 API Key"))).toBe(true);
    });

    it("缺少 id 的端点被跳过并给出警告", () => {
        const text = JSON.stringify({
            app: "recallgen",
            version: 1,
            includesSecrets: true,
            config: { ai: { endpoints: [{ name: "没有 id" }], models: [] } },
        });
        const { config, warnings } = mergeImportedConfig(base(), text);
        expect(config.ai.endpoints[0].id).toBe("ep-1"); // 保留原有
        expect(warnings.some((w) => w.includes("缺少 id"))).toBe(true);
    });

    it("引用不存在端点的模型被跳过", () => {
        const text = JSON.stringify({
            app: "recallgen",
            version: 1,
            includesSecrets: true,
            config: {
                ai: {
                    endpoints: [{ id: "ep-9", name: "只有端点", baseUrl: "https://x" }],
                    models: [{ id: "m-9", name: "孤儿模型", endpointId: "ep-不存在" }],
                },
            },
        });
        const { config, warnings } = mergeImportedConfig(base(), text);
        expect(config.ai.models.map((m) => m.id)).toEqual(["m-1"]); // 保留原有模型
        expect(warnings.some((w) => w.includes("引用的端点不存在"))).toBe(true);
    });

    it("角色指向不存在的模型时回落到可用模型并警告", () => {
        const text = JSON.stringify({
            app: "recallgen",
            version: 1,
            includesSecrets: true,
            config: {
                ai: {
                    endpoints: [{ id: "ep-1", name: "端点", baseUrl: "https://x" }],
                    models: [{ id: "m-new", name: "模型", endpointId: "ep-1" }],
                    roles: { generator: "m-消失", reviewer: "m-消失", grader: "m-消失" },
                    testModelId: "m-消失",
                },
            },
        });
        const { config, warnings } = mergeImportedConfig(base(), text);
        expect(config.ai.roles.generator).toBe("m-new");
        expect(config.ai.testModelId).toBe("m-new");
        expect(warnings.filter((w) => w.includes("回落到"))).toHaveLength(3);
    });

    it("温度与 MaxTokens 收敛到合法区间", () => {
        const text = JSON.stringify({
            app: "recallgen",
            version: 1,
            includesSecrets: true,
            config: {
                ai: {
                    endpoints: [{ id: "ep-1", name: "端点", baseUrl: "https://x" }],
                    models: [{ id: "m-1", name: "模型", endpointId: "ep-1", temperature: 9, maxTokens: 1 }],
                },
            },
        });
        const { config } = mergeImportedConfig(base(), text);
        expect(config.ai.models[0].temperature).toBe(2);
        expect(config.ai.models[0].maxTokens).toBe(256);
    });

    it("未知协议回落到 chat", () => {
        const text = JSON.stringify({
            app: "recallgen",
            version: 1,
            includesSecrets: true,
            config: {
                ai: {
                    endpoints: [{ id: "ep-1", name: "端点", protocol: "乱写" }],
                    models: [{ id: "m-1", endpointId: "ep-1" }],
                },
            },
        });
        expect(mergeImportedConfig(base(), text).config.ai.endpoints[0].protocol).toBe("chat");
    });
});

describe("mergeImportedConfig - 提示词与通用设置", () => {
    it("只导入提示词时不影响 AI 配置", () => {
        const text = JSON.stringify({
            app: "recallgen",
            version: 1,
            config: { prompts: { analysis: "导入的分析提示词" } },
        });
        const { config } = mergeImportedConfig(base(), text);
        expect(config.prompts.analysis).toBe("导入的分析提示词");
        expect(config.prompts.generate).toBe("本机出题提示词");
        expect(config.ai.endpoints[0].id).toBe("ep-1");
    });

    it("空提示词被忽略并警告", () => {
        const text = JSON.stringify({ app: "recallgen", version: 1, config: { prompts: { generate: "   " } } });
        const { config, warnings } = mergeImportedConfig(base(), text);
        expect(config.prompts.generate).toBe("本机出题提示词");
        expect(warnings.some((w) => w.includes("为空"))).toBe(true);
    });

    it("难度分布被收敛到合法范围", () => {
        const text = JSON.stringify({
            app: "recallgen",
            version: 1,
            config: { general: { difficulty: { total: 999, easy: -3, medium: 4, hard: 4 } } },
        });
        const { config } = mergeImportedConfig(base(), text);
        expect(config.general.difficulty).toEqual({ total: 50, easy: 0, medium: 4, hard: 4 });
    });

    it("无效题型被过滤，全无效时保留原有", () => {
        const partial = JSON.stringify({
            app: "recallgen",
            version: 1,
            config: { general: { allowedTypes: ["coding", "不存在的题型"] } },
        });
        expect(mergeImportedConfig(base(), partial).config.general.allowedTypes).toEqual(["coding"]);

        const invalid = JSON.stringify({
            app: "recallgen",
            version: 1,
            config: { general: { allowedTypes: ["乱写"] } },
        });
        const { config, warnings } = mergeImportedConfig(base(), invalid);
        expect(config.general.allowedTypes).toHaveLength(6);
        expect(warnings.some((w) => w.includes("题型列表"))).toBe(true);
    });

    it("面板宽度被收敛到 600-1600", () => {
        const text = JSON.stringify({ app: "recallgen", version: 1, config: { general: { panelWidth: 99 } } });
        expect(mergeImportedConfig(base(), text).config.general.panelWidth).toBe(600);
    });

    it("无效的存储位置被忽略", () => {
        const text = JSON.stringify({ app: "recallgen", version: 1, config: { general: { storageLocation: "乱写" } } });
        expect(mergeImportedConfig(base(), text).config.general.storageLocation).toBe("sibling");
    });

    it("配色区间被规范化，非法区间保留原有", () => {
        const valid = JSON.stringify({
            app: "recallgen",
            version: 1,
            config: { heatmap: { ranges: [{ min: -5, max: 200, color: "#000" }] } },
        });
        expect(mergeImportedConfig(base(), valid).config.heatmap.ranges[0]).toEqual({
            min: 0,
            max: 100,
            color: "#000",
        });

        const invalid = JSON.stringify({ app: "recallgen", version: 1, config: { heatmap: { ranges: [{ min: 1 }] } } });
        const { config, warnings } = mergeImportedConfig(base(), invalid);
        expect(config.heatmap.ranges.length).toBeGreaterThan(0);
        expect(warnings.some((w) => w.includes("配色区间"))).toBe(true);
    });

    it("往返导出导入后配置保持一致", () => {
        const original = base();
        const { config } = mergeImportedConfig(getDefaultConfig(), buildConfigExport(original, true));
        expect(config.prompts).toEqual(original.prompts);
        expect(config.general.difficulty).toEqual(original.general.difficulty);
        expect(config.ai.endpoints).toEqual(original.ai.endpoints);
        expect(config.ai.models).toEqual(original.ai.models);
    });
});

describe("数值与整数收敛的区分", () => {
    it("温度保留小数，不被取整（回归）", () => {
        const text = JSON.stringify({
            app: "recallgen",
            version: 1,
            config: {
                ai: {
                    endpoints: [{ id: "ep-1", name: "端点", baseUrl: "https://x" }],
                    models: [{ id: "m-1", name: "模型", endpointId: "ep-1", temperature: 0.35, maxTokens: 4096 }],
                },
            },
        });
        const { config } = mergeImportedConfig(base(), text);
        expect(config.ai.models[0].temperature).toBe(0.35);
    });

    it("token 数与宽度等字段仍取整", () => {
        const text = JSON.stringify({
            app: "recallgen",
            version: 1,
            config: {
                ai: {
                    endpoints: [{ id: "ep-1", name: "端点", baseUrl: "https://x" }],
                    models: [{ id: "m-1", name: "模型", endpointId: "ep-1", maxTokens: 4096.7 }],
                },
                general: { panelWidth: 1100.6 },
            },
        });
        const { config } = mergeImportedConfig(base(), text);
        expect(config.ai.models[0].maxTokens).toBe(4097);
        expect(config.general.panelWidth).toBe(1101);
    });
});
