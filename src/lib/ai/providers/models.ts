/**
 * models.dev 模型数据的裁剪与「默认用最新模型」规则。
 *
 * 这个文件不 import 任何东西：同步脚本（scripts/sync_models.mjs，直接用 Node 运行）
 * 与运行时的「从 models.dev 刷新」共用这里的裁剪规则，两边留下的字段永远一致。
 */

/** 裁剪后的一个模型：只留界面与默认参数用得到的字段 */
export interface CatalogModel {
    id: string;
    name: string;
    /** 发布日期（YYYY-MM-DD 或 YYYY-MM） */
    release: string;
    updated: string;
    reasoning: boolean;
    toolCall: boolean;
    /** 是否接受自定义温度；false 的模型（例如 Kimi K3）发了 temperature 会被拒 */
    temperature: boolean;
    /** 只输出文本（不是图像、语音、向量等） */
    textOut: boolean;
    context: number;
    output: number;
    /** models.dev 的 status：deprecated / beta / alpha；正式版为空串 */
    status: string;
}

/** 预设服务商 → models.dev 的服务商 id 与可选的模型过滤（同一服务商下混着别家模型时用） */
export const MODELS_DEV_SOURCES: Record<string, { provider: string; idPrefix?: string }> = {
    deepseek: { provider: "deepseek" },
    zhipu: { provider: "zhipuai" },
    hunyuan: { provider: "tencent-tokenhub", idPrefix: "hy" },
    qwen: { provider: "alibaba-cn", idPrefix: "qwen" },
    kimi: { provider: "moonshotai-cn", idPrefix: "kimi" },
    xiaomi: { provider: "xiaomi", idPrefix: "mimo" },
    doubao: { provider: "volcengine", idPrefix: "doubao" },
};

/** 每家最多留几个模型：按发布日期取最新的，列表太长反而难选 */
export const MAX_MODELS_PER_PROVIDER = 12;

/** 不适合拿来出题的专用模型：向量、语音、图像、重排、翻译、角色扮演等 */
const SPECIALIZED =
    /embed|rerank|tts|asr|audio|speech|image|vision|ocr|omni|realtime|translat|character|evolving|-vl\b/i;

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
const cmp = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

/** 裁剪 models.dev 的一个模型对象；不是合法模型时返回 null */
export function trimModel(raw: unknown): CatalogModel | null {
    if (!raw || typeof raw !== "object") return null;
    const m = raw as Record<string, unknown>;
    const id = str(m.id);
    if (!id) return null;
    const limit = (m.limit ?? {}) as Record<string, unknown>;
    const modalities = (m.modalities ?? {}) as Record<string, unknown>;
    const output = Array.isArray(modalities.output) ? modalities.output : ["text"];
    return {
        id,
        name: str(m.name) || id,
        release: str(m.release_date),
        updated: str(m.last_updated),
        reasoning: m.reasoning === true,
        toolCall: m.tool_call === true,
        temperature: m.temperature !== false,
        textOut: output.length > 0 && output.every((kind) => kind === "text"),
        context: num(limit.context),
        output: num(limit.output),
        status: str(m.status),
    };
}

/** 新的排在前：发布日期、更新日期、上下文长度依次比较，最后按 id 升序保证结果稳定 */
export function newestFirst(a: CatalogModel, b: CatalogModel): number {
    return cmp(b.release, a.release) || cmp(b.updated, a.updated) || cmp(b.context, a.context) || cmp(a.id, b.id);
}

/** 从 models.dev 的完整数据里取出一家的模型：过滤、去掉已弃用的、按新旧排序并截断 */
export function modelsFromCatalog(api: unknown, source: { provider: string; idPrefix?: string }): CatalogModel[] {
    const provider = (api as Record<string, { models?: Record<string, unknown> }> | null)?.[source.provider];
    if (!provider?.models) return [];
    return Object.values(provider.models)
        .map(trimModel)
        .filter((m): m is CatalogModel => m !== null && m.status !== "deprecated")
        .filter((m) => !source.idPrefix || m.id.toLowerCase().startsWith(source.idPrefix))
        .sort(newestFirst)
        .slice(0, MAX_MODELS_PER_PROVIDER);
}

/**
 * 默认选哪个模型：「最新」的那个。
 *
 * 只在适合出题的里面挑：输出纯文本、不是专用模型（向量、语音、图像、多模态 omni 等）；
 * 其中优先支持工具调用的（结构化输出靠它），再按 newestFirst 取第一个。
 */
export function pickDefaultModel(models: CatalogModel[]): CatalogModel | null {
    const usable = models.filter((m) => m.status !== "deprecated" && m.textOut && !SPECIALIZED.test(m.id));
    if (usable.length === 0) return null;
    const withTools = usable.filter((m) => m.toolCall);
    return [...(withTools.length > 0 ? withTools : usable)].sort(newestFirst)[0];
}

/**
 * 新接入模型的默认参数。
 *
 * maxTokens 取「模型输出上限」与 32768 的较小值，拿不到上限时用 16384：
 * 设得太大，输入加 max_tokens 超过上下文窗口时有的服务商直接报错；
 * 设得太小又会被截断，而截断正是「缺少 questions 数组」报错的头号原因。
 * 推理强度不设（服务端默认），免得某家不支持某个档位直接返回 400。
 */
export function defaultModelConfig(model: Pick<CatalogModel, "output" | "temperature"> | null): {
    temperature: number;
    maxTokens: number;
    fixedTemperature: boolean;
} {
    const cap = model && model.output > 0 ? Math.min(model.output, 32_768) : 16_384;
    return { temperature: 0.7, maxTokens: Math.max(256, cap), fixedTemperature: model?.temperature === false };
}
