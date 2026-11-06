import { describe, expect, it, vi } from "vitest";
import { SNAPSHOT_CATALOG } from "./catalog";
import {
    defaultPick,
    detectEndpointModels,
    parseModelList,
    rankDetected,
    specsFor,
    specsFromApi,
    specsFromCatalog,
} from "./detect";

const raw = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    name: id,
    release_date: "2026-01-01",
    tool_call: true,
    limit: { context: 128_000, output: 8192 },
    ...over,
});

describe("parseModelList：各家 /models 的返回形状", () => {
    it("OpenAI / Anthropic 兼容的 data 数组", () => {
        expect(parseModelList(JSON.stringify({ data: [{ id: "gpt-4o" }, { id: "claude-sonnet-4-5" }] }))).toEqual([
            "gpt-4o",
            "claude-sonnet-4-5",
        ]);
    });

    it("裸数组、Ollama 的 models[].name；去掉 Gemini 的 models/ 前缀并去重", () => {
        expect(parseModelList(JSON.stringify(["a", { id: "b" }]))).toEqual(["a", "b"]);
        expect(parseModelList(JSON.stringify({ models: [{ name: "qwen3:8b" }, { model: "llama3" }] }))).toEqual([
            "qwen3:8b",
            "llama3",
        ]);
        expect(
            parseModelList(JSON.stringify({ data: [{ id: "models/gemini-2.5-pro" }, { id: "gemini-2.5-pro" }] }))
        ).toEqual(["gemini-2.5-pro"]);
    });

    it("错误页、空值、没有列表时返回空数组", () => {
        expect(parseModelList("<html>502</html>")).toEqual([]);
        expect(parseModelList("null")).toEqual([]);
        expect(parseModelList(JSON.stringify({ error: { message: "x" } }))).toEqual([]);
    });
});

describe("specsFor：从 models.dev 找模型参数", () => {
    it("按 id 匹配，带前缀和不带前缀的写法都认", () => {
        const specs = specsFromApi({ deepseek: { models: { "deepseek-v4-pro": raw("deepseek-v4-pro") } } });
        const found = specsFor(["deepseek-v4-pro", "deepseek/deepseek-v4-pro", "unknown-model"], specs, "");
        expect(found.get("deepseek-v4-pro")?.output).toBe(8192);
        expect(found.get("deepseek/deepseek-v4-pro")?.output).toBe(8192);
        expect(found.get("unknown-model")).toBeUndefined();
    });

    it("端点的域名与某家服务商相同时优先用那家的数据", () => {
        const api = {
            gateway: { api: "https://gw.example.com/v1", models: { m: raw("m", { limit: { output: 4096 } }) } },
            origin: { api: "https://api.origin.com/v1", models: { m: raw("m", { limit: { output: 65_536 } }) } },
        };
        const specs = specsFromApi(api);
        expect(specsFor(["m"], specs, "https://api.origin.com/v1").get("m")?.output).toBe(65_536);
        expect(specsFor(["m"], specs, "https://gw.example.com/v1").get("m")?.output).toBe(4096);
    });

    it("没有同域名的服务商时，多家共有的模型取多数一致的输出上限，平票取较小值", () => {
        const api = {
            a: { models: { m: raw("m", { limit: { output: 16_384 } }), n: raw("n", { limit: { output: 1000 } }) } },
            b: { models: { m: raw("m", { limit: { output: 16_384 } }), n: raw("n", { limit: { output: 2000 } }) } },
            c: { models: { m: raw("m", { limit: { output: 16_000 } }) } },
        };
        const found = specsFor(["m", "n"], specsFromApi(api), "https://other.example.com");
        expect(found.get("m")?.output).toBe(16_384);
        expect(found.get("n")?.output).toBe(1000);
    });

    it("models.dev 拉不到时用随插件发布的快照兜底", () => {
        const found = specsFor(["kimi-k3", "deepseek-v4-pro"], specsFromCatalog(SNAPSHOT_CATALOG), "");
        expect(found.get("kimi-k3")?.temperature).toBe(false);
        expect(found.get("deepseek-v4-pro")?.output).toBeGreaterThan(0);
    });
});

describe("排序与默认勾选", () => {
    const specs = specsFromApi({
        p: {
            models: {
                old: raw("old", { release_date: "2025-01-01" }),
                fresh: raw("fresh", { release_date: "2026-06-01" }),
                "text-embedding-x": raw("text-embedding-x", { release_date: "2026-09-01" }),
                "no-tools": raw("no-tools", { release_date: "2026-08-01", tool_call: false }),
            },
        },
    });
    const ids = ["zzz-local", "old", "text-embedding-x", "fresh", "no-tools", "aaa-local"];
    const found = specsFor(ids, specs, "");
    const detected = ids.map((id) => ({ id, info: found.get(id) ?? null }));

    it("能出题的已知模型按新到旧排前面，其余按名称", () => {
        expect(rankDetected(detected).map((m) => m.id)).toEqual([
            "no-tools",
            "fresh",
            "old",
            "aaa-local",
            "text-embedding-x",
            "zzz-local",
        ]);
    });

    it("默认勾选：支持工具调用的最新模型；都不认识时不勾", () => {
        expect(defaultPick(detected)).toBe("fresh");
        expect(defaultPick([{ id: "x", info: null }])).toBeNull();
    });
});

describe("detectEndpointModels", () => {
    const endpoint = {
        provider: "openai",
        protocol: "chat",
        baseUrl: "https://api.origin.com/v1",
        apiKey: "key-1",
    } as const;
    const api = { origin: { api: "https://api.origin.com/v1", models: { m1: raw("m1") } } };

    it("列出端点的模型并用 models.dev 补参数", async () => {
        const result = await detectEndpointModels(endpoint, {
            listRaw: async () => JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }),
            fetchApi: async () => api,
            fallbackCatalog: async () => SNAPSHOT_CATALOG,
        });
        expect(result.specsFrom).toBe("models.dev");
        expect(result.models.find((m) => m.id === "m1")?.info?.output).toBe(8192);
        expect(result.models.find((m) => m.id === "m2")?.info).toBeNull();
    });

    it("models.dev 不可达时退回快照；端点返回空列表时报错且不去拉 models.dev", async () => {
        const fallback = await detectEndpointModels(endpoint, {
            listRaw: async () => JSON.stringify({ data: [{ id: "kimi-k3" }] }),
            fetchApi: async () => {
                throw new Error("offline");
            },
            fallbackCatalog: async () => SNAPSHOT_CATALOG,
        });
        expect(fallback.specsFrom).toBe("snapshot");
        expect(fallback.models[0].info?.temperature).toBe(false);

        const fetchApi = vi.fn(async () => api);
        await expect(
            detectEndpointModels(endpoint, {
                listRaw: async () => JSON.stringify({ data: [] }),
                fetchApi,
                fallbackCatalog: async () => SNAPSHOT_CATALOG,
            })
        ).rejects.toThrow("端点没有返回任何模型");
        expect(fetchApi).not.toHaveBeenCalled();
    });
});
