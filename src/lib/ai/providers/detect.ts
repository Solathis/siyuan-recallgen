import type { AIEndpoint } from "@/types/config";
import type { ModelCatalog } from "./catalog";
import { defaultModelConfig, newestFirst, trimModel, type CatalogModel } from "./models";

export interface DetectedModel {
    id: string;
    info: CatalogModel | null;
}

export interface DetectedModels {
    models: DetectedModel[];
    specsFrom: "models.dev" | "snapshot";
}

interface ModelSpec {
    info: CatalogModel;
    api?: string;
}

const SPECIALIZED =
    /embed|rerank|tts|asr|audio|speech|image|vision|ocr|omni|realtime|translat|character|evolving|-vl\b/i;

function normalizeId(id: string): string {
    return id.trim().replace(/^models\//i, "");
}

function modelValues(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    for (const key of ["id", "model", "name"]) {
        if (typeof item[key] === "string") return [item[key] as string];
    }
    return [];
}

/** 兼容 OpenAI data、Ollama models、Gemini models/ 与少数裸数组的列表返回。 */
export function parseModelList(raw: string): string[] {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return [];
    }
    const source = Array.isArray(value)
        ? value
        : value && typeof value === "object"
          ? ((value as Record<string, unknown>).data ?? (value as Record<string, unknown>).models)
          : null;
    if (!Array.isArray(source)) return [];
    return [...new Set(source.flatMap(modelValues).map(normalizeId).filter(Boolean))];
}

function addSpec(map: Map<string, ModelSpec[]>, info: CatalogModel, api?: string): void {
    const id = normalizeId(info.id);
    const list = map.get(id) ?? [];
    list.push({ info: { ...info, id }, api });
    map.set(id, list);
}

/** 把 models.dev 完整 api.json 转成按模型 id 查找的规格索引。 */
export function specsFromApi(api: unknown): Map<string, ModelSpec[]> {
    const result = new Map<string, ModelSpec[]>();
    if (!api || typeof api !== "object") return result;
    for (const provider of Object.values(api as Record<string, unknown>)) {
        if (!provider || typeof provider !== "object") continue;
        const item = provider as { api?: unknown; models?: unknown };
        if (!item.models || typeof item.models !== "object") continue;
        const endpoint = typeof item.api === "string" ? item.api : undefined;
        for (const raw of Object.values(item.models as Record<string, unknown>)) {
            const info = trimModel(raw);
            if (info) addSpec(result, info, endpoint);
        }
    }
    return result;
}

export function specsFromCatalog(catalog: ModelCatalog): Map<string, ModelSpec[]> {
    const result = new Map<string, ModelSpec[]>();
    for (const models of Object.values(catalog.models)) {
        for (const info of models) addSpec(result, info);
    }
    return result;
}

function hostOf(value: string | undefined): string | undefined {
    if (!value) return undefined;
    try {
        return new URL(value).host.toLowerCase();
    } catch {
        return undefined;
    }
}

function majority<T>(items: T[], key: (value: T) => string): T | undefined {
    const counts = new Map<string, { count: number; first: T }>();
    for (const item of items) {
        const k = key(item);
        const current = counts.get(k);
        if (current) current.count += 1;
        else counts.set(k, { count: 1, first: item });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || key(a.first).localeCompare(key(b.first)))[0]?.first;
}

function consensus(candidates: ModelSpec[]): CatalogModel | undefined {
    if (candidates.length === 0) return undefined;
    const first = candidates[0].info;
    const output = majority(candidates, (candidate) => String(candidate.info.output))?.info.output ?? first.output;
    const context = majority(candidates, (candidate) => String(candidate.info.context))?.info.context ?? first.context;
    const temperature =
        majority(candidates, (candidate) => String(candidate.info.temperature))?.info.temperature ?? first.temperature;
    const toolCall =
        majority(candidates, (candidate) => String(candidate.info.toolCall))?.info.toolCall ?? first.toolCall;
    const textOut = majority(candidates, (candidate) => String(candidate.info.textOut))?.info.textOut ?? first.textOut;
    return { ...first, output, context, temperature, toolCall, textOut };
}

/** 为端点模型补上参数；同域名服务商优先，否则按 models.dev 多数值取共识。 */
export function specsFor(ids: string[], specs: Map<string, ModelSpec[]>, baseUrl: string): Map<string, CatalogModel> {
    const endpointHost = hostOf(baseUrl);
    const result = new Map<string, CatalogModel>();
    for (const id of ids) {
        const normalized = normalizeId(id);
        const candidates = specs.get(normalized) ?? specs.get(normalized.split("/").pop() ?? normalized) ?? [];
        const sameHost = endpointHost ? candidates.filter((candidate) => hostOf(candidate.api) === endpointHost) : [];
        const info = consensus(sameHost.length > 0 ? sameHost : candidates);
        if (info) result.set(id, { ...info, id });
    }
    return result;
}

function usable(info: CatalogModel): boolean {
    return info.textOut && !SPECIALIZED.test(info.id);
}

/** 已知且适合出题的排在前面，未知模型保留，已知专用模型放最后。 */
export function rankDetected(models: DetectedModel[]): DetectedModel[] {
    return [...models].sort((a, b) => {
        const aUsable = Boolean(a.info && usable(a.info));
        const bUsable = Boolean(b.info && usable(b.info));
        if (aUsable !== bUsable) return Number(bUsable) - Number(aUsable);
        if (!aUsable && !bUsable) return a.id.localeCompare(b.id);
        if (!a.info && !b.info) return a.id.localeCompare(b.id);
        if (!a.info) return -1;
        if (!b.info) return 1;
        return newestFirst(a.info, b.info);
    });
}

export function defaultPick(models: DetectedModel[]): string | null {
    const candidates = rankDetected(models).filter((model) => model.info && usable(model.info));
    const withTools = candidates.filter((model) => model.info?.toolCall);
    return (withTools[0] ?? candidates[0])?.id ?? null;
}

export interface DetectDeps {
    listRaw: () => Promise<string>;
    fetchApi: () => Promise<unknown>;
    fallbackCatalog: () => Promise<ModelCatalog>;
}

export async function detectEndpointModels(
    endpoint: Pick<AIEndpoint, "provider" | "protocol" | "baseUrl" | "apiKey">,
    deps: DetectDeps
): Promise<DetectedModels> {
    const ids = parseModelList(await deps.listRaw());
    if (ids.length === 0) throw new Error("端点没有返回任何模型");

    let specs: Map<string, ModelSpec[]>;
    let specsFrom: DetectedModels["specsFrom"];
    try {
        specs = specsFromApi(await deps.fetchApi());
        specsFrom = "models.dev";
    } catch {
        specs = specsFromCatalog(await deps.fallbackCatalog());
        specsFrom = "snapshot";
    }
    const byId = specsFor(ids, specs, endpoint.baseUrl);
    return { models: rankDetected(ids.map((id) => ({ id, info: byId.get(id) ?? null }))), specsFrom };
}

export function configForDetected(
    info: CatalogModel | null
): Pick<ReturnType<typeof defaultModelConfig>, "temperature" | "maxTokens" | "fixedTemperature"> {
    return defaultModelConfig(info);
}
