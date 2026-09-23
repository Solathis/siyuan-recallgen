import {
    DEFAULT_AI_CONFIG,
    getDefaultConfig,
    type AIConfig,
    type AIEndpoint,
    type AIModel,
    type RecallGenConfig,
} from "@/types/config";
import type { DifficultyDistribution, HeatmapConfig, QuestionType, ScoreRange } from "@/types/quiz";

/**
 * 配置的导出与导入。
 *
 * 导入是「部分覆盖」而不是整体替换：
 * - 文件里缺失的字段保持当前值，因此可以只分享提示词或只分享端点
 * - 不含 API Key 的文件导入时沿用本机已有的 Key，避免分享配置就被清空 Key
 * - 结构不合法的端点/模型会被丢弃并在 warnings 中说明，而不是让整个配置不可用
 */

/** 导出文件格式版本 */
export const CONFIG_EXPORT_VERSION = 1;

export interface ConfigExportFile {
    app: "recallgen";
    version: number;
    exportedAt: string;
    /** 是否含 API Key */
    includesSecrets: boolean;
    config: RecallGenConfig;
}

export interface ImportResult {
    config: RecallGenConfig;
    warnings: string[];
}

/** 导出配置为 JSON 文本；默认剔除 API Key */
export function buildConfigExport(config: RecallGenConfig, includeSecrets = false): string {
    const payload: RecallGenConfig = includeSecrets
        ? config
        : {
              ...config,
              ai: {
                  ...config.ai,
                  endpoints: config.ai.endpoints.map((endpoint) => ({ ...endpoint, apiKey: "" })),
              },
          };

    const file: ConfigExportFile = {
        app: "recallgen",
        version: CONFIG_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        includesSecrets: includeSecrets,
        config: payload,
    };
    return JSON.stringify(file, null, 2);
}

/** 解析导出文件；仅接受本插件的导出格式，无法识别时抛出可读错误 */
export function parseConfigExport(text: string): ConfigExportFile {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        throw new Error(`配置不是合法 JSON: ${(e as Error).message}`);
    }
    if (!raw || typeof raw !== "object") throw new Error("配置内容不是对象");
    const file = raw as Partial<ConfigExportFile>;
    if (file.app !== "recallgen") throw new Error("不是 RecallGen 的配置文件");
    if (typeof file.version === "number" && file.version > CONFIG_EXPORT_VERSION) {
        throw new Error(`配置版本 ${file.version} 高于当前支持的 ${CONFIG_EXPORT_VERSION}`);
    }
    if (!file.config || typeof file.config !== "object") throw new Error("配置文件缺少 config 字段");
    return {
        app: "recallgen",
        version: typeof file.version === "number" ? file.version : CONFIG_EXPORT_VERSION,
        exportedAt: typeof file.exportedAt === "string" ? file.exportedAt : "",
        includesSecrets: !!file.includesSecrets,
        config: file.config as RecallGenConfig,
    };
}

/** 导入并合并到当前配置，返回新配置与需要提示用户的警告 */
export function mergeImportedConfig(current: RecallGenConfig, text: string): ImportResult {
    const file = parseConfigExport(text);
    const imported = file.config;
    const warnings: string[] = [];
    const defaults = getDefaultConfig();

    const ai = mergeAI(current.ai, imported.ai, file.includesSecrets, warnings);
    const prompts = mergePrompts(current, imported, warnings);
    const general = mergeGeneral(current, imported, warnings);
    const heatmap = mergeHeatmap(current, imported, warnings);

    // 角色指向的模型必须仍存在，否则回落到第一个可用模型
    const modelIds = new Set(ai.models.map((m) => m.id));
    const fallback = ai.models[0]?.id ?? defaults.ai.models[0].id;
    for (const role of ["generator", "reviewer", "grader"] as const) {
        if (!modelIds.has(ai.roles[role])) {
            warnings.push(`角色 ${role} 指向的模型不存在，已回落到 ${fallback}`);
            ai.roles[role] = fallback;
        }
    }
    if (!modelIds.has(ai.testModelId)) ai.testModelId = fallback;

    return { config: { ai, prompts, general, heatmap }, warnings };
}

