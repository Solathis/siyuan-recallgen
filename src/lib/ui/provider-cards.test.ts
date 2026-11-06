// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";
import { getDefaultConfig, type RecallGenConfig } from "@/types/config";
import { PROVIDER_PRESETS, SNAPSHOT_CATALOG } from "../ai/providers/catalog";
import { pickDefaultModel } from "../ai/providers/models";
import { PROVIDER_ICONS } from "./provider-icons";
import ProviderCards from "./ProviderCards.svelte";

const MOUNT_TIMEOUT = 60_000;

function render(config: RecallGenConfig, onsave = vi.fn(), testConnection = vi.fn(async () => "ok")) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const service = {
        getProviderCatalog: async () => SNAPSHOT_CATALOG,
        refreshProviderCatalog: async () => SNAPSHOT_CATALOG,
        testConnection,
        detectProviderModels: async () => ({ models: [], specsFrom: "snapshot" as const }),
    };
    const app = mount(ProviderCards, { target: host, props: { config, onsave, service } });
    flushSync();
    return {
        host,
        onsave,
        testConnection,
        /** 动作按钮按完整文字找：卡片徽标「未接入」里也含「接入」两个字 */
        button: (text: string) =>
            [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text),
        card: (name: string) =>
            [...host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find((b) =>
                b.textContent?.includes(name)
            ),
        destroy() {
            unmount(app);
            host.remove();
        },
    };
}

function typeKey(host: HTMLElement, value: string): void {
    const input = host.querySelector<HTMLInputElement>("#rg-provider-key")!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
}

describe("服务商快速接入", () => {
    it("每家目录里的图标都打进了包", () => {
        for (const preset of PROVIDER_PRESETS) expect(PROVIDER_ICONS[preset.icon], preset.id).toBeTruthy();
    });

    it("九张卡片；点开后默认勾选最新的模型；不填 Key 不能接入", { timeout: MOUNT_TIMEOUT }, () => {
        const view = render(getDefaultConfig());
        expect(view.button("展开")).toBeTruthy();
        view.button("展开")!.click();
        flushSync();
        expect(view.host.querySelectorAll("button[data-provider-card][aria-expanded]")).toHaveLength(
            PROVIDER_PRESETS.length
        );
        view.card("DeepSeek")!.click();
        flushSync();
        const latest = pickDefaultModel(SNAPSHOT_CATALOG.models.deepseek)!.id;
        const pressed = [...view.host.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.textContent);
        expect(pressed.some((text) => text?.includes(latest))).toBe(true);
        expect(view.button("接入")!.disabled).toBe(true);
        view.destroy();
    });

    it("填 Key 点接入：端点带上 presetId，出题/审题/判分改指向最新模型", { timeout: MOUNT_TIMEOUT }, () => {
        const view = render(getDefaultConfig());
        view.card("DeepSeek")!.click();
        flushSync();
        typeKey(view.host, "key-1");
        view.button("接入")!.click();
        expect(view.onsave).toHaveBeenCalledTimes(1);
        const saved = view.onsave.mock.calls[0][0] as RecallGenConfig;
        const endpoint = saved.ai.endpoints.find((e) => e.presetId === "deepseek")!;
        expect(endpoint).toMatchObject({ apiKey: "key-1", baseUrl: "https://api.deepseek.com" });
        const model = saved.ai.models.find((m) => m.id === saved.ai.roles.generator)!;
        expect(model.endpointId).toBe(endpoint.id);
        expect(model.name).toBe(pickDefaultModel(SNAPSHOT_CATALOG.models.deepseek)!.id);
        view.destroy();
    });

    it("测试连接用草稿配置，不先保存", { timeout: MOUNT_TIMEOUT }, async () => {
        const view = render(getDefaultConfig());
        view.card("Kimi")!.click();
        flushSync();
        typeKey(view.host, "key-2");
        view.button("测试连接")!.click();
        await vi.waitFor(() => expect(view.testConnection).toHaveBeenCalled());
        const [draft, modelId] = view.testConnection.mock.calls[0] as unknown as [RecallGenConfig["ai"], string];
        expect(draft.endpoints.some((e) => e.presetId === "kimi" && e.apiKey === "key-2")).toBe(true);
        expect(draft.models.find((m) => m.id === modelId)?.fixedTemperature).toBe(true);
        expect(view.onsave).not.toHaveBeenCalled();
        view.destroy();
    });

    it("华为云没有内置模型：手动添加模型名后才能接入", { timeout: MOUNT_TIMEOUT }, () => {
        const view = render(getDefaultConfig());
        view.card("华为云")!.click();
        flushSync();
        typeKey(view.host, "key-3");
        expect(view.button("接入")!.disabled).toBe(true);
        const custom = view.host.querySelector<HTMLInputElement>('input[aria-label="手动添加模型名"]')!;
        custom.value = "deepseek-v3.1";
        custom.dispatchEvent(new Event("input", { bubbles: true }));
        flushSync();
        view.button("添加")!.click();
        flushSync();
        view.button("接入")!.click();
        const saved = view.onsave.mock.calls[0][0] as RecallGenConfig;
        expect(saved.ai.models.some((m) => m.name === "deepseek-v3.1" && m.endpointId === "preset-huawei")).toBe(true);
        view.destroy();
    });
});
