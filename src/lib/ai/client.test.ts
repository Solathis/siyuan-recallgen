import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetFetchSyncPost, __setFetchSyncPost, type IWebSocketData } from "@/test/siyuan-stub";
import { AIError, callLLM, isAbortError, isRetryable, joinUrl, resolveAI, type ResolvedAIConfig } from "./client";
import { DEFAULT_AI_CONFIG, getDefaultConfig } from "@/types/config";

const rc = (over: Partial<ResolvedAIConfig> = {}): ResolvedAIConfig => ({
    provider: "openai",
    protocol: "chat",
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxTokens: 1024,
    timeout: 1000,
    ...over,
});

/** 构造 forwardProxy 成功响应 */
const proxyOk = (body: unknown, status = 200): IWebSocketData => ({
    code: 0,
    msg: "",
    data: {
        body: typeof body === "string" ? body : JSON.stringify(body),
        status,
        contentType: "application/json",
        headers: {},
        elapsed: 1,
        url: "",
    },
});

/** 捕获请求体的 handler 工厂 */
function recordingHandler(respond: (call: number) => IWebSocketData) {
    const calls: Array<{ url: string; data: any }> = [];
    __setFetchSyncPost((url, data) => {
        calls.push({ url, data });
        return respond(calls.length);
    });
    return calls;
}

