import type { AIConfig, AIEndpoint, AIModel, AIRoles } from "@/types/config";
import { presetById, type ProviderPreset } from "./catalog";
import { defaultModelConfig, type CatalogModel } from "./models";

/**
 * 「快速接入」：填一个 API Key 就能出题。
 *
 * 角色（出题 / 审题 / 判分）当前指向的模型不可用时（找不到模型、端点，或端点没填 Key），
 * 自动改指向这次接入的默认模型；本来就可用的不动，除非用户勾选了「设为默认」。
 */

/** 某个模型能不能用；出题前的配置检查（QuizPanel）用的是同一个判断 */
export type ModelProblem = "noModel" | "noEndpoint" | "noApiKey" | null;

export function modelProblem(ai: Pick<AIConfig, "models" | "endpoints">, modelId: string): ModelProblem {
    const model = ai.models.find((m) => m.id === modelId);
    if (!model) return "noModel";
    const endpoint = ai.endpoints.find((e) => e.id === model.endpointId);
    if (!endpoint) return "noEndpoint";
    if (endpoint.provider !== "ollama" && !endpoint.apiKey) return "noApiKey";
    return null;
}

/** 预设服务商的端点 id 固定：重复接入是更新，不会新建 */
export const presetEndpointId = (presetId: string) => `preset-${presetId}`;

const presetModelId = (presetId: string, modelName: string) =>
    `preset-${presetId}-${modelName.replace(/[^0-9a-zA-Z._-]+/g, "_")}`;

export interface ConnectInput {
    preset: ProviderPreset;
    /** 界面上显示的端点名（服务商名称，已本地化） */
    name: string;
    apiKey: string;
    /** 要接入的模型（模型 id 即 API 里的 model 参数） */
    models: Pick<CatalogModel, "id" | "output" | "temperature">[];
    /** 设为默认的模型 id，必须在 models 里 */
    defaultModel: string;
    /** 把出题、审题、判分都改指向默认模型（不管原来能不能用） */
    makeDefault: boolean;
}

export function connectPreset(ai: AIConfig, input: ConnectInput): AIConfig {
    const endpointId = presetEndpointId(input.preset.id);
    const existing = ai.endpoints.find((e) => e.id === endpointId);
    const endpoint: AIEndpoint = {
        id: endpointId,
        // 用户改过端点名或 baseUrl（例如换成自己的网关）时保留
        name: existing?.name || input.name,
        provider: "openai",
        protocol: existing?.protocol ?? input.preset.protocol,
        baseUrl: existing?.baseUrl || input.preset.baseUrl,
        apiKey: input.apiKey.trim(),
        presetId: input.preset.id,
    };
    const endpoints = existing
        ? ai.endpoints.map((e) => (e.id === endpointId ? endpoint : e))
        : [...ai.endpoints, endpoint];

    const wanted = new Set(input.models.map((m) => m.id));
    const referenced = new Set([ai.roles.generator, ai.roles.reviewer, ai.roles.grader, ai.testModelId]);
    const ownModels = ai.models.filter((m) => m.endpointId === endpointId);
    // 取消勾选的模型删掉；还被角色引用的保留，免得角色指向不存在的模型
    const kept = ownModels.filter((m) => wanted.has(m.name) || referenced.has(m.id));
    const added: AIModel[] = input.models
        .filter((m) => !kept.some((k) => k.name === m.id))
        .map((m) => ({ id: presetModelId(input.preset.id, m.id), name: m.id, endpointId, ...defaultModelConfig(m) }));
    const models = [...ai.models.filter((m) => m.endpointId !== endpointId), ...kept, ...added];

    const next: AIConfig = { ...ai, endpoints, models };
    const defaultId = models.find((m) => m.endpointId === endpointId && m.name === input.defaultModel)?.id;
    if (!defaultId) return next;

    const roles: AIRoles = { ...ai.roles };
    for (const role of ["generator", "reviewer", "grader"] as const) {
        // 审题模型可以不配（空串表示不审题）：没配的不替用户打开
        if (role === "reviewer" && !roles.reviewer && !input.makeDefault) continue;
        if (input.makeDefault || modelProblem(next, roles[role]) !== null) roles[role] = defaultId;
    }
    const testModelId = modelProblem(next, ai.testModelId) !== null ? defaultId : ai.testModelId;
    return { ...next, roles, testModelId };
}

/** 已接入的预设端点（presetId 有效、填了 Key） */
export function connectedPreset(ai: Pick<AIConfig, "endpoints">, presetId: string): AIEndpoint | undefined {
    const endpoint = ai.endpoints.find((e) => e.id === presetEndpointId(presetId));
    return endpoint && presetById(endpoint.presetId) && endpoint.apiKey ? endpoint : undefined;
}
