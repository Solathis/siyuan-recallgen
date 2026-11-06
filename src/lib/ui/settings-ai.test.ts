// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";
import { getDefaultConfig, type RecallGenConfig } from "@/types/config";
import type { QuizService } from "../quiz/service";
import type { CatalogModel } from "../ai/providers/models";
import SettingsAI from "./SettingsAI.svelte";

/**
 * 「结构化输出约束」开关的交互回归测试。
 *
 * 这个开关此前反复出问题（点了没反应 / 看不出变化），而 typecheck + 纯函数单测
 * 都覆盖不到它，所以这里真的把组件挂到 jsdom 上点一下。
 */
const MOUNT_TIMEOUT = 60_000;

function mountSettings(
    config: RecallGenConfig,
    onsave: (c: RecallGenConfig) => void,
    service?: Pick<
        QuizService,
        "getProviderCatalog" | "refreshProviderCatalog" | "testConnection" | "detectProviderModels"
    >
) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(SettingsAI, { target: host, props: { config, onsave, service } });
    flushSync();
    return {
        host,
        destroy() {
            unmount(app);
            host.remove();
        },
    };
}

it("连接测试的结果区域是 live region,读屏能播报成功或失败(回归:结果出现时无声)", { timeout: MOUNT_TIMEOUT }, () => {
    const { host, destroy } = mountSettings(getDefaultConfig(), () => {});
    const status = host.querySelector<HTMLElement>('[role="status"][aria-live="polite"]');
    expect(status, "连接测试的状态行应为 role=status 且 aria-live=polite").toBeTruthy();
    expect(status!.querySelector("button")).toBeTruthy();
    destroy();
});

describe("自定义端点模型探测", () => {
    function customConfig(): RecallGenConfig {
        const config = getDefaultConfig();
        config.ai.endpoints = [
            {
                id: "custom-ep",
                name: "Custom",
                provider: "openai",
                protocol: "chat",
                baseUrl: "https://api.example.test/v1",
                apiKey: "secret",
            },
        ];
        config.ai.models = [
            {
                id: "existing-model",
                name: "existing-model",
                endpointId: "custom-ep",
                temperature: 0.3,
                maxTokens: 2048,
            },
        ];
        return config;
    }

    function detectButton(host: HTMLElement): HTMLButtonElement {
        const found = host.querySelector<HTMLButtonElement>("[data-detect-custom-models]");
        if (!found) throw new Error("没找到自定义端点探测按钮");
        return found;
    }

    function serviceFor(
        detectProviderModels: QuizService["detectProviderModels"]
    ): Pick<QuizService, "getProviderCatalog" | "refreshProviderCatalog" | "testConnection" | "detectProviderModels"> {
        return {
            getProviderCatalog: async () => {
                throw new Error("unused");
            },
            refreshProviderCatalog: async () => {
                throw new Error("unused");
            },
            testConnection: async () => "unused",
            detectProviderModels,
        };
    }

    it("快速接入默认折叠", { timeout: MOUNT_TIMEOUT }, () => {
        const { host, destroy } = mountSettings(getDefaultConfig(), () => {});
        try {
            expect(host.querySelector('section button[aria-expanded="false"]')).toBeTruthy();
        } finally {
            destroy();
        }
    });

    it("探测到的模型可选择新增，并按模型目录填入参数且保留已有配置", { timeout: MOUNT_TIMEOUT }, async () => {
        const config = customConfig();
        const info = {
            id: "new-model",
            name: "New Model",
            family: "test",
            release: "2025-01-01",
            updated: "2025-01-01",
            toolCall: true,
            reasoning: false,
            temperature: false,
            attachment: false,
            temperatureRange: null,
            knowledge: null,
            context: 100000,
            output: 8192,
            cost: null,
            modalities: { input: ["text"], output: ["text"] },
            openWeights: false,
            status: "",
            textIn: true,
            textOut: true,
        } as CatalogModel;
        const detectProviderModels = vi.fn(async () => ({
            models: [
                { id: "existing-model", info: null },
                { id: "new-model", info },
            ],
            specsFrom: "models.dev" as const,
        }));
        const onsave = vi.fn();
        const service = serviceFor(detectProviderModels);
        const { host, destroy } = mountSettings(config, onsave, service);
        try {
            detectButton(host).click();
            await vi.waitFor(() => expect(host.textContent).toContain("new-model"));
            expect(host.querySelectorAll('[role="checkbox"]')).toHaveLength(1);
            press(host.querySelector<HTMLButtonElement>("[data-add-selected-models]")!);

            const saved = onsave.mock.calls.at(-1)?.[0] as RecallGenConfig;
            expect(saved.ai.models).toHaveLength(2);
            expect(saved.ai.models[0]).toMatchObject({ temperature: 0.3, maxTokens: 2048 });
            expect(saved.ai.models[1]).toMatchObject({
                name: "new-model",
                endpointId: "custom-ep",
                temperature: 0.7,
                maxTokens: 8192,
                fixedTemperature: true,
            });
        } finally {
            destroy();
        }
    });

    it("模型名称改为已探测模型时自动填入参数", { timeout: MOUNT_TIMEOUT }, async () => {
        const config = customConfig();
        const info = {
            id: "known-model",
            name: "Known Model",
            release: "2025-01-01",
            updated: "2025-01-01",
            reasoning: false,
            toolCall: false,
            temperature: true,
            textOut: true,
            context: 100000,
            output: 4096,
            status: "",
        } satisfies CatalogModel;
        const detectProviderModels = vi.fn(async () => ({
            models: [{ id: "known-model", info }],
            specsFrom: "snapshot" as const,
        }));
        const onsave = vi.fn();
        const service = serviceFor(detectProviderModels);
        const { host, destroy } = mountSettings(config, onsave, service);
        try {
            detectButton(host).click();
            await vi.waitFor(() => expect(host.textContent).toContain("known-model"));
            const name = host.querySelector<HTMLInputElement>('input[aria-label="模型名称"]')!;
            name.value = "known-model";
            name.dispatchEvent(new Event("change", { bubbles: true }));
            flushSync();
            const saved = onsave.mock.calls.at(-1)?.[0] as RecallGenConfig;
            expect(saved.ai.models[0]).toMatchObject({ name: "known-model", maxTokens: 4096, fixedTemperature: false });
        } finally {
            destroy();
        }
    });

    it("探测失败时显示错误且不改配置", { timeout: MOUNT_TIMEOUT }, async () => {
        const config = customConfig();
        const detectProviderModels = vi.fn(async () => {
            throw new Error("invalid API key");
        });
        const onsave = vi.fn();
        const service = serviceFor(detectProviderModels);
        const { host, destroy } = mountSettings(config, onsave, service);
        try {
            detectButton(host).click();
            await vi.waitFor(() =>
                expect(host.querySelector('[role="alert"]')?.textContent).toContain("invalid API key")
            );
            expect(onsave).not.toHaveBeenCalled();
        } finally {
            destroy();
        }
    });
});

