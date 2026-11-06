import { AsyncStore, type StoragePlugin } from "@/lib/storage/store";
import { fetchText } from "../client";
import type { ModelCatalog } from "./catalog";
import { MODELS_DEV_SOURCES, modelsFromCatalog, trimModel, type CatalogModel } from "./models";

/**
 * 「从 models.dev 刷新」：用户点了才联网。
 *
 * 完整数据约 6MB；拿到后立即裁剪成只含已映射服务商的几十个模型，原文随即丢弃，
 * 只把裁剪结果存为 recallgen-models-cache.json。比随插件发布的快照新时优先用它。
 */
export const MODELS_DEV_API = "https://models.dev/api.json";

/** 把 models.dev 的完整数据裁剪成目录；没有任何一家能取到模型时抛错（多半是返回了错误页） */
export function catalogFromApi(api: unknown, fetchedAt: string): ModelCatalog {
    const models: Record<string, CatalogModel[]> = {};
    for (const [preset, source] of Object.entries(MODELS_DEV_SOURCES)) {
        const list = modelsFromCatalog(api, source);
        if (list.length > 0) models[preset] = list;
    }
    if (Object.keys(models).length === 0) throw new Error("models.dev returned no usable models");
    return { fetchedAt, models };
}

export async function fetchModelsDevCatalog(signal?: AbortSignal): Promise<ModelCatalog> {
    const text = await fetchText(MODELS_DEV_API, 60_000, signal);
    return catalogFromApi(JSON.parse(text), new Date().toISOString());
}

/** 缓存文件是本插件写的，但可能被手工改坏：逐项校验，不合格的丢掉 */
export function normalizeCachedCatalog(raw: unknown): ModelCatalog | null {
    if (!raw || typeof raw !== "object") return null;
    const value = raw as { fetchedAt?: unknown; models?: unknown };
    if (typeof value.fetchedAt !== "string" || !value.models || typeof value.models !== "object") return null;
    const models: Record<string, CatalogModel[]> = {};
    for (const [preset, list] of Object.entries(value.models as Record<string, unknown>)) {
        if (!MODELS_DEV_SOURCES[preset] || !Array.isArray(list)) continue;
        const clean = list
            .map((item) => {
                const m = item as Record<string, unknown> | null;
                if (!m || typeof m.id !== "string") return null;
                // 缓存里存的是裁剪后的形状，这里换回 models.dev 的字段名再走一遍同一套裁剪
                return trimModel({
                    id: m.id,
                    name: m.name,
                    release_date: m.release,
                    last_updated: m.updated,
                    reasoning: m.reasoning,
                    tool_call: m.toolCall,
                    temperature: m.temperature,
                    modalities: { output: m.textOut === false ? ["image"] : ["text"] },
                    limit: { context: m.context, output: m.output },
                    status: m.status,
                });
            })
            .filter((m): m is CatalogModel => m !== null);
        if (clean.length > 0) models[preset] = clean;
    }
    return Object.keys(models).length > 0 ? { fetchedAt: value.fetchedAt, models } : null;
}

export class ModelsCacheStore extends AsyncStore {
    constructor(plugin: StoragePlugin) {
        super(plugin, "recallgen-models-cache.json");
    }

    async load(): Promise<ModelCatalog | null> {
        return normalizeCachedCatalog(await this.read<unknown>(null));
    }

    async save(catalog: ModelCatalog): Promise<void> {
        await this.write(catalog);
    }
}