function mergeAI(
    current: AIConfig,
    imported: Partial<AIConfig> | undefined,
    includesSecrets: boolean,
    warnings: string[]
): AIConfig {
    if (!imported || typeof imported !== "object") return current;

    const endpoints = sanitizeEndpoints(imported.endpoints, warnings);
    const models = sanitizeModels(imported.models, endpoints, warnings);

    if (endpoints.length === 0 && models.length === 0) return current;
    if (models.length === 0) {
        warnings.push("配置里没有可用的模型，已保留本机原有模型");
        return { ...current, endpoints };
    }

    // 不含 Key 的文件导入时，沿用本机同名（或同地址）端点的 Key
    const resolved = endpoints.map((endpoint) => {
        if (endpoint.apiKey) return endpoint;
        const existing = current.endpoints.find(
            (candidate) => candidate.id === endpoint.id || (candidate.baseUrl && candidate.baseUrl === endpoint.baseUrl)
        );
        if (existing?.apiKey) {
            warnings.push(`端点「${endpoint.name}」沿用本机已有的 API Key`);
            return { ...endpoint, apiKey: existing.apiKey };
        }
        if (!includesSecrets) warnings.push(`端点「${endpoint.name}」没有 API Key，请补填`);
        return endpoint;
    });

    return {
        endpoints: resolved,
        models,
        roles: { ...current.roles, ...(imported.roles ?? {}) },
        timeout: clampInt(imported.timeout, current.timeout, 5_000, 600_000),
        jsonSchemaEnabled:
            typeof imported.jsonSchemaEnabled === "boolean" ? imported.jsonSchemaEnabled : current.jsonSchemaEnabled,
        testModelId: typeof imported.testModelId === "string" ? imported.testModelId : current.testModelId,
        testPrompt: typeof imported.testPrompt === "string" ? imported.testPrompt : current.testPrompt,
    };
}

function sanitizeEndpoints(value: unknown, warnings: string[]): AIEndpoint[] {
    if (!Array.isArray(value)) return [];
    const out: AIEndpoint[] = [];
    for (const [index, item] of value.entries()) {
        const candidate = item as Partial<AIEndpoint>;
        if (!candidate || typeof candidate !== "object" || typeof candidate.id !== "string" || !candidate.id) {
            warnings.push(`第 ${index + 1} 个端点缺少 id，已跳过`);
            continue;
        }
        const protocol = candidate.protocol;
        out.push({
            id: candidate.id,
            name: typeof candidate.name === "string" && candidate.name ? candidate.name : candidate.id,
            provider: candidate.provider === "ollama" ? "ollama" : "openai",
            protocol: protocol === "responses" || protocol === "messages" ? protocol : "chat",
            baseUrl: typeof candidate.baseUrl === "string" ? candidate.baseUrl : "",
            apiKey: typeof candidate.apiKey === "string" ? candidate.apiKey : "",
        });
    }
    return out;
}

function sanitizeModels(value: unknown, endpoints: AIEndpoint[], warnings: string[]): AIModel[] {
    if (!Array.isArray(value)) return [];
    const endpointIds = new Set(endpoints.map((e) => e.id));
    const out: AIModel[] = [];
    for (const [index, item] of value.entries()) {
        const candidate = item as Partial<AIModel>;
        if (!candidate || typeof candidate !== "object" || typeof candidate.id !== "string" || !candidate.id) {
            warnings.push(`第 ${index + 1} 个模型缺少 id，已跳过`);
            continue;
        }
        if (typeof candidate.endpointId !== "string" || !endpointIds.has(candidate.endpointId)) {
            warnings.push(`模型「${candidate.name ?? candidate.id}」引用的端点不存在，已跳过`);
            continue;
        }
        out.push({
            id: candidate.id,
            name: typeof candidate.name === "string" && candidate.name ? candidate.name : candidate.id,
            endpointId: candidate.endpointId,
            temperature: clampNumber(candidate.temperature, DEFAULT_AI_CONFIG.models[0].temperature, 0, 2),
            maxTokens: clampInt(candidate.maxTokens, DEFAULT_AI_CONFIG.models[0].maxTokens, 256, 200_000),
        });
    }
    return out;
}

