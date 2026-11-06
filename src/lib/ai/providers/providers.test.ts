import { describe, expect, it } from "vitest";
import zh from "../../../../public/i18n/zh-CN.json";
import en from "../../../../public/i18n/en.json";
import { getDefaultConfig, type AIConfig } from "@/types/config";
import { PROVIDER_PRESETS, SNAPSHOT_APIS, SNAPSHOT_CATALOG, newerCatalog, presetById, presetModels } from "./catalog";
import { connectPreset, connectedPreset, modelProblem, presetEndpointId } from "./connect";
import {
    MODELS_DEV_SOURCES,
    defaultModelConfig,
    modelsFromCatalog,
    pickDefaultModel,
    trimModel,
    type CatalogModel,
} from "./models";
import { catalogFromApi, normalizeCachedCatalog } from "./refresh";

const model = (id: string, over: Partial<CatalogModel> = {}): CatalogModel => ({
    id,
    name: id,
    release: "2026-01-01",
    updated: "",
    reasoning: false,
    toolCall: true,
    temperature: true,
    textOut: true,
    context: 128_000,
    output: 8192,
    status: "",
    ...over,
});

describe("服务商目录", () => {
    it("你点名的 9 家都在，id 唯一", () => {
        const ids = PROVIDER_PRESETS.map((p) => p.id);
        expect(ids).toEqual(["deepseek", "zhipu", "hunyuan", "qwen", "kimi", "xiaomi", "huawei", "wenxin", "doubao"]);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("每家都有 https 的接口与申请 Key 地址、图标和中英两份名称简介", () => {
        const dicts = [zh as Record<string, string>, en as Record<string, string>];
        for (const preset of PROVIDER_PRESETS) {
            expect(preset.baseUrl, preset.id).toMatch(/^https:\/\//);
            expect(preset.keyUrl, preset.id).toMatch(/^https:\/\//);
            expect(preset.icon, preset.id).toBeTruthy();
            for (const dict of dicts) {
                expect(dict[`provider.${preset.id}.name`], `${preset.id} 名称`).toBeTruthy();
                expect(dict[`provider.${preset.id}.desc`], `${preset.id} 简介`).toBeTruthy();
            }
        }
    });

    it("models.dev 收录的几家：快照里有模型，且目录的 baseUrl 与 models.dev 记录一致（不一致说明该核对了）", () => {
        for (const preset of PROVIDER_PRESETS.filter((p) => MODELS_DEV_SOURCES[p.id])) {
            expect(SNAPSHOT_CATALOG.models[preset.id]?.length ?? 0, preset.id).toBeGreaterThan(0);
            expect(preset.baseUrl, preset.id).toBe(SNAPSHOT_APIS[preset.id]);
        }
    });

    it("models.dev 没收录的两家：文心有内置模型；华为只给接口地址，模型名由用户按控制台填写", () => {
        expect(presetModels(presetById("wenxin")!).map((m) => m.id)).toEqual(["ernie-5.1"]);
        expect(presetModels(presetById("huawei")!)).toEqual([]);
    });

    it("每家能选出默认模型，豆包与千问不会选到同平台上的别家模型", () => {
        for (const preset of PROVIDER_PRESETS.filter((p) => p.id !== "huawei")) {
            expect(pickDefaultModel(presetModels(preset)), preset.id).not.toBeNull();
        }
        expect(pickDefaultModel(presetModels(presetById("doubao")!))?.id).toMatch(/^doubao/);
        expect(pickDefaultModel(presetModels(presetById("qwen")!))?.id).toMatch(/^qwen/);
    });

    it("缓存比快照新才用缓存", () => {
        const older = { fetchedAt: "2000-01-01T00:00:00.000Z", models: {} };
        const newer = { fetchedAt: "2999-01-01T00:00:00.000Z", models: {} };
        expect(newerCatalog(null)).toBe(SNAPSHOT_CATALOG);
        expect(newerCatalog(older)).toBe(SNAPSHOT_CATALOG);
        expect(newerCatalog(newer)).toBe(newer);
    });
});

describe("裁剪与默认模型", () => {
    it("只留白名单字段；输出不是纯文本的标出来；temperature:false 保留下来", () => {
        const trimmed = trimModel({
            id: "kimi-k3",
            name: "Kimi K3",
            release_date: "2026-07-16",
            temperature: false,
            tool_call: true,
            modalities: { input: ["text", "image"], output: ["text"] },
            limit: { context: 1_048_576, output: 1_048_576 },
            cost: { input: 1 },
            interleaved: true,
        });
        expect(trimmed).toEqual({
            id: "kimi-k3",
            name: "Kimi K3",
            release: "2026-07-16",
            updated: "",
            reasoning: false,
            toolCall: true,
            temperature: false,
            textOut: true,
            context: 1_048_576,
            output: 1_048_576,
            status: "",
        });
        expect(trimModel({ id: "img", modalities: { output: ["image"] } })?.textOut).toBe(false);
        expect(trimModel({ name: "没有 id" })).toBeNull();
    });

    it("同一服务商下按前缀只取自家模型，去掉已弃用的，新的在前", () => {
        const api = {
            volcengine: {
                models: {
                    a: { id: "glm-5-3", release_date: "2026-08-26" },
                    b: { id: "doubao-seed-2-1-pro", release_date: "2026-06-23" },
                    c: { id: "doubao-seed-2-0-pro", release_date: "2026-02-14", status: "deprecated" },
                    d: { id: "doubao-seed-1-6", release_date: "2025-10-01" },
                },
            },
        };
        const ids = modelsFromCatalog(api, { provider: "volcengine", idPrefix: "doubao" }).map((m) => m.id);
        expect(ids).toEqual(["doubao-seed-2-1-pro", "doubao-seed-1-6"]);
    });

    it("默认选最新的；跳过专用模型与不支持工具调用的；同一天发布按 id 取第一个", () => {
        const list = [
            model("qwen3.8-omni-flash", { release: "2026-09-17" }),
            model("qwen3.8-flash", { release: "2026-08-26" }),
            model("qwen3.8-max", { release: "2026-08-03" }),
            model("qwen-embed", { release: "2026-10-01" }),
            model("no-tools", { release: "2026-12-01", toolCall: false }),
        ];
        expect(pickDefaultModel(list)?.id).toBe("qwen3.8-flash");
        expect(
            pickDefaultModel([
                model("kimi-k3.1-pro-highspeed", { release: "2026-10-23" }),
                model("kimi-k3.1-pro", { release: "2026-10-23" }),
            ])?.id
        ).toBe("kimi-k3.1-pro");
        // 一个都不支持工具调用时，退回在全部可用模型里挑
        expect(pickDefaultModel([model("ernie-5.1", { toolCall: false })])?.id).toBe("ernie-5.1");
        expect(pickDefaultModel([])).toBeNull();
    });

    it("maxTokens 取输出上限与 32768 的较小值，拿不到上限时 16384；不接受温度的模型标出来", () => {
        expect(defaultModelConfig(model("a", { output: 393_216 })).maxTokens).toBe(32_768);
        expect(defaultModelConfig(model("b", { output: 8192 })).maxTokens).toBe(8192);
        expect(defaultModelConfig(model("c", { output: 0 })).maxTokens).toBe(16_384);
        expect(defaultModelConfig(null)).toEqual({ temperature: 0.7, maxTokens: 16_384, fixedTemperature: false });
        expect(defaultModelConfig(model("kimi", { temperature: false })).fixedTemperature).toBe(true);
    });

    it("刷新：整份 models.dev 数据裁剪成目录；没有可用模型时报错；缓存文件逐项校验", () => {
        const api = { deepseek: { models: { x: { id: "deepseek-flash", release_date: "2026-10-17" } } } };
        const catalog = catalogFromApi(api, "2026-11-05T00:00:00.000Z");
        expect(catalog.models.deepseek.map((m) => m.id)).toEqual(["deepseek-flash"]);
        expect(() => catalogFromApi({ unrelated: {} }, "x")).toThrow();
        expect(normalizeCachedCatalog(catalog)).toEqual(catalog);
        expect(normalizeCachedCatalog({ fetchedAt: 1, models: {} })).toBeNull();
        expect(
            normalizeCachedCatalog({ fetchedAt: "x", models: { unknown: [{ id: "a" }], deepseek: [{ nope: 1 }] } })
        ).toBeNull();
    });
});

describe("快速接入", () => {
    const deepseek = presetById("deepseek")!;
    const input = (over: Partial<Parameters<typeof connectPreset>[1]> = {}) => ({
        preset: deepseek,
        name: "DeepSeek",
        apiKey: " key-1 ",
        models: [model("deepseek-flash", { output: 393_216 }), model("deepseek-v4-pro")],
        defaultModel: "deepseek-flash",
        makeDefault: false,
        ...over,
    });

    it("默认配置里的角色指向没填 Key 的端点：接入后出题、审题、判分与测试模型都改指向默认模型", () => {
        const before = getDefaultConfig().ai;
        expect(modelProblem(before, before.roles.generator)).toBe("noApiKey");
        const after = connectPreset(before, input());
        const endpoint = after.endpoints.find((e) => e.id === presetEndpointId("deepseek"))!;
        expect(endpoint).toMatchObject({ apiKey: "key-1", presetId: "deepseek", baseUrl: "https://api.deepseek.com" });
        const flash = after.models.find((m) => m.name === "deepseek-flash")!;
        expect(flash).toMatchObject({ endpointId: endpoint.id, maxTokens: 32_768, temperature: 0.7 });
        expect(after.roles).toEqual({ generator: flash.id, reviewer: flash.id, grader: flash.id });
        expect(after.testModelId).toBe(flash.id);
        expect(modelProblem(after, after.roles.generator)).toBeNull();
        expect(connectedPreset(after, "deepseek")).toBeTruthy();
        // 原有端点与模型都还在，只是不再被角色引用
        expect(after.endpoints).toHaveLength(before.endpoints.length + 1);
    });

    it("角色本来就能用时不动，勾选「设为默认」才改；没配审题的不替用户打开", () => {
        const base = connectPreset(getDefaultConfig().ai, input());
        const working: AIConfig = { ...base, roles: { ...base.roles, reviewer: "" } };
        const kimi = presetById("kimi")!;
        const kept = connectPreset(
            working,
            input({ preset: kimi, name: "Kimi", models: [model("kimi-k3")], defaultModel: "kimi-k3" })
        );
        expect(kept.roles.generator).toBe(working.roles.generator);
        expect(kept.roles.reviewer).toBe("");
        const forced = connectPreset(working, {
            ...input({
                preset: kimi,
                name: "Kimi",
                models: [model("kimi-k3", { temperature: false })],
                defaultModel: "kimi-k3",
            }),
            makeDefault: true,
        });
        const k3 = forced.models.find((m) => m.name === "kimi-k3")!;
        expect(forced.roles).toEqual({ generator: k3.id, reviewer: k3.id, grader: k3.id });
        expect(k3.fixedTemperature).toBe(true);
    });

    it("重复接入是更新：不新建端点，调过参数的模型保留，取消勾选且没被引用的删掉", () => {
        const first = connectPreset(getDefaultConfig().ai, input());
        const tuned: AIConfig = {
            ...first,
            models: first.models.map((m) => (m.name === "deepseek-flash" ? { ...m, temperature: 0.2 } : m)),
        };
        const again = connectPreset(tuned, input({ apiKey: "key-2", models: [model("deepseek-flash")] }));
        expect(again.endpoints.filter((e) => e.id === presetEndpointId("deepseek"))).toHaveLength(1);
        expect(again.endpoints.find((e) => e.id === presetEndpointId("deepseek"))?.apiKey).toBe("key-2");
        const own = again.models.filter((m) => m.endpointId === presetEndpointId("deepseek"));
        expect(own.map((m) => m.name)).toEqual(["deepseek-flash"]);
        expect(own[0].temperature).toBe(0.2);
    });

    it("被角色引用的模型取消勾选也不删，免得角色指向不存在的模型", () => {
        const first = connectPreset(getDefaultConfig().ai, input({ defaultModel: "deepseek-v4-pro" }));
        const again = connectPreset(
            first,
            input({ models: [model("deepseek-flash")], defaultModel: "deepseek-flash" })
        );
        expect(again.models.some((m) => m.name === "deepseek-v4-pro")).toBe(true);
    });
});
