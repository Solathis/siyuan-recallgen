// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";
import { getDefaultConfig, type RecallGenConfig } from "@/types/config";
import SettingsAI from "./SettingsAI.svelte";

/**
 * 「结构化输出约束」开关的交互回归测试。
 *
 * 这个开关此前反复出问题（点了没反应 / 看不出变化），而 typecheck + 纯函数单测
 * 都覆盖不到它，所以这里真的把组件挂到 jsdom 上点一下。
 */
const MOUNT_TIMEOUT = 60_000;

function mountSettings(config: RecallGenConfig, onsave: (c: RecallGenConfig) => void) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(SettingsAI, { target: host, props: { config, onsave } });
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

function switchEl(host: HTMLElement): HTMLElement {
    const el = host.querySelector<HTMLElement>('[role="switch"]');
    if (!el) throw new Error("没找到结构化输出约束开关（role=switch）");
    return el;
}

/** bits-ui 的按钮用指针事件驱动，只发 click 不一定能触发 */
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