function mergePrompts(current: RecallGenConfig, imported: Partial<RecallGenConfig>, warnings: string[]) {
    const prompts = { ...current.prompts };
    const incoming = imported.prompts;
    if (!incoming || typeof incoming !== "object") return prompts;
    for (const key of ["generate", "review", "gradeSubjective", "analysis"] as const) {
        const value = incoming[key];
        if (typeof value === "string" && value.trim()) prompts[key] = value;
        else if (value !== undefined) warnings.push(`提示词 ${key} 为空，已保留原有内容`);
    }
    return prompts;
}

function mergeGeneral(current: RecallGenConfig, imported: Partial<RecallGenConfig>, warnings: string[]) {
    const general = { ...current.general };
    const incoming = imported.general;
    if (!incoming || typeof incoming !== "object") return general;

    if (Array.isArray(incoming.allowedTypes)) {
        const types = incoming.allowedTypes.filter((t): t is QuestionType => ALLOWED_TYPES.includes(t as QuestionType));
        if (types.length > 0) general.allowedTypes = types;
        else warnings.push("题型列表为空或全部无效，已保留原有题型");
    }
    if (incoming.difficulty && typeof incoming.difficulty === "object") {
        const d = incoming.difficulty as Partial<DifficultyDistribution>;
        general.difficulty = {
            total: clampInt(d.total, general.difficulty.total, 1, 50),
            easy: clampInt(d.easy, general.difficulty.easy, 0, 50),
            medium: clampInt(d.medium, general.difficulty.medium, 0, 50),
            hard: clampInt(d.hard, general.difficulty.hard, 0, 50),
        };
    }
    if (incoming.language === "zh" || incoming.language === "en") general.language = incoming.language;
    if (typeof incoming.countdownEnabled === "boolean") general.countdownEnabled = incoming.countdownEnabled;
    general.countdownMinutes = clampInt(incoming.countdownMinutes, general.countdownMinutes, 1, 600);
    general.extraScopePct = clampInt(incoming.extraScopePct, general.extraScopePct, 0, 100);
    general.panelWidth = clampInt(incoming.panelWidth, general.panelWidth, 600, 1600);
    if (incoming.storageLocation === "notebook" || incoming.storageLocation === "sibling") {
        general.storageLocation = incoming.storageLocation;
    }
    if (typeof incoming.notebookId === "string") general.notebookId = incoming.notebookId;
    return general;
}

function mergeHeatmap(current: RecallGenConfig, imported: Partial<RecallGenConfig>, warnings: string[]) {
    const heatmap: HeatmapConfig = { ...current.heatmap };
    const incoming = imported.heatmap;
    if (!incoming || typeof incoming !== "object") return heatmap;

    if (typeof incoming.enabled === "boolean") heatmap.enabled = incoming.enabled;
    if (incoming.metric === "max" || incoming.metric === "avg") heatmap.metric = incoming.metric;
    if (Array.isArray(incoming.ranges)) {
        const ranges = incoming.ranges
            .filter((r): r is ScoreRange => !!r && typeof r === "object" && typeof (r as ScoreRange).color === "string")
            .map((r) => ({
                min: clampInt(r.min, 0, 0, 100),
                max: clampInt(r.max, 100, 0, 100),
                color: r.color,
            }));
        if (ranges.length > 0) heatmap.ranges = ranges;
        else warnings.push("配色区间无效，已保留原有配色");
    }
    return heatmap;
}

const ALLOWED_TYPES: QuestionType[] = [
    "single_choice",
    "multiple_choice",
    "fill_blank",
    "true_false",
    "subjective",
    "coding",
];

/**
 * 数值收敛；非法时回落到给定默认值。
 * 刻意不做取整——温度这类字段可以是 0.5，取整会把 0.5 变成 1（该缺陷由往返测试捕获）。
 */
function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

/** 整数收敛；用于题数、token 数、宽度等只能取整的字段 */
function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}
