import {
    DEFAULT_AI_CONFIG,
    getDefaultConfig,
    type AIConfig,
    type AIEndpoint,
    type AIModel,
    type QuizPreset,
    type RecallGenConfig,
} from "@/types/config";
import {
    isSafeCssColor,
    type DifficultyDistribution,
    type HeatmapConfig,
    type QuestionType,
    type ScoreRange,
} from "@/types/quiz";
import { t } from "@/lib/i18n";

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
        throw new Error(t("import.badJson", (e as Error).message));
    }
    if (!raw || typeof raw !== "object") throw new Error(t("import.notObject"));
    const file = raw as Partial<ConfigExportFile>;
    if (file.app !== "recallgen") throw new Error(t("import.wrongFileConfig"));
    if (typeof file.version === "number" && file.version > CONFIG_EXPORT_VERSION) {
        throw new Error(t("import.versionTooNew", String(file.version), String(CONFIG_EXPORT_VERSION)));
    }
    if (!file.config || typeof file.config !== "object") throw new Error(t("import.missingConfig"));
    return {
        app: "recallgen",
        version: typeof file.version === "number" ? file.version : CONFIG_EXPORT_VERSION,
        exportedAt: typeof file.exportedAt === "string" ? file.exportedAt : "",
        includesSecrets: !!file.includesSecrets,
        config: file.config as RecallGenConfig,
    };
}

/**
 * 逐字段校验并合并一份配置。
 * 导入文件与磁盘上的配置走的是同一条路径：两侧都可能被手工改坏，
 * 只做浅合并会让 allowedTypes:"coding" 这类值直接流进出题逻辑。
 */
export function sanitizeConfig(
    current: RecallGenConfig,
    imported: Partial<RecallGenConfig>,
    { includesSecrets = true }: { includesSecrets?: boolean } = {}
): ImportResult {
    const warnings: string[] = [];
    const defaults = getDefaultConfig();

    const ai = mergeAI(current.ai, imported.ai, includesSecrets, warnings);
    const prompts = mergePrompts(current, imported, warnings);
    const general = mergeGeneral(current, imported, warnings);
    const heatmap = mergeHeatmap(current, imported, warnings);

    // 角色指向的模型必须仍存在，否则回落到第一个可用模型
    const modelIds = new Set(ai.models.map((m) => m.id));
    const fallback = ai.models[0]?.id ?? defaults.ai.models[0].id;
    for (const role of ["generator", "reviewer", "grader"] as const) {
        if (!modelIds.has(ai.roles[role])) {
            warnings.push(t("configImport.roleFallback", role, fallback));
            ai.roles[role] = fallback;
        }
    }
    if (!modelIds.has(ai.testModelId)) ai.testModelId = fallback;

    return { config: { ai, prompts, general, heatmap }, warnings };
}

