// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Custom } from "siyuan";

/**
 * 插件生命周期集成测试。
 *
 * 在 jsdom 下真实执行 onload，并手动驱动 addTab 注册的 init/destroy，
 * 用来守住两条只能真机才发现的规则：
 * - tab 关闭时必须真正 unmount（否则组件里的 window 监听与 effect 会一直泄漏）
 * - 面板容器必须带 rg-scope（插件的收窄 preflight 与公式样式都挂在它下面）
 */
const TIMEOUT = 60_000;

/**
 * 构造插件实例。
 * `siyuan` 只提供类型，真实的 Plugin 构造函数签名要求宿主选项，
 * 测试里没有必要逐一伪造，因此统一收口成宽松类型。
 */
type PluginCtor = new (options: unknown) => LifecyclePlugin;

interface LifecyclePlugin {
    onload: () => Promise<void>;
    onunload: () => Promise<void>;
    tabs: Array<{ type: string; init: unknown; destroy: unknown }>;
    topBars: unknown[];
    commands: unknown[];
    icons: string[];
}

async function createPlugin(): Promise<LifecyclePlugin> {
    const mod = (await import("./index")) as unknown as { default: PluginCtor };
    return new mod.default({ name: "siyuan-recallgen", displayName: "RecallGen" });
}

/** 按 type 取出 addTab 注册项 */
function tabOf(plugin: unknown, type: string) {
    const tabs = (plugin as { tabs: Array<{ type: string }> }).tabs;
    const found = tabs.find((tab) => tab.type === type);
    if (!found) throw new Error(`未注册 tab: ${type}`);
    return found as unknown as {
        init: (this: Custom) => void;
        destroy: (this: Custom) => void;
    };
}

function fakeTabContext(data: unknown): { ctx: Custom; element: HTMLElement } {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const ctx = {
        element,
        data,
        tab: { close: () => undefined },
    } as unknown as Custom;
    return { ctx, element };
}

describe("插件生命周期", () => {
    it("onload 注册 tab/顶栏/命令与图标", { timeout: TIMEOUT }, async () => {
        const plugin = await createPlugin();
        await plugin.onload();
        const types = plugin.tabs.map((tab) => tab.type);
        expect(types).toContain("quiz");
        expect(types).toContain("history");
        expect(plugin.topBars).toHaveLength(1);
        expect(plugin.commands.length).toBeGreaterThan(0);
        expect(plugin.icons.length).toBe(1);
        await plugin.onunload();
    });

    it("答题 tab 容器带 rg-scope，并在 destroy 时真正卸载", { timeout: TIMEOUT }, async () => {
        const plugin = await createPlugin();
        await plugin.onload();

        // 题库为空 → 直接进入空态，不触发任何网络请求
        const { ctx, element } = fakeTabContext({ mode: "reviewDue", sourceDocId: "", sourceTitle: "" });
        const tab = tabOf(plugin, "quiz");
        tab.init.call(ctx);
        const scope = element.querySelector(".rg-scope");
        expect(scope).not.toBeNull();
        expect(scope!.childElementCount).toBeGreaterThan(0);

        tab.destroy.call(ctx);
        // 容器本身由我们创建，保留即可；关键是 Svelte 挂载的子树必须被摘掉。
        // 之前只调 beforeDestroy、不 unmount，这里仍会留着整棵子树。
        expect(scope!.childElementCount).toBe(0);

        await plugin.onunload();
    });

    it("历史 tab 容器同样带 rg-scope，destroy 后清空", { timeout: TIMEOUT }, async () => {
        const plugin = await createPlugin();
        await plugin.onload();

        const { ctx, element } = fakeTabContext(undefined);
        const tab = tabOf(plugin, "history");
        tab.init.call(ctx);
        const scope = element.querySelector(".rg-scope");
        expect(scope).not.toBeNull();
        expect(scope!.childElementCount).toBeGreaterThan(0);

        tab.destroy.call(ctx);
        expect(scope!.childElementCount).toBe(0);

        await plugin.onunload();
    });

    it("onunload 后再次 onload 不报错（插件重载安全）", { timeout: TIMEOUT }, async () => {
        const plugin = await createPlugin();
        await plugin.onload();
        await plugin.onunload();
        await expect(plugin.onload()).resolves.toBeUndefined();
        await plugin.onunload();
    });
});
