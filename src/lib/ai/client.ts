import { fetchSyncPost } from "siyuan";
import { t } from "@/lib/i18n";
import type { AIConfig, AIProvider, AIProtocol } from "@/types/config";

/**
 * AI 调用错误类别。
 * 用类别而非消息文本判断是否可重试——原实现匹配英文 "timeout"，
 * 而超时消息是中文「请求超时」，导致超时永远不会重试。
 */
export type AIErrorKind = "http" | "timeout" | "network" | "parse" | "config" | "truncated" | "aborted";

/** AI 调用错误，附带类别与 HTTP 状态便于上层区分 */
export class AIError extends Error {
    constructor(
        message: string,
        readonly status?: number,
        readonly kind: AIErrorKind = "http",
        /**
         * 出错时模型/服务端返回的原文。
         * 解析类失败（尤其是截断）只看一句「缺少 questions 数组」无法排查，
         * 把原文带上后界面可以展开给用户看、也方便复制出来反馈。
         */
        readonly raw?: string
    ) {
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
    /** tools/function calling 声明（优先于 responseFormat） */
    tools?: unknown[];
    /** 工具选择策略，默认 "auto" */
    toolChoice?: unknown;
    /** 结构化输出约束（当 tools 未使用时） */
    responseFormat?: unknown;
    /**
     * 取消信号。
     * 说明：内核 forwardProxy 一旦发出就无法真正撤回，这里的取消是「停止等待」——
     * 不再重试、不再发起后续批次，从而避免用户点了取消却仍在持续消耗 token。
     */
    signal?: AbortSignal;
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
    if (!model) throw new AIError(t("ai.modelNotFound", modelId), undefined, "config");
    const endpoint = config.endpoints.find((e) => e.id === model.endpointId);
    if (!endpoint) {
        throw new AIError(t("ai.endpointNotFound", model.name, model.endpointId), undefined, "config");
    }
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
    /** 与内核 NetworkForwardData 对齐：同名响应头会出现多次 */
    headers: Record<string, string[] | null> | null;
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

/** 拼接 baseUrl 与路径，容忍两侧多余斜杠 */
export function joinUrl(base: string, path: string): string {
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

/** 已取消：调用方通常直接忽略，不当作错误展示 */
export function isAbortError(error: unknown): boolean {
    return error instanceof AIError && error.kind === "aborted";
}

function abortError(): AIError {
    return new AIError(t("ai.aborted"), undefined, "aborted");
}

/** 可被取消的等待：退避期间点了取消应当立刻结束，而不是睡满 6 秒再发下一次 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (!signal) return new Promise((r) => setTimeout(r, ms));
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(abortError());
            return;
        }
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * 是否值得重试：限流、服务端错误、超时、网络层失败。
 * 4xx（除 429）属于请求本身有问题，重试没有意义。
 */
export function isRetryable(err: unknown): boolean {
    if (!(err instanceof AIError)) return false;
    if (err.kind === "aborted") return false;
    if (err.status === 429) return true;
    if (typeof err.status === "number" && err.status >= 500) return true;
    return err.kind === "timeout" || err.kind === "network";
}

/** 向内核 forwardProxy 发起一次请求，带独立超时看门狗 */
async function forward(
    url: string,
    body: Record<string, unknown>,
    headers: Record<string, string>[],
    timeout: number,
    signal?: AbortSignal
): Promise<ForwardResponse> {
    if (signal?.aborted) throw abortError();

    const req: ForwardRequest = {
        url,
        method: "POST",
        timeout,
        contentType: "application/json",
        headers,
        payload: body,
        payloadEncoding: "json",
        responseEncoding: "text",
    };

    // 请求体由 JSON 可序列化的字面量拼成，这里收口成一次断言：
    // 官方 NetworkForwardRequestInput.payload 要求 JSONValue，而 body 是动态构造的
    const fetchPromise = fetchSyncPost("/api/network/forwardProxy", req as never);
    // 超时后底层请求仍可能失败，提前挂一个兜底 catch，避免未捕获的 Promise 拒绝
    void fetchPromise.catch(() => undefined);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const watchdog = new Promise<never>((_, reject) => {
        timer = setTimeout(
            () => reject(new AIError(t("ai.timeout", String(timeout / 1000)), undefined, "timeout")),
            timeout + 5000
        );
    });

    // 取消信号：内核请求无法真正撤回，但可以不再等它——否则取消后仍会串行发完剩余批次
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
        if (!signal) return;
        onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort, { once: true });
    });