beforeEach(() => {
    __resetFetchSyncPost();
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("joinUrl", () => {
    it("拼接 baseUrl 与路径", () => {
        expect(joinUrl("https://a.com/v1", "chat/completions")).toBe("https://a.com/v1/chat/completions");
    });

    it("容忍 baseUrl 末尾多余斜杠", () => {
        expect(joinUrl("https://a.com/v1///", "chat/completions")).toBe("https://a.com/v1/chat/completions");
    });

    it("容忍路径开头多余斜杠", () => {
        expect(joinUrl("https://a.com/v1", "/chat/completions")).toBe("https://a.com/v1/chat/completions");
    });

    it("baseUrl 为空时不产生异常路径", () => {
        expect(joinUrl("", "/responses")).toBe("/responses");
    });
});

describe("isRetryable", () => {
    it("限流 429 可重试", () => {
        expect(isRetryable(new AIError("x", 429))).toBe(true);
    });

    it("5xx 可重试", () => {
        expect(isRetryable(new AIError("x", 500))).toBe(true);
        expect(isRetryable(new AIError("x", 503))).toBe(true);
    });

    it("其余 4xx 不可重试", () => {
        expect(isRetryable(new AIError("x", 400))).toBe(false);
        expect(isRetryable(new AIError("x", 401))).toBe(false);
        expect(isRetryable(new AIError("x", 404))).toBe(false);
    });

    it("超时可重试（按类别判断，不依赖消息文本）", () => {
        expect(isRetryable(new AIError("请求超时（120秒）", undefined, "timeout"))).toBe(true);
    });

    it("网络层失败可重试", () => {
        expect(isRetryable(new AIError("forwardProxy 失败: x", undefined, "network"))).toBe(true);
    });

    it("解析失败与配置错误不可重试", () => {
        expect(isRetryable(new AIError("AI 响应非 JSON", undefined, "parse"))).toBe(false);
        expect(isRetryable(new AIError("未找到模型", undefined, "config"))).toBe(false);
    });

    it("非 AIError 不可重试", () => {
        expect(isRetryable(new Error("timeout"))).toBe(false);
        expect(isRetryable("timeout")).toBe(false);
    });

    it("旧实现依赖英文消息匹配，中文超时消息不会被判为可重试", () => {
        // 保留这条断言解释修复动机：仅凭消息文本判断会漏掉中文超时
        expect("请求超时（120秒）".toLowerCase().includes("timeout")).toBe(false);
    });
});

describe("resolveAI", () => {
    it("解析出扁平调用配置", () => {
        const config = getDefaultConfig();
        const resolved = resolveAI(config.ai, "m-default");
        expect(resolved).toMatchObject({
            protocol: "chat",
            model: "gpt-4o-mini",
            timeout: config.ai.timeout,
        });
    });

    it("模型不存在时抛出 config 类错误", () => {
        const config = getDefaultConfig();
        try {
            resolveAI(config.ai, "m-missing");
            throw new Error("应当抛错");
        } catch (e) {
            expect(e).toBeInstanceOf(AIError);
            expect((e as AIError).kind).toBe("config");
        }
    });

    it("模型引用的端点不存在时抛出 config 类错误", () => {
        const ai = { ...DEFAULT_AI_CONFIG, models: [{ ...DEFAULT_AI_CONFIG.models[0], endpointId: "ep-gone" }] };
        try {
            resolveAI(ai, DEFAULT_AI_CONFIG.models[0].id);
            throw new Error("应当抛错");
        } catch (e) {
            expect((e as AIError).kind).toBe("config");
        }
    });
});

describe("callLLM - 成功路径", () => {
    it("从 chat completions 响应中取出 content", async () => {
        recordingHandler(() => proxyOk({ choices: [{ message: { content: "你好" } }] }));
        const result = await callLLM(rc(), [{ role: "user", content: "hi" }]);
        expect(result.content).toBe("你好");
    });

    it("优先取 tool_calls 的 arguments（function calling 模式）", async () => {
        recordingHandler(() =>
            proxyOk({
                choices: [{ message: { content: "", tool_calls: [{ function: { arguments: '{"questions":[]}' } }] } }],
            })
        );
        const result = await callLLM(rc(), [{ role: "user", content: "hi" }]);
        expect(result.content).toBe('{"questions":[]}');
    });

    it("请求超时看门狗被清理，不留悬挂定时器", async () => {
        recordingHandler(() => proxyOk({ choices: [{ message: { content: "ok" } }] }));
        await callLLM(rc(), [{ role: "user", content: "hi" }]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("请求发往正确的协议路径并带上认证头", async () => {
        const calls = recordingHandler(() => proxyOk({ choices: [{ message: { content: "ok" } }] }));
        await callLLM(rc(), [{ role: "user", content: "hi" }]);
        expect(calls[0].url).toBe("/api/network/forwardProxy");
        expect(calls[0].data.url).toBe("https://api.example.com/v1/chat/completions");
        expect(calls[0].data.headers).toEqual([{ Authorization: "Bearer sk-test" }]);
    });

    it("未配置 API Key 时不发送认证头（Ollama 场景）", async () => {
        const calls = recordingHandler(() => proxyOk({ choices: [{ message: { content: "ok" } }] }));
        await callLLM(rc({ provider: "ollama", apiKey: "" }), [{ role: "user", content: "hi" }]);
        expect(calls[0].data.headers).toEqual([]);
    });

    it("messages 协议使用 x-api-key 与 anthropic-version", async () => {
        const calls = recordingHandler(() => proxyOk({ content: [{ type: "text", text: "ok" }] }));
        await callLLM(rc({ protocol: "messages" }), [{ role: "user", content: "hi" }]);
        expect(calls[0].data.url).toBe("https://api.example.com/v1/messages");
        expect(calls[0].data.headers).toEqual([{ "x-api-key": "sk-test" }, { "anthropic-version": "2023-06-01" }]);
    });

    it("responses 协议路径正确", async () => {
        const calls = recordingHandler(() => proxyOk({ output_text: "ok" }));
        const result = await callLLM(rc({ protocol: "responses" }), [{ role: "user", content: "hi" }]);
        expect(calls[0].data.url).toBe("https://api.example.com/v1/responses");
        expect(result.content).toBe("ok");
    });
});

describe("callLLM - 重试策略", () => {
    it("429 后重试并最终成功", async () => {
        const calls = recordingHandler((n) =>
            n === 1 ? proxyOk("rate limited", 429) : proxyOk({ choices: [{ message: { content: "ok" } }] })
        );
        const promise = callLLM(rc(), [{ role: "user", content: "hi" }]);
        await vi.advanceTimersByTimeAsync(3000);
        await expect(promise).resolves.toMatchObject({ content: "ok" });
        expect(calls).toHaveLength(2);
    });

    it("指数退避间隔为 3s、6s", async () => {
        const calls = recordingHandler(() => proxyOk("boom", 503));
        const promise = callLLM(rc(), [{ role: "user", content: "hi" }]);
        promise.catch(() => undefined);

        await vi.advanceTimersByTimeAsync(2999);
        expect(calls).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(calls).toHaveLength(2);

        await vi.advanceTimersByTimeAsync(5999);
        expect(calls).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(calls).toHaveLength(3);

        await expect(promise).rejects.toThrow(/HTTP 503/);
    });

    it("总计尝试 3 次后放弃", async () => {
        const calls = recordingHandler(() => proxyOk("boom", 500));
        const promise = callLLM(rc(), [{ role: "user", content: "hi" }]);
        promise.catch(() => undefined);
        await vi.advanceTimersByTimeAsync(3000 + 6000);
        await expect(promise).rejects.toThrow(/HTTP 500/);
        expect(calls).toHaveLength(3);
    });

    it("400 不重试，立即抛错", async () => {
        const calls = recordingHandler(() => proxyOk("bad request", 400));
        await expect(callLLM(rc(), [{ role: "user", content: "hi" }])).rejects.toThrow(/HTTP 400/);
        expect(calls).toHaveLength(1);
    });

    it("401 不重试，立即抛错", async () => {
        const calls = recordingHandler(() => proxyOk("unauthorized", 401));
        await expect(callLLM(rc(), [{ role: "user", content: "hi" }])).rejects.toThrow(/HTTP 401/);
        expect(calls).toHaveLength(1);
    });

    it("forwardProxy 返回非 0 code 时归类为 network 并重试", async () => {
        const calls = recordingHandler(() => ({ code: -1, msg: "内核代理异常", data: null }));
        const promise = callLLM(rc(), [{ role: "user", content: "hi" }]);
        promise.catch(() => undefined);
        await vi.advanceTimersByTimeAsync(3000 + 6000);
        await expect(promise).rejects.toThrow(/内核网络代理失败/);
        expect(calls).toHaveLength(3);
    });
});

describe("callLLM - 超时", () => {
    it("看门狗在 timeout+5s 触发，归类为 timeout 并重试至耗尽", async () => {
        // 超时属于可重试错误，因此一次 callLLM 会做 3 次尝试：
        // 6000 → 退避 3000 → 6000(第2次起点 9000，看门狗 15000) → 退避 6000 → 27000 结束
        const calls = recordingHandler(() => new Promise(() => {}) as never);
        const promise = callLLM(rc({ timeout: 1000 }), [{ role: "user", content: "hi" }]);
        promise.catch(() => undefined);

        await vi.advanceTimersByTimeAsync(5999);
        expect(calls).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        // 第一次尝试在看门狗触发后失败，此时尚未发起第二次请求
        expect(calls).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(3000);
        expect(calls).toHaveLength(2);

        await vi.advanceTimersByTimeAsync(27000);
        await expect(promise).rejects.toMatchObject({ kind: "timeout" });
        expect(calls).toHaveLength(3);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe("callLLM - 响应异常", () => {
    it("响应体不是 JSON 时抛出 parse 类错误", async () => {
        recordingHandler(() => proxyOk("这不是 JSON", 200));
        await expect(callLLM(rc(), [{ role: "user", content: "hi" }])).rejects.toMatchObject({ kind: "parse" });
    });

    it("响应缺少 content 时抛出 parse 类错误", async () => {
        recordingHandler(() => proxyOk({ choices: [{ message: { content: "" } }] }));
        await expect(callLLM(rc(), [{ role: "user", content: "hi" }])).rejects.toMatchObject({ kind: "parse" });
    });

    it("HTTP 错误消息包含响应体片段便于排查", async () => {
        recordingHandler(() => proxyOk({ error: "模型不存在" }, 404));
        await expect(callLLM(rc(), [{ role: "user", content: "hi" }])).rejects.toThrow(/模型不存在/);
    });
});

describe("响应结构校验", () => {
    const messages = [{ role: "user" as const, content: "hi" }];

    it("代理返回 data=null 时给出可读错误，而不是 TypeError", async () => {
        __setFetchSyncPost(() => ({ code: 0, msg: "", data: null }));
        await expect(callLLM(rc(), messages, {})).rejects.toMatchObject({
            name: "AIError",
            kind: "parse",
        });
    });

    it("代理返回结构残缺（缺 body/status）时同样给出可读错误", async () => {
        __setFetchSyncPost(() => ({ code: 0, msg: "", data: { status: 200 } }));
        await expect(callLLM(rc(), messages, {})).rejects.toMatchObject({ name: "AIError", kind: "parse" });
    });
});

describe("输出截断检测", () => {
    const messages = [{ role: "user" as const, content: "hi" }];

    it("chat 协议 finish_reason=length 时抛出 truncated 而不是让 jsonrepair 蒙混过去", async () => {
        recordingHandler(() =>
            proxyOk({
                choices: [{ message: { content: '{"questions":' }, finish_reason: "length" }],
            })
        );
        await expect(callLLM(rc(), messages, {})).rejects.toMatchObject({ kind: "truncated" });
    });

    it("messages 协议 stop_reason=max_tokens 同样被识别", async () => {
        recordingHandler(() => proxyOk({ content: [{ type: "text", text: "{}" }], stop_reason: "max_tokens" }));
        await expect(callLLM(rc({ protocol: "messages" }), messages, {})).rejects.toMatchObject({
            kind: "truncated",
        });
    });

    it("responses 协议 status=incomplete 同样被识别", async () => {
        recordingHandler(() =>
            proxyOk({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] })
        );
        await expect(callLLM(rc({ protocol: "responses" }), messages, {})).rejects.toMatchObject({
            kind: "truncated",
        });
    });

    it("正常结束时不受影响", async () => {
        recordingHandler(() => proxyOk({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
        await expect(callLLM(rc(), messages, {})).resolves.toMatchObject({ content: "ok" });
    });
});

describe("responses 协议正文提取", () => {
    const messages = [{ role: "user" as const, content: "hi" }];

    it("首项是 reasoning 项时不会漏掉后面的正文（推理模型的常见形态）", async () => {
        recordingHandler(() =>
            proxyOk({
                output: [
                    { type: "reasoning", content: [{ type: "summary_text", text: "" }] },
                    { type: "message", content: [{ type: "output_text", text: '{"questions":[]}' }] },
                ],
            })
        );
        const result = await callLLM(rc({ protocol: "responses" }), messages, {});
        expect(result.content).toBe('{"questions":[]}');
    });
});

describe("取消（AbortSignal）", () => {
    const messages = [{ role: "user" as const, content: "hi" }];

    it("调用前已取消则直接抛 aborted，不发请求", async () => {
        let called = 0;
        recordingHandler(() => {
            called++;
            return proxyOk({ choices: [{ message: { content: "ok" } }] });
        });
        const ctrl = new AbortController();
        ctrl.abort();
        await expect(callLLM(rc(), messages, { signal: ctrl.signal })).rejects.toMatchObject({ kind: "aborted" });
        expect(called).toBe(0);
    });

    it("等待响应期间取消会立刻结束，而不是等到超时", async () => {
        let resolveResponse: (() => void) | null = null;
        __setFetchSyncPost(
            () =>
                new Promise<IWebSocketData>((resolve) => {
                    resolveResponse = () => resolve(proxyOk({ choices: [{ message: { content: "ok" } }] }));
                })
        );
        const ctrl = new AbortController();
        const pending = callLLM(rc({ timeout: 60_000 }), messages, { signal: ctrl.signal });
        const assertion = expect(pending).rejects.toMatchObject({ kind: "aborted" });
        ctrl.abort();
        await assertion;
        // 内核请求仍在途，这里只是不再等待它
        resolveResponse?.();
    });

    it("退避等待期间取消也会立刻结束（不会睡满 3 秒再发下一次）", async () => {
        let calls = 0;
        recordingHandler(() => {
            calls++;
            // 429 会触发重试
            return {
                code: 0,
                msg: "",
                data: { body: "rate limited", status: 429, contentType: "", headers: null, elapsed: 1, url: "" },
            };
        });
        const ctrl = new AbortController();
        const pending = callLLM(rc(), messages, { signal: ctrl.signal });
        const assertion = expect(pending).rejects.toMatchObject({ kind: "aborted" });
        await vi.advanceTimersByTimeAsync(10);
        expect(calls).toBe(1);
        ctrl.abort();
        await assertion;
        // 取消后没有再发第二次
        await vi.advanceTimersByTimeAsync(10_000);
        expect(calls).toBe(1);
    });

    it("取消不会被当成可重试错误", () => {
        expect(isRetryable(new AIError("x", undefined, "aborted"))).toBe(false);
    });

    it("isAbortError 只认取消类错误", () => {
        expect(isAbortError(new AIError("x", undefined, "aborted"))).toBe(true);
        expect(isAbortError(new AIError("x", undefined, "timeout"))).toBe(false);
        expect(isAbortError(new Error("x"))).toBe(false);
    });
});