function switchEl(host: HTMLElement): HTMLElement {
    const el = host.querySelector<HTMLElement>('[role="switch"]');
    if (!el) throw new Error("没找到结构化输出约束开关（role=switch）");
    return el;
}

function press(el: HTMLElement): void {
    el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flushSync();
}

describe("设置页 · 结构化输出约束开关", () => {
    it("默认配置里它是开启的", () => {
        expect(getDefaultConfig().ai.jsonSchemaEnabled).toBe(true);
    });

    it("渲染出来是开关（role=switch）而不是复选框，且反映当前取值", { timeout: MOUNT_TIMEOUT }, () => {
        const config = getDefaultConfig();
        config.ai.jsonSchemaEnabled = true;
        const { host, destroy } = mountSettings(config, () => {});
        try {
            const sw = switchEl(host);
            expect(sw.tagName).toBe("BUTTON");
            expect(host.querySelector('input[type="checkbox"]')).toBeNull();
            expect(sw.getAttribute("aria-checked")).toBe("true");
        } finally {
            destroy();
        }
    });

    it("点击可以关闭，再点可以开启，并且每次都回调 onsave", { timeout: MOUNT_TIMEOUT }, () => {
        const config = getDefaultConfig();
        config.ai.jsonSchemaEnabled = true;
        const onsave = vi.fn();
        const { host, destroy } = mountSettings(config, onsave);
        try {
            press(switchEl(host));
            expect(onsave).toHaveBeenCalledTimes(1);
            expect(onsave.mock.calls[0][0].ai.jsonSchemaEnabled).toBe(false);

            press(switchEl(host));
            expect(onsave).toHaveBeenCalledTimes(2);
            expect(onsave.mock.calls[1][0].ai.jsonSchemaEnabled).toBe(true);
        } finally {
            destroy();
        }
    });

    it("父组件把新配置传回来后，开关外观跟着变", { timeout: MOUNT_TIMEOUT }, () => {
        const config = getDefaultConfig();
        config.ai.jsonSchemaEnabled = false;
        let current = config;
        const { host, destroy } = mountSettings(config, (next) => {
            current = next;
        });
        try {
            expect(switchEl(host).getAttribute("aria-checked")).toBe("false");
            press(switchEl(host));
            expect(current.ai.jsonSchemaEnabled).toBe(true);
        } finally {
            destroy();
        }
    });

    it("切换开关不会顺手改动 AI 配置里的其它字段", { timeout: MOUNT_TIMEOUT }, () => {
        const config = getDefaultConfig();
        config.ai.timeout = 12_345;
        const onsave = vi.fn();
        const { host, destroy } = mountSettings(config, onsave);
        try {
            press(switchEl(host));
            const next = onsave.mock.calls[0][0] as RecallGenConfig;
            expect(next.ai.timeout).toBe(12_345);
            expect(next.ai.endpoints).toHaveLength(config.ai.endpoints.length);
            expect(next.ai.models).toHaveLength(config.ai.models.length);
        } finally {
            destroy();
        }
    });
});
