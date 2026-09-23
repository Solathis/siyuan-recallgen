// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

/**
 * 插件入口冒烟测试。
 *
 * 本环境无法启动思源本体，因此这里退而求其次：
 * 在 jsdom 下真实求值一次插件模块图（浏览器模块加载器加载的是同一份代码），
 * 用来拦住「Svelte 版本升级后组件模块在导入期就抛错」这类只能真机才发现的问题。
 */
describe("插件入口模块", () => {
    it("模块图可被求值，默认导出为插件类", async () => {
        const mod = await import("./index");
        expect(typeof mod.default).toBe("function");
        expect(mod.default.name).toBe("RecallGenPlugin");
    });

    it("插件类带有思源要求的生命周期方法", async () => {
        const mod = await import("./index");
        const proto = mod.default.prototype as unknown as Record<string, unknown>;
        for (const name of ["onload", "onunload", "uninstall"]) {
            expect(typeof proto[name], `缺少 ${name}`).toBe("function");
        }
    });

    it("三个面板组件模块都能在导入期求值", async () => {
        const [quiz, history, setting] = await Promise.all([
            import("./lib/ui/QuizPanel.svelte"),
            import("./lib/ui/HistoryPanel.svelte"),
            import("./lib/ui/SettingPanel.svelte"),
        ]);
        for (const component of [quiz.default, history.default, setting.default]) {
            expect(component).toBeTruthy();
        }
    });
});