/** 导入并合并到当前配置，返回新配置与需要提示用户的警告 */
export function mergeImportedConfig(current: RecallGenConfig, text: string): ImportResult {
    const file = parseConfigExport(text);
    return sanitizeConfig(current, file.config, { includesSecrets: file.includesSecrets });
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

    // 不含 Key 的文件导入时，只在「请求地址完全没变」的前提下沿用本机 Key。
    // 不能用 id 匹配：配置文件是可以分享的，只要把同名端点的 baseUrl 改成别的服务器，
    // 本机 Key 就会被自动带过去发往任意地址（凭据外泄）。
    const resolved = endpoints.map((endpoint) => {
        if (endpoint.apiKey) return endpoint;

        const sameAddress = current.endpoints.find(
            (candidate) => !!candidate.baseUrl && candidate.baseUrl === endpoint.baseUrl
        );
        if (sameAddress?.apiKey) {
            warnings.push(t("configImport.keyKept", endpoint.name));
            return { ...endpoint, apiKey: sameAddress.apiKey };
        }

        const sameId = current.endpoints.find((candidate) => candidate.id === endpoint.id);
        if (sameId?.baseUrl && sameId.baseUrl !== endpoint.baseUrl) {
            warnings.push(
                t("configImport.endpointBaseUrlChanged", endpoint.name, sameId.baseUrl, endpoint.baseUrl || "—")
            );
            return endpoint;
        }
        if (!includesSecrets) warnings.push(t("configImport.keyMissing", endpoint.name));
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
            warnings.push(t("configImport.endpointNoId", String(index + 1)));
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
            warnings.push(t("configImport.modelNoId", String(index + 1)));
            continue;
        }
        if (typeof candidate.endpointId !== "string" || !endpointIds.has(candidate.endpointId)) {
            warnings.push(t("configImport.modelBadEndpoint", candidate.name ?? candidate.id));
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
        else if (value !== undefined) warnings.push(t("configImport.promptEmpty", key));
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
    general.reviewLimit = clampInt(incoming.reviewLimit, general.reviewLimit, 0, 200);
    general.panelWidth = clampInt(incoming.panelWidth, general.panelWidth, 600, 1600);
    if (incoming.storageLocation === "notebook" || incoming.storageLocation === "sibling") {
        general.storageLocation = incoming.storageLocation;
    }
    if (typeof incoming.notebookId === "string") general.notebookId = incoming.notebookId;
    if (incoming.multipleChoicePolicy === "strict" || incoming.multipleChoicePolicy === "partial") {
        general.multipleChoicePolicy = incoming.multipleChoicePolicy;
    }
    if (Array.isArray(incoming.presets)) {
        // 只接受结构完整的预设，避免导入后界面出现无法应用的条目
        general.presets = incoming.presets
            .filter((preset): preset is QuizPreset => isPlausiblePreset(preset))
            .map((preset) => ({
                id: preset.id,
                name: String(preset.name).slice(0, 24),
                allowedTypes: preset.allowedTypes.filter((t) => ALLOWED_TYPES.includes(t)),
                difficulty: { ...preset.difficulty },
                extraScopePct: clampInt(preset.extraScopePct, 0, 0, 100),
            }))
            .filter((preset) => preset.allowedTypes.length > 0);
        if (general.presets.length !== incoming.presets.length) {
            warnings.push("部分试卷预设结构不完整，已跳过");
        }
    }
    return general;
}

function mergeHeatmap(current: RecallGenConfig, imported: Partial<RecallGenConfig>, warnings: string[]) {
    const heatmap: HeatmapConfig = { ...current.heatmap };
    const incoming = imported.heatmap;
    if (!incoming || typeof incoming !== "object") return heatmap;

    if (typeof incoming.enabled === "boolean") heatmap.enabled = incoming.enabled;
    if (incoming.metric === "max" || incoming.metric === "avg") heatmap.metric = incoming.metric;
    if (Array.isArray(incoming.ranges)) {
        // 颜色会被写进内联 style，必须校验：否则分享的配置能注入任意 CSS 声明
        const ranges = incoming.ranges
            .filter((r): r is ScoreRange => !!r && typeof r === "object" && isSafeCssColor((r as ScoreRange).color))
            .map((r) => ({
                min: clampInt(r.min, 0, 0, 100),
                max: clampInt(r.max, 100, 0, 100),
                color: r.color.trim(),
            }));
        if (ranges.length > 0) heatmap.ranges = ranges;
        else warnings.push("配色区间无效，已保留原有配色");
        if (ranges.length > 0 && ranges.length < incoming.ranges.length) {
            warnings.push("部分配色区间的颜色写法不安全或无效，已跳过");
        }
    }
    return heatmap;
}

/** 预设是否结构完整到可以应用 */
function isPlausiblePreset(value: unknown): value is QuizPreset {
    const preset = value as Partial<QuizPreset>;
    return (
        !!preset &&
        typeof preset === "object" &&
        typeof preset.id === "string" &&
        !!preset.id &&
        typeof preset.name === "string" &&
        Array.isArray(preset.allowedTypes) &&
        !!preset.difficulty &&
        typeof preset.difficulty === "object"
    );
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
