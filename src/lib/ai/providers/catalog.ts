import { t } from "@/lib/i18n";
import type { AIProtocol } from "@/types/config";
import snapshot from "./models-snapshot.json";
import { MODELS_DEV_SOURCES, type CatalogModel } from "./models";

/**
 * 内置的 AI 服务商目录：设置页「快速接入」的卡片由它驱动。
 *
 * baseUrl 与 toolChoice 逐家按官方文档核实；models.dev 收录了的，模型列表来自
 * models-snapshot.json（pnpm sync-models 生成）或用户手动刷新的缓存；没收录的用 builtinModels。
 * 名称与简介走 i18n：provider.<id>.name / provider.<id>.desc。以后加一家只需在这里加一条、
 * 配一个图标、补两条文案。
 */
export interface ProviderPreset {
    id: string;
    /** @lobehub/icons-static-svg 里的图标 id */
    icon: string;
    baseUrl: string;
    protocol: AIProtocol;
    /** 申请 API Key 的地址 */
    keyUrl: string;
    docsUrl: string;
    /**
     * 结构化输出时 tool_choice 的写法。named：指定函数（默认）；
     * auto：只能让模型自己决定调用哪个函数（智谱文档写明「默认 auto 且仅支持 auto」）。
     */
    toolChoice: "named" | "auto";
    /** models.dev 没收录时的内置模型 */
    builtinModels: CatalogModel[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
    {
        id: "deepseek",
        icon: "deepseek",
        baseUrl: "https://api.deepseek.com",
        protocol: "chat",
        keyUrl: "https://platform.deepseek.com/api_keys",
        docsUrl: "https://api-docs.deepseek.com/",
        toolChoice: "named",
        builtinModels: [],
    },
    {
        id: "zhipu",
        icon: "zhipu",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        protocol: "chat",
        keyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
        docsUrl: "https://docs.bigmodel.cn/",
        toolChoice: "auto",
        builtinModels: [],
    },
    {
        id: "hunyuan",
        icon: "hunyuan",
        baseUrl: "https://tokenhub.tencentmaas.com/v1",
        protocol: "chat",
        keyUrl: "https://cloud.tencent.com/document/product/1823/130050",
        docsUrl: "https://cloud.tencent.com/document/product/1823/130050",
        toolChoice: "named",
        builtinModels: [],
    },
    {
        id: "qwen",
        icon: "qwen",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        protocol: "chat",
        keyUrl: "https://bailian.console.aliyun.com/",
        docsUrl: "https://help.aliyun.com/zh/model-studio/",
        toolChoice: "named",
        builtinModels: [],
    },
    {
        id: "kimi",
        icon: "kimi",
        baseUrl: "https://api.moonshot.cn/v1",
        protocol: "chat",
        keyUrl: "https://platform.moonshot.cn/console/api-keys",
        docsUrl: "https://platform.moonshot.cn/docs/api/chat",
        toolChoice: "named",
        builtinModels: [],
    },
    {
        id: "xiaomi",
        icon: "xiaomimimo",
        baseUrl: "https://api.xiaomimimo.com/v1",
        protocol: "chat",
        keyUrl: "https://platform.xiaomimimo.com/",
        docsUrl: "https://platform.xiaomimimo.com/#/docs",
        toolChoice: "named",
        builtinModels: [],
    },
    {
        /*
         * 华为云 ModelArts Studio（MaaS）。models.dev 没有收录；可调用的模型要先在控制台开通，
         * 名称以控制台为准，这里不内置模型，接入时手动填写模型名。
         * 接口地址实测存在：GET /v1/models 不带凭据时返回 ModelArts.81002「Failed to get the authorization header」。
         */
        id: "huawei",
        icon: "huaweicloud",
        baseUrl: "https://api.modelarts-maas.com/v1",
        protocol: "chat",
        keyUrl: "https://console.huaweicloud.com/modelarts/",
        docsUrl: "https://support.huaweicloud.com/modelarts/",
        toolChoice: "named",
        builtinModels: [],
    },
    {
        /* 百度千帆 v2 接口（OpenAI 兼容，Bearer API Key）。models.dev 没有收录，模型取自千帆模型列表页 */
        id: "wenxin",
        icon: "wenxin",
        baseUrl: "https://qianfan.baidubce.com/v2",
        protocol: "chat",
        keyUrl: "https://console.bce.baidu.com/iam/#/iam/apikey/list",
        docsUrl: "https://cloud.baidu.com/doc/qianfan-api/s/3m7of64lb",
        toolChoice: "named",
        builtinModels: [
            {
                id: "ernie-5.1",
                name: "ERNIE 5.1",
                release: "",
                updated: "",
                reasoning: false,
                toolCall: false,
                temperature: true,
                textOut: true,
                context: 128_000,
                output: 65_536,
                status: "",
            },
        ],
    },
    {
        id: "doubao",
        icon: "doubao",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        protocol: "chat",
        keyUrl: "https://console.volcengine.com/ark/",
        docsUrl: "https://www.volcengine.com/docs/82379/1330310",
        toolChoice: "named",
        builtinModels: [],
    },
];

export function presetById(id: string | undefined): ProviderPreset | undefined {
    return id ? PROVIDER_PRESETS.find((preset) => preset.id === id) : undefined;
}

/** 服务商名称与一句话简介（i18n：provider.<id>.name / provider.<id>.desc） */
export function presetName(preset: Pick<ProviderPreset, "id">): string {
    return t(`provider.${preset.id}.name`);
}

export function presetDesc(preset: Pick<ProviderPreset, "id">): string {
    return t(`provider.${preset.id}.desc`);
}

/** 一份模型目录：随插件发布的快照，或用户从 models.dev 刷新后的缓存 */
export interface ModelCatalog {
    /** ISO 时间 */
    fetchedAt: string;
    models: Record<string, CatalogModel[]>;
}

/** 随插件发布的快照（pnpm sync-models 生成） */
export const SNAPSHOT_CATALOG: ModelCatalog = {
    fetchedAt: snapshot.fetchedAt,
    models: snapshot.models as Record<string, CatalogModel[]>,
};

/** 快照里记录的 models.dev 接口地址，用于核对目录里的 baseUrl 有没有过时 */
export const SNAPSHOT_APIS: Record<string, string> = snapshot.apis;

/** 缓存比快照新就用缓存，否则用快照 */
export function newerCatalog(cache: ModelCatalog | null): ModelCatalog {
    return cache && cache.fetchedAt > SNAPSHOT_CATALOG.fetchedAt ? cache : SNAPSHOT_CATALOG;
}

/** 某家服务商可选的模型：models.dev 收录的取目录，否则取内置清单 */
export function presetModels(preset: ProviderPreset, catalog: ModelCatalog = SNAPSHOT_CATALOG): CatalogModel[] {
    if (MODELS_DEV_SOURCES[preset.id]) return catalog.models[preset.id] ?? [];
    return preset.builtinModels;
}

/** 模型数据从哪来：models.dev，还是目录里按官方文档整理的内置清单 */
export function modelSource(preset: ProviderPreset): "models.dev" | "builtin" {
    return MODELS_DEV_SOURCES[preset.id] ? "models.dev" : "builtin";
}
