import { describe, expect, it, vi } from "vitest";
import { StorageError, type StoragePlugin } from "./store";
import { ConfigStore } from "./config";
import { getDefaultConfig } from "@/types/config";

function fakePlugin(initial: unknown = null) {
    let stored = initial;
    const saveData = vi.fn(async (_name: string, content: unknown) => {
        stored = content;
    });
    const plugin: StoragePlugin = {
        loadData: async () => stored,
        saveData,
    };
    return { plugin, saveData, getStored: () => stored as Record<string, unknown> };
}

describe("ConfigStore.load / get", () => {
    it("无文件时返回完整默认配置", async () => {
        const { plugin } = fakePlugin(null);
        const config = await new ConfigStore(plugin).load();
        expect(config.general.difficulty.total).toBe(15);
        expect(config.ai.endpoints.length).toBeGreaterThan(0);
    });

    it("用默认值补齐缺失字段", async () => {
        const { plugin } = fakePlugin({ general: { language: "en" } });
        const config = await new ConfigStore(plugin).load();
        expect(config.general.language).toBe("en");
        expect(config.general.countdownMinutes).toBe(30);
    });

    it("未 load 时 get() 返回默认配置而不是抛错", () => {
        const { plugin } = fakePlugin(null);
        expect(new ConfigStore(plugin).get().general.difficulty.total).toBe(15);
    });

    it("load 后 get() 返回已加载配置", async () => {
        const { plugin } = fakePlugin({ general: { panelWidth: 900 } });
        const store = new ConfigStore(plugin);
        await store.load();
        expect(store.get().general.panelWidth).toBe(900);
    });
});

describe("ConfigStore.set", () => {
    it("局部 patch 合并且 get() 立即反映新值", async () => {
        const { plugin } = fakePlugin(null);
        const store = new ConfigStore(plugin);
        await store.load();
        void store.set({ general: { panelWidth: 1200 } });
        expect(store.get().general.panelWidth).toBe(1200);
        // 其他字段保持不变
        expect(store.get().general.countdownMinutes).toBe(30);
    });

    it("prompts 与 heatmap 按字段合并而不是整体替换", async () => {
        const { plugin } = fakePlugin(null);
        const store = new ConfigStore(plugin);
        await store.load();
        await store.set({ prompts: { analysis: "自定义分析提示词" } }, { immediate: true });
        expect(store.get().prompts.analysis).toBe("自定义分析提示词");
        expect(store.get().prompts.generate).toBe(getDefaultConfig().prompts.generate);
    });

    it("immediate 写入立即落盘", async () => {
        const { plugin, saveData, getStored } = fakePlugin(null);
        const store = new ConfigStore(plugin);
        await store.load();
        await store.set({ general: { panelWidth: 800 } }, { immediate: true });
        expect(saveData).toHaveBeenCalledTimes(1);
        expect((getStored().general as { panelWidth: number }).panelWidth).toBe(800);
    });

    it("默认合并写入：窗口内多次修改只落盘一次且写最后一次", async () => {
        const { plugin, saveData, getStored } = fakePlugin(null);
        const store = new ConfigStore(plugin);
        await store.load();
        saveData.mockClear();
        vi.useFakeTimers();
        try {
            const p1 = store.set({ general: { panelWidth: 700 } });
            const p2 = store.set({ general: { panelWidth: 800 } });
            const p3 = store.set({ general: { panelWidth: 900 } });
            await vi.advanceTimersByTimeAsync(500);
            await Promise.all([p1, p2, p3]);
            expect(saveData).toHaveBeenCalledTimes(1);
            expect((getStored().general as { panelWidth: number }).panelWidth).toBe(900);
        } finally {
            vi.useRealTimers();
        }
    });

    it("写盘失败时 set() 的 Promise 会拒绝（回归：原实现 void 掉错误）", async () => {
        const plugin: StoragePlugin = {
            loadData: async () => null,
            saveData: async () => {
                throw new Error("磁盘已满");
            },
        };
        const store = new ConfigStore(plugin);
        await store.load();
        await expect(store.set({ general: { panelWidth: 700 } }, { immediate: true })).rejects.toBeInstanceOf(
            StorageError
        );
    });

    it("flushDeferred 可在卸载前强制落盘最后一次修改", async () => {
        const { plugin, getStored } = fakePlugin(null);
        const store = new ConfigStore(plugin);
        await store.load();
        vi.useFakeTimers();
        try {
            void store.set({ general: { panelWidth: 1234 } });
            await store.flushDeferred();
            expect((getStored().general as { panelWidth: number }).panelWidth).toBe(1234);
        } finally {
            vi.useRealTimers();
        }
    });

    it("未 load 直接 set 也能工作（以默认配置为基线）", async () => {
        const { plugin, getStored } = fakePlugin(null);
        const store = new ConfigStore(plugin);
        await store.set({ general: { panelWidth: 640 } }, { immediate: true });
        expect((getStored().general as { panelWidth: number }).panelWidth).toBe(640);
        expect((getStored().general as { countdownMinutes: number }).countdownMinutes).toBe(30);
    });
});

describe("磁盘配置的逐字段校验", () => {
    it("磁盘上被改坏的字段不会流进出题逻辑（回归：只做浅合并）", async () => {
        const plugin: import("./store").StoragePlugin = {
            loadData: async () => ({
                general: { allowedTypes: "coding", difficulty: null, countdownMinutes: "很久" },
                ai: { endpoints: "不是数组", models: [] },
                prompts: { generate: 42 },
                heatmap: { ranges: [{ min: 0, max: 100, color: "red;color:red" }] },
            }),
            saveData: async () => undefined,
        };
        const store = new ConfigStore(plugin);
        const config = await store.load();

        // 非法值回落到默认，而不是原样带着走
        expect(Array.isArray(config.general.allowedTypes)).toBe(true);
        expect(config.general.allowedTypes.length).toBeGreaterThan(0);
        expect(typeof config.general.difficulty).toBe("object");
        expect(typeof config.general.countdownMinutes).toBe("number");
        expect(Array.isArray(config.ai.endpoints)).toBe(true);
        expect(typeof config.prompts.generate).toBe("string");
        expect(config.heatmap.ranges.every((r) => typeof r.color === "string")).toBe(true);
    });

    it("合法的磁盘配置保持原值", async () => {
        const plugin: import("./store").StoragePlugin = {
            loadData: async () => ({
                general: { countdownMinutes: 42, language: "en" },
            }),
            saveData: async () => undefined,
        };
        const config = await new ConfigStore(plugin).load();
        expect(config.general.countdownMinutes).toBe(42);
        expect(config.general.language).toBe("en");
    });
});
