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
    /** OpenAI 风格的 response_format 约束；undefined 表示不约束 */
    responseFormat?: unknown;
}

export interface LLMResult {
    content: string;
    raw: unknown;
}

/** forwardProxy 返回结构（与思源 IResForwardProxy 一致） */
interface ForwardResponse {
    body: string;
    status: number;
    contentType: string;
    headers: Record<string, string>;
    elapsed: number;
    url: string;
}

/** forwardProxy 请求体：headers 为单键对象数组 */
interface ForwardRequest {
    url: string;
    method: string;
    timeout: number;
    contentType: string;
    headers: Record<string, string>[];
    payload: string;
    payloadEncoding: "text";
    responseEncoding: "text";
}

/** 拼接 baseUrl 与路径，处理末尾斜杠 */
function joinUrl(base: string, path: string): string {
    const b = base.replace(/\/+$/, "");
    const p = path.replace(/^\/+/, "");
    return `${b}/${p}`;
}

function safeParse(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/** 从 OpenAI 兼容响应中提取 message.content */
function extractContent(parsed: unknown): string {
    const choices = (parsed as { choices?: Array<{ message?: { content?: string } }> })?.choices;
    const first = choices?.[0]?.message?.content;
    if (typeof first === "string" && first.length > 0) {
        return first;
    }
    return "";
}

async function forward(
    targetUrl: string,
    bodyStr: string,
    headers: Record<string, string>[],
    timeout: number,
): Promise<ForwardResponse> {
    const req: ForwardRequest = {
        url: targetUrl,
        method: "POST",
        timeout,
        contentType: "application/json",
        headers,
        payload: bodyStr,
        payloadEncoding: "text",
        responseEncoding: "text",
    };
    const resp = await fetchSyncPost("/api/network/forwardProxy", req);
    if (resp.code !== 0) {
        throw new AIError(`forwardProxy 失败: ${resp.msg}`);
    }
    return resp.data as ForwardResponse;
}

/**
 * 调用 LLM Chat Completions（OpenAI 兼容协议，覆盖 openai/ollama/custom）。
 * 经思源内核 forwardProxy 转发，规避浏览器 CORS，API Key 不进入前端网络栈。
 */
export async function callLLM(
    config: AIConfig,
    messages: ChatMessage[],
    opts: LLMCallOptions = {},
): Promise<LLMResult> {
    const url = joinUrl(config.baseUrl, "chat/completions");
    const body = {
        model: config.model,
        messages,
        temperature: opts.temperature ?? config.temperature,
        max_tokens: opts.maxTokens ?? config.maxTokens,
        stream: false,
        ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
    };
    const headers: Record<string, string>[] = [];
    // Ollama 无 key 时不下发 Authorization
    if (config.apiKey) {
        headers.push({ Authorization: `Bearer ${config.apiKey}` });
    }
    const timeout = opts.timeout ?? config.timeout;
    const fr = await forward(url, JSON.stringify(body), headers, timeout);

    if (fr.status < 200 || fr.status >= 300) {
        throw new AIError(`AI HTTP ${fr.status}: ${fr.body.slice(0, 500)}`, fr.status);
    }
    const parsed = safeParse(fr.body);
    if (parsed === null) {
        throw new AIError("AI 响应非 JSON");
    }
    const content = extractContent(parsed);
    if (!content) {
        throw new AIError("AI 响应缺少 content");
    }
    return { content, raw: parsed };
}

/** 测试连接：发一条极简消息验证配置可用 */
export async function testConnection(config: AIConfig): Promise<string> {
    const result = await callLLM(config, [{ role: "user", content: "ping" }], {
        maxTokens: 8,
        temperature: 0,
    });
    return result.content;
}