    let resp: Awaited<typeof fetchPromise>;
    try {
        resp = await Promise.race([fetchPromise, watchdog, aborted]);
    } finally {
        // 必须清理看门狗与中止监听：否则请求成功后定时器仍会 reject，产生未捕获拒绝并拖住事件循环
        clearTimeout(timer);
        if (onAbort) signal?.removeEventListener("abort", onAbort);
    }

    if (resp.code !== 0) {
        throw new AIError(t("ai.proxyFailed", resp.msg), undefined, "network");
    }

    // 只做类型断言是不够的：内核在异常路径上可能给出 data=null，
    // 后续读 status/body 会抛原始 TypeError，用户看到的是无意义的堆栈
    const data = resp.data as Partial<ForwardResponse> | null | undefined;
    if (!data || typeof data !== "object" || typeof data.status !== "number" || typeof data.body !== "string") {
        throw new AIError(t("ai.proxyBadResponse"), undefined, "parse");
    }
    return data as ForwardResponse;
}

function checkHttpOk(fr: ForwardResponse): void {
    if (fr.status < 200 || fr.status >= 300) {
        throw new AIError(`AI HTTP ${fr.status}: ${fr.body.slice(0, 500)}`, fr.status, "http", fr.body);
    }
}

/**
 * 输出被截断时抛出可操作的错误。
 *
 * 不检测的话，被截断的 JSON 会被 jsonrepair「修」成一个看似合法的残缺对象
 * （例如 `{"questions":` 变成 `{questions:null}`），用户只会看到
 * 「AI 返回缺少 questions 数组」，完全猜不到真正原因是 maxTokens 不够。
 */
function checkNotTruncated(parsed: unknown): void {
    const reason = readStopReason(parsed);
    if (reason === "length" || reason === "max_tokens") {
        throw new AIError(t("ai.truncated"), undefined, "truncated");
    }
}

/** 读取各协议表示「停止原因」的字段：chat 用 finish_reason，responses 用 status，messages 用 stop_reason */
function readStopReason(parsed: unknown): string | undefined {
    if (!parsed || typeof parsed !== "object") return undefined;
    const obj = parsed as {
        choices?: Array<{ finish_reason?: unknown }>;
        status?: unknown;
        incomplete_details?: unknown;
        stop_reason?: unknown;
    };
    const finish = obj.choices?.[0]?.finish_reason;
    if (typeof finish === "string") return finish;
    const stop = obj.stop_reason;
    if (typeof stop === "string") return stop;
    // responses 协议：status=incomplete 且 incomplete_details.reason=max_output_tokens
    if (obj.status === "incomplete" && obj.incomplete_details) return "length";
    return undefined;
}

// ── 认证头 ────────────────────────────────────────────────────────────

function buildAuthHeaders(rc: ResolvedAIConfig): Record<string, string>[] {
    const headers: Record<string, string>[] = [];
    // 无 API Key 时不发认证头（Ollama 及未配置鉴权的自建服务）
    if (!rc.apiKey) return headers;
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
    const choices = (
        parsed as {
            choices?: Array<{
                message?: {
                    content?: string;
                    tool_calls?: Array<{ function?: { arguments?: unknown } }>;
                };
            }>;
        }
    )?.choices;
    const msg = choices?.[0]?.message;
    if (!msg) return "";
    // 优先从 tool_calls 提取（function calling 模式）
    const toolArgs = msg.tool_calls?.[0]?.function?.arguments;
    if (typeof toolArgs === "string" && toolArgs.length > 0) return toolArgs;
    // 少数 OpenAI 兼容网关会把 arguments 直接给成对象（不做字符串化），这里补一层
    if (toolArgs && typeof toolArgs === "object") return JSON.stringify(toolArgs);
    // 回退到 content
    return typeof msg.content === "string" && msg.content.length > 0 ? msg.content : "";
}

