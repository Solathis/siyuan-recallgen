import { fetchSyncPost } from "siyuan";
import type { AIConfig, AIProvider, AIProtocol } from "@/types/config";

/** AI 调用错误，附带 HTTP 状态便于上层区分 */
export class AIError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message);
        this.name = "AIError";
    }
}

export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export interface LLMCallOptions {
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
    /** 结构化输出约束（OpenAI response_format 格式）；undefined 表示不约束 */
    responseFormat?: unknown;
}

export interface LLMResult {
    content: string;
    raw: unknown;
}

// ── 扁平化配置：由 AIConfig + modelId 解析出 ────────────────────────

/** 解析后的单次调用配置，扁平结构供协议函数直接使用 */
export interface ResolvedAIConfig {
    provider: AIProvider;
    protocol: AIProtocol;
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
    timeout: number;
}

/**
 * 从多端点多模型配置中解析出指定模型的扁平调用配置。
 * 找不到模型或端点时抛出 AIError。
 */
export function resolveAI(config: AIConfig, modelId: string): ResolvedAIConfig {
    const model = config.models.find((m) => m.id === modelId);
    if (!model) throw new AIError(`未找到模型: ${modelId}`);
    const endpoint = config.endpoints.find((e) => e.id === model.endpointId);
    if (!endpoint) throw new AIError(`模型 ${model.name} 引用的端点不存在: ${model.endpointId}`);
    return {
        provider: endpoint.provider,
        protocol: endpoint.protocol,
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey,
        model: model.name,
        temperature: model.temperature,
        maxTokens: model.maxTokens,
        timeout: config.timeout,
    };
}

// ── forwardProxy 封装 ────────────────────────────────────────────────

interface ForwardResponse {
    body: string;
    status: number;
    contentType: string;
    headers: Record<string, string>;
    elapsed: number;
    url: string;
}

interface ForwardRequest {
    url: string;
    method: string;
    timeout: number;
    contentType: string;
    headers: Record<string, string>[];
    payload: Record<string, unknown>;
    payloadEncoding: "json";
    responseEncoding: "text";
}

function joinUrl(base: string, path: string): string {
    const b = base.replace(/\/+$/, "");
    const p = path.replace(/^\/+/, "");
    return `${b}/${p}`;
}

function safeParse(text: string): unknown {
    try { return JSON.parse(text); } catch { return null; }
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(err: unknown): boolean {
    if (!(err instanceof AIError)) return false;
    if (err.status === 429) return true;
    if (err.status && err.status >= 500) return true;
    const msg = err.message.toLowerCase();
    return msg.includes("timeout") || msg.includes("rate limit");
}

async function forward(
    url: string,
    body: Record<string, unknown>,
    headers: Record<string, string>[],
    timeout: number,
): Promise<ForwardResponse> {
    const req: ForwardRequest = {
        url, method: "POST", timeout,
        contentType: "application/json",
        headers,
        payload: body,
        payloadEncoding: "json",
        responseEncoding: "text",
    };
    const fetchPromise = fetchSyncPost("/api/network/forwardProxy", req);
    const timer = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new AIError(`请求超时（${timeout / 1000}秒）`)), timeout + 5000),
    );
    const resp = await Promise.race([fetchPromise, timer]);
    if (resp.code !== 0) {
        throw new AIError(`forwardProxy 失败: ${resp.msg}`);
    }
    return resp.data as ForwardResponse;
}

function checkHttpOk(fr: ForwardResponse): void {
    if (fr.status < 200 || fr.status >= 300) {
        throw new AIError(`AI HTTP ${fr.status}: ${fr.body.slice(0, 500)}`, fr.status);
    }
}

// ── 认证头 ────────────────────────────────────────────────────────────

function buildAuthHeaders(rc: ResolvedAIConfig): Record<string, string>[] {
    const headers: Record<string, string>[] = [];
    const needAuth = rc.provider !== "ollama" || !!rc.apiKey;
    if (!needAuth || !rc.apiKey) return headers;
    if (rc.protocol === "messages") {
        headers.push({ "x-api-key": rc.apiKey });
        headers.push({ "anthropic-version": "2023-06-01" });
    } else {
        headers.push({ Authorization: `Bearer ${rc.apiKey}` });
    }
    return headers;
}

// ── 协议1: OpenAI Chat Completions ────────────────────────────────────

function extractChatContent(parsed: unknown): string {
    const choices = (parsed as { choices?: Array<{ message?: { content?: string } }> })?.choices;
    const first = choices?.[0]?.message?.content;
    return typeof first === "string" && first.length > 0 ? first : "";
}

async function callChat(rc: ResolvedAIConfig, messages: ChatMessage[], opts: LLMCallOptions): Promise<LLMResult> {
    const url = joinUrl(rc.baseUrl, "chat/completions");
    const body: Record<string, unknown> = {
        model: rc.model,
        messages,
        temperature: opts.temperature ?? rc.temperature,
        max_tokens: opts.maxTokens ?? rc.maxTokens,
        stream: false,
    };
    if (opts.responseFormat) body.response_format = opts.responseFormat;
    const fr = await forward(url, body, buildAuthHeaders(rc), opts.timeout ?? rc.timeout);
    checkHttpOk(fr);
    const parsed = safeParse(fr.body);
    if (parsed === null) throw new AIError("AI 响应非 JSON");
    const content = extractChatContent(parsed);
    if (!content) throw new AIError("AI 响应缺少 content");
    return { content, raw: parsed };
}

