import { fetchSyncPost } from "siyuan";
import type { AIConfig } from "@/types/config";

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

/** forwardProxy 返回结构 */
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

function buildAuthHeaders(config: AIConfig): Record<string, string>[] {
    const headers: Record<string, string>[] = [];
    const needAuth = config.provider !== "ollama" || !!config.apiKey;
    if (!needAuth || !config.apiKey) return headers;
    if (config.protocol === "messages") {
        headers.push({ "x-api-key": config.apiKey });
        headers.push({ "anthropic-version": "2023-06-01" });
    } else {
        headers.push({ Authorization: `Bearer ${config.apiKey}` });
    }
    return headers;
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
    const resp = await fetchSyncPost("/api/network/forwardProxy", req);
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

// ── 协议1: OpenAI Chat Completions (/v1/chat/completions) ──────────────

function extractChatContent(parsed: unknown): string {
    const choices = (parsed as { choices?: Array<{ message?: { content?: string } }> })?.choices;
    const first = choices?.[0]?.message?.content;
    return typeof first === "string" && first.length > 0 ? first : "";
}

async function callChat(config: AIConfig, messages: ChatMessage[], opts: LLMCallOptions): Promise<LLMResult> {
    const url = joinUrl(config.baseUrl, "chat/completions");
    const body: Record<string, unknown> = {
        model: config.model,
        messages,
        temperature: opts.temperature ?? config.temperature,
        max_tokens: opts.maxTokens ?? config.maxTokens,
        stream: false,
    };
    if (opts.responseFormat) body.response_format = opts.responseFormat;
    const fr = await forward(url, body, buildAuthHeaders(config), opts.timeout ?? config.timeout);
    checkHttpOk(fr);
    const parsed = safeParse(fr.body);
    if (parsed === null) throw new AIError("AI 响应非 JSON");
    const content = extractChatContent(parsed);
    if (!content) throw new AIError("AI 响应缺少 content");
    return { content, raw: parsed };
}

// ── 协议2: OpenAI Responses API (/v1/responses) ───────────────────────

/** 将 chat 格式的 response_format 转为 responses 格式的 text.format */
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

async function callResponses(config: AIConfig, messages: ChatMessage[], opts: LLMCallOptions): Promise<LLMResult> {
    const url = joinUrl(config.baseUrl, "responses");
    const body: Record<string, unknown> = {
        model: config.model,
        input: messages,
        temperature: opts.temperature ?? config.temperature,
        max_output_tokens: opts.maxTokens ?? config.maxTokens,
    };
    const fmt = toResponsesFormat(opts.responseFormat);
    if (fmt) body.text = { format: fmt };
    const fr = await forward(url, body, buildAuthHeaders(config), opts.timeout ?? config.timeout);
    checkHttpOk(fr);
    const parsed = safeParse(fr.body);
    if (parsed === null) throw new AIError("AI 响应非 JSON");
    const content = extractResponsesContent(parsed);
    if (!content) throw new AIError("AI 响应缺少 content");
    return { content, raw: parsed };
}

// ── 协议3: Anthropic Messages API (/v1/messages) ──────────────────────

/** 从 messages 中抽取 system 消息并合并为顶层 system 字段 */
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

async function callMessages(config: AIConfig, messages: ChatMessage[], opts: LLMCallOptions): Promise<LLMResult> {
    const url = joinUrl(config.baseUrl, "messages");
    const { system, messages: apiMessages } = splitSystem(messages);
    const body: Record<string, unknown> = {
        model: config.model,
        messages: apiMessages,
        max_tokens: opts.maxTokens ?? config.maxTokens,
        stream: false,
    };
    if (system) body.system = system;
    body.temperature = opts.temperature ?? config.temperature;
    // Anthropic 无原生 response_format，靠 prompt + jsonrepair 兜底
    const fr = await forward(url, body, buildAuthHeaders(config), opts.timeout ?? config.timeout);
    checkHttpOk(fr);
    const parsed = safeParse(fr.body);
    if (parsed === null) throw new AIError("AI 响应非 JSON");
    const content = extractMessagesContent(parsed);
    if (!content) throw new AIError("AI 响应缺少 content");
    return { content, raw: parsed };
}

// ── 统一入口 ──────────────────────────────────────────────────────────

/**
 * 调用 LLM，经思源内核 forwardProxy 转发。
 * 按 config.protocol 分发到对应协议处理器。
 */
export async function callLLM(
    config: AIConfig,
    messages: ChatMessage[],
    opts: LLMCallOptions = {},
): Promise<LLMResult> {
    switch (config.protocol) {
        case "chat": return callChat(config, messages, opts);
        case "responses": return callResponses(config, messages, opts);
        case "messages": return callMessages(config, messages, opts);
    }
}

/** 测试连接：发一条用户自定义消息验证配置可用 */
export async function testConnection(config: AIConfig): Promise<boolean> {
    const prompt = config.testPrompt?.trim() || "ping";
    try {
        await callLLM(config, [{ role: "user", content: prompt }], {
            maxTokens: 16, temperature: 0,
        });
        return true;
    } catch { return false; }
}