async function callChat(rc: ResolvedAIConfig, messages: ChatMessage[], opts: LLMCallOptions): Promise<LLMResult> {
    const url = joinUrl(rc.baseUrl, "chat/completions");
    const body: Record<string, unknown> = {
        model: rc.model,
        messages,
        temperature: opts.temperature ?? rc.temperature,
        stream: false,
    };
    const maxTokens = opts.maxTokens ?? rc.maxTokens;
    // maxTokens 为 0 表示「由 API 决定」，不发送 max_tokens 让服务端用模型默认值
    if (maxTokens > 0) body.max_tokens = maxTokens;
    if (opts.tools) {
        body.tools = opts.tools;
        body.tool_choice = opts.toolChoice ?? "auto";
    } else if (opts.responseFormat) {
        body.response_format = opts.responseFormat;
    }
    const fr = await forward(url, body, buildAuthHeaders(rc), opts.timeout ?? rc.timeout, opts.signal);
    checkHttpOk(fr);
    const parsed = safeParse(fr.body);
    if (parsed === null) throw new AIError(t("ai.responseNotJson"), undefined, "parse");
    checkNotTruncated(parsed);
    const content = extractChatContent(parsed);
    if (!content) throw new AIError(t("ai.responseNoContent"), undefined, "parse");
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

/**
 * 把 chat 风格的 tools 声明映射成 Responses API 的 text.format。
 *
 * 原实现只读 responseFormat，而上层在开启 JSON Schema 时传的是 tools，
 * 于是 Responses 协议实际上拿不到任何结构化约束（只剩提示词里的一句「按 JSON 输出」）。
 * 用 text.format 的 json_schema 而不是 tools：后者会让模型去「调用函数」，
 * 返回值形态与这里解析文本的方式不一致。
 */
function toolsToResponsesFormat(tools: unknown): unknown {
    const first = Array.isArray(tools) ? (tools[0] as { function?: { name?: string; parameters?: object } }) : null;
    const fn = first?.function;
    if (!fn || typeof fn.name !== "string" || !fn.parameters) return undefined;
    return { type: "json_schema", name: fn.name, schema: fn.parameters, strict: false };
}

function extractResponsesContent(parsed: unknown): string {
    const obj = parsed as {
        output_text?: string;
        output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    };
    if (typeof obj.output_text === "string" && obj.output_text.length > 0) return obj.output_text;

    // 逐项查找第一个文本块：推理模型的 output[0] 往往是 reasoning 项，
    // 只看 output[0].content[0] 会把正文整段漏掉
    for (const item of obj.output ?? []) {
        for (const block of item?.content ?? []) {
            if (typeof block?.text === "string" && block.text.length > 0) return block.text;
        }
    }
    return "";
}

async function callResponses(rc: ResolvedAIConfig, messages: ChatMessage[], opts: LLMCallOptions): Promise<LLMResult> {
    const url = joinUrl(rc.baseUrl, "responses");
    const body: Record<string, unknown> = {
        model: rc.model,
        input: messages,
        temperature: opts.temperature ?? rc.temperature,
    };
    const respMaxTokens = opts.maxTokens ?? rc.maxTokens;
    if (respMaxTokens > 0) body.max_output_tokens = respMaxTokens;
    // 开启 JSON Schema 时上层给的是 tools，这里优先映射成结构化输出格式
    const fmt = toolsToResponsesFormat(opts.tools) ?? toResponsesFormat(opts.responseFormat);
    if (fmt) body.text = { format: fmt };
    const fr = await forward(url, body, buildAuthHeaders(rc), opts.timeout ?? rc.timeout, opts.signal);
    checkHttpOk(fr);
    const parsed = safeParse(fr.body);
    if (parsed === null) throw new AIError(t("ai.responseNotJson"), undefined, "parse");
    checkNotTruncated(parsed);
    const content = extractResponsesContent(parsed);
    if (!content) throw new AIError(t("ai.responseNoContent"), undefined, "parse");
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

/**
 * 把 chat 风格的 tools 声明映射成 Anthropic 的 tools。
 * Anthropic 的结构化输出只能走 tool use，字段名是 input_schema 而不是 parameters。
 */
function toolsToAnthropicTools(tools: unknown): unknown[] | undefined {
    if (!Array.isArray(tools)) return undefined;
    const mapped = tools
        .map((tool) => (tool as { function?: { name?: string; description?: string; parameters?: object } }).function)
        .filter((fn): fn is { name: string; description?: string; parameters?: object } => !!fn && !!fn.name)
        .map((fn) => ({ name: fn.name, description: fn.description, input_schema: fn.parameters ?? {} }));
    return mapped.length > 0 ? mapped : undefined;
}

function extractMessagesContent(parsed: unknown): string {
    const content = (parsed as { content?: Array<{ type: string; text?: string; input?: unknown }> })?.content;
    // 结构化输出：结果在 tool_use 块的 input 里，序列化回 JSON 文本与其它协议保持一致
    const toolUse = content?.find((b) => b.type === "tool_use" && b.input !== undefined);
    if (toolUse) return JSON.stringify(toolUse.input);
    const textBlock = content?.find((b) => b.type === "text");
    return textBlock?.text ?? "";
}

async function callMessages(rc: ResolvedAIConfig, messages: ChatMessage[], opts: LLMCallOptions): Promise<LLMResult> {
    const url = joinUrl(rc.baseUrl, "messages");
    const { system, messages: apiMessages } = splitSystem(messages);
    const body: Record<string, unknown> = {
        model: rc.model,
        messages: apiMessages,
        stream: false,
    };
    const msgMaxTokens = opts.maxTokens ?? rc.maxTokens;
    if (msgMaxTokens > 0) body.max_tokens = msgMaxTokens;
    if (system) body.system = system;
    body.temperature = opts.temperature ?? rc.temperature;
    // 强制调用指定工具：Anthropic 没有 response_format，结构化输出只能靠 tool use
    const anthropicTools = toolsToAnthropicTools(opts.tools);
    if (anthropicTools) {
        body.tools = anthropicTools;
        const name = (anthropicTools[0] as { name: string }).name;
        body.tool_choice = { type: "tool", name };
    }
    const fr = await forward(url, body, buildAuthHeaders(rc), opts.timeout ?? rc.timeout, opts.signal);
    checkHttpOk(fr);
    const parsed = safeParse(fr.body);
    if (parsed === null) throw new AIError(t("ai.responseNotJson"), undefined, "parse");
    checkNotTruncated(parsed);
    const content = extractMessagesContent(parsed);
    if (!content) throw new AIError(t("ai.responseNoContent"), undefined, "parse");
    return { content, raw: parsed };
}

// ── 协议分发（单次调用，不含重试） ────────────────────────────────────

async function callOnce(rc: ResolvedAIConfig, messages: ChatMessage[], opts: LLMCallOptions): Promise<LLMResult> {
    switch (rc.protocol) {
        case "chat":
            return callChat(rc, messages, opts);
        case "responses":
            return callResponses(rc, messages, opts);
        case "messages":
            return callMessages(rc, messages, opts);
    }
}

// ── 统一入口（含指数退避重试） ────────────────────────────────────────

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 3000;

/**
 * 调用 LLM，经思源内核 forwardProxy 转发。
 * 对限流(429)、5xx、超时、网络层失败自动重试最多 2 次，退避 3s、6s（指数）。
 * 其余 4xx 属于请求本身有问题，不重试，直接抛出。
 * 无共享状态，可并发调用。
 */
export async function callLLM(
    rc: ResolvedAIConfig,
    messages: ChatMessage[],
    opts: LLMCallOptions = {}
): Promise<LLMResult> {
    const signal = opts.signal;
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (signal?.aborted) throw abortError();
        try {
            return await callOnce(rc, messages, opts);
        } catch (e) {
            lastError = e;
            // 取消不是「可重试的失败」：直接结束，否则取消后还会再发两次
            if (isAbortError(e) || signal?.aborted) throw abortError();
            if (attempt < MAX_RETRIES && isRetryable(e)) {
                await sleep(RETRY_BASE_MS * 2 ** attempt, signal);
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
    const prompt = config.testPrompt?.trim() || t("ai.testPromptDefault");
    const result = await callLLM(rc, [{ role: "user", content: prompt }], {
        maxTokens: 128,
        temperature: 0,
    });
    return result.content;
}