// ── 协议2: OpenAI Responses API ───────────────────────────────────────

function toResponsesFormat(rf: unknown): unknown {
    if (!rf) return undefined;
    const r = rf as { type: string; json_schema?: { name: string; schema: object; strict: boolean } };
    if (r.type === "json_schema" && r.json_schema) {
        const { name, schema, strict } = r.json_schema;
        return { type: "json_schema", name, schema, strict };
    }
    return { type: r.type };
}

function extractResponsesContent(parsed: unknown): string {
    const obj = parsed as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    if (obj.output_text) return obj.output_text;
    const text = obj.output?.[0]?.content?.[0]?.text;
    return typeof text === "string" ? text : "";
}

async function callResponses(rc: ResolvedAIConfig, messages: ChatMessage[], opts: LLMCallOptions): Promise<LLMResult> {
    const url = joinUrl(rc.baseUrl, "responses");
    const body: Record<string, unknown> = {
        model: rc.model,
        input: messages,
        temperature: opts.temperature ?? rc.temperature,
        max_output_tokens: opts.maxTokens ?? rc.maxTokens,
    };
    const fmt = toResponsesFormat(opts.responseFormat);
    if (fmt) body.text = { format: fmt };
    const fr = await forward(url, body, buildAuthHeaders(rc), opts.timeout ?? rc.timeout);
    checkHttpOk(fr);
    const parsed = safeParse(fr.body);
    if (parsed === null) throw new AIError("AI 响应非 JSON");
    const content = extractResponsesContent(parsed);
    if (!content) throw new AIError("AI 响应缺少 content");
    return { content, raw: parsed };
}

// ── 协议3: Anthropic Messages API ──────────────────────────────────────

function splitSystem(messages: ChatMessage[]): { system?: string; messages: ChatMessage[] } {
    const systemParts: string[] = [];
    const rest: ChatMessage[] = [];
    for (const m of messages) {
        if (m.role === "system") systemParts.push(m.content);
        else rest.push(m);
    }
    const system = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;
    return { system, messages: rest };
}

function extractMessagesContent(parsed: unknown): string {
    const content = (parsed as { content?: Array<{ type: string; text?: string }> })?.content;
    const textBlock = content?.find((b) => b.type === "text");
    return textBlock?.text ?? "";
}

async function callMessages(rc: ResolvedAIConfig, messages: ChatMessage[], opts: LLMCallOptions): Promise<LLMResult> {
    const url = joinUrl(rc.baseUrl, "messages");
    const { system, messages: apiMessages } = splitSystem(messages);
    const body: Record<string, unknown> = {
        model: rc.model,
        messages: apiMessages,
        max_tokens: opts.maxTokens ?? rc.maxTokens,
        stream: false,
    };
    if (system) body.system = system;
    body.temperature = opts.temperature ?? rc.temperature;
    const fr = await forward(url, body, buildAuthHeaders(rc), opts.timeout ?? rc.timeout);
    checkHttpOk(fr);
    const parsed = safeParse(fr.body);
    if (parsed === null) throw new AIError("AI 响应非 JSON");
    const content = extractMessagesContent(parsed);
    if (!content) throw new AIError("AI 响应缺少 content");
    return { content, raw: parsed };
}

// ── 协议分发（单次调用，不含重试） ────────────────────────────────────

async function callOnce(rc: ResolvedAIConfig, messages: ChatMessage[], opts: LLMCallOptions): Promise<LLMResult> {
    switch (rc.protocol) {
        case "chat": return callChat(rc, messages, opts);
        case "responses": return callResponses(rc, messages, opts);
        case "messages": return callMessages(rc, messages, opts);
    }
}

// ── 统一入口（含指数退避重试） ────────────────────────────────────────

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 3000;

/**
 * 调用 LLM，经思源内核 forwardProxy 转发。
 * 对限流(429)、超时、5xx 自动重试最多 2 次，指数退避。
 * // safe for concurrent calls（无共享状态）
 */
export async function callLLM(
    rc: ResolvedAIConfig,
    messages: ChatMessage[],
    opts: LLMCallOptions = {},
): Promise<LLMResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await callOnce(rc, messages, opts);
        } catch (e) {
            lastError = e;
            if (attempt < MAX_RETRIES && isRetryable(e)) {
                await sleep(RETRY_BASE_MS * (attempt + 1));
                continue;
            }
            throw e;
        }
    }
    throw lastError;
}

/** 测试连接：用指定模型发一条消息验证配置可用。返回 AI 回复内容。失败时抛出错误。 */
export async function testConnection(config: AIConfig, modelId?: string): Promise<string> {
    const rc = resolveAI(config, modelId ?? config.testModelId);
    const prompt = config.testPrompt?.trim() || "请用一句话简要介绍你自己";
    const result = await callLLM(rc, [{ role: "user", content: prompt }], {
        maxTokens: 128, temperature: 0,
    });
    return result.content;
}
