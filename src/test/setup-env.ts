import { beforeEach } from "vitest";
import zhCN from "@/../public/i18n/zh-CN.json";
import { initI18n, setFallback } from "@/lib/i18n";

/**
 * 单测共享环境：i18n 词典 + jsdom 缺失的浏览器 API 替身。
 *
 * 词典部分：
 *
 * 既让断言可以比对可读文案（而不是比对 key），
 * 也能捕获「代码引用了字典中不存在的 key」——此时 t() 会原样返回 key，断言随即失败。
 */
beforeEach(() => {
    const dict = zhCN as Record<string, string>;
    initI18n(dict);
    setFallback(dict);
});

/**
 * jsdom 没有 Web Animations API，而 Svelte 5 的过渡（transition:/in:/out:）
 * 无论时长是否为 0，都会先建一个「占位动画」并直接调用 element.animate，
 * 因此在 jsdom 里一挂上带过渡的组件就抛 `element.animate is not a function`。
 *
 * 这里补一个最小实现：立刻把 onfinish 走完，让 Svelte 的过渡状态机正常收尾，
 * 元素落在终态。测试关心的是「元素在不在、文字对不对」，
 * 动效本身不做断言——这样组件可以放心用动效，而不必为了可测性把它删掉。
 */
if (typeof Element !== "undefined" && typeof Element.prototype.animate !== "function") {
    Element.prototype.animate = function animate(this: Element): Animation {
        const animation = {
            onfinish: null as (() => void) | null,
            oncancel: null as (() => void) | null,
            playState: "finished" as const,
            currentTime: 0,
            startTime: 0,
            playbackRate: 1,
            id: "",
            effect: null,
            finished: Promise.resolve(),
            cancel() {},
            finish() {},
            play() {},
            pause() {},
            reverse() {},
            addEventListener() {},
            removeEventListener() {},
            commitStyles() {},
            updatePlaybackRate() {},
            persist() {},
            get ready() {
                return Promise.resolve(this);
            },
        };
        // 异步收尾：与真实动画一致地在当前任务之后结束，避免在渲染中途同步触发回调
        queueMicrotask(() => animation.onfinish?.());
        return animation as unknown as Animation;
    } as Element["animate"];
}

/**
 * jsdom 也没有 ResizeObserver，而 bits-ui 的 Slider 在 $effect 里就要用它
 * （按容器宽度计算滑块位置）。缺了它整个组件在挂载时抛错，
 * 连带把同一个文件里其它用例都打挂——现象是「设置页的五个用例全红」，
 * 看起来像设置页坏了，实际只是测试环境缺一个 API。
 *
 * 这里补一个空实现：位置计算在 jsdom 里本来也没有意义，
 * 但组件能正常挂载、事件回调能跑，断言就能照常写。
 */
/**
 * jsdom 同样没有 window.matchMedia，而 layerchart 在模块顶层就构造了
 * Svelte 的 prefersReducedMotion（它内部要 new MediaQuery）——
 * 一旦有组件 import 了图表，整个模块图在导入期就抛错，
 * 表现为「插件入口 / 生命周期 / 面板」这些不相关的用例一起红。
 *
 * 替身固定返回 matches: false（jsdom 里就按桌面、不减少动效来跑）。
 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
}

if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
    } as unknown as typeof ResizeObserver;
}
