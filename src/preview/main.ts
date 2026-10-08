/**
 * 预览台入口。
 *
 * 两种模式共用同一份代码：
 * - 画廊模式（默认）：左侧选页 + 右侧 iframe，带宽度拉杆与主题开关；
 * - 内嵌模式（?embed=1&page=...&lang=...）：iframe 里只渲染某一屏，无外框。
 *
 * 语言走 URL 而不是运行时热切：i18n 字典是模块级、非响应式的，运行时换语言
 * 需要让整棵组件树重建才能生效，直接重载 iframe 更简单也更不容易出错。
 */
import { mount } from "svelte";

import "@/app.css";
import "./mock-theme.css";
import "./chrome.css";

import { initI18n, setFallback } from "@/lib/i18n";

import EmbedStage from "./EmbedStage.svelte";
import Gallery from "./Gallery.svelte";
import { DEFAULT_PAGE_KEY, asPageKey } from "./pages";
import { isPreviewMessage, view } from "./state.svelte";

/**
 * 词典走 public 目录的运行时请求，而不是 `import` 那个 JSON。
 * Vite 对「从 JS import public 里的文件」会给出警告（public 的语义是按原样拷贝、
 * 用 URL 引用），而思源本身也是把插件目录下的 i18n JSON 当数据文件读的，
 * 用请求更贴近真实链路，顺带把开发日志里的警告清掉。
 */
async function loadDict(path: string): Promise<Record<string, unknown>> {
    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as Record<string, unknown>;
    } catch (error) {
        console.warn(`[preview] 词典加载失败：${path}`, error);
        return {};
    }
}

const params = new URLSearchParams(location.search);
const embed = params.get("embed") === "1";
const lang: "zh" | "en" = params.get("lang") === "en" ? "en" : "zh";

// 必须早于任何组件初始化：getDefaultConfig() 之类会在取值时读词典
const [zh, en] = await Promise.all([loadDict("/i18n/zh-CN.json"), loadDict("/i18n/en.json")]);
initI18n(lang === "en" ? en : zh);
setFallback(en);
document.documentElement.lang = lang === "en" ? "en" : "zh-CN";

const target = document.getElementById("app");
if (!target) throw new Error("preview: #app 容器不存在");

if (embed) {
    /*
     * 主题、触摸开关、粘贴的主题变量都从父文档来。
     * 这里只写进共享状态，实际应用由 EmbedStage 的 $effect 负责——
     * 消息可能在挂载之前就到了，放在这里直接操作 DOM 会与随后的 effect 打架。
     */
    window.addEventListener("message", (event: MessageEvent) => {
        if (!isPreviewMessage(event.data)) return;
        view.theme = event.data.theme;
        view.forceMobile = event.data.forceMobile;
        view.varsText = event.data.varsText;
    });

    mount(EmbedStage, {
        target,
        props: {
            page: asPageKey(params.get("page") ?? DEFAULT_PAGE_KEY),
            scoreId: params.get("score") ?? undefined,
        },
    });
} else {
    mount(Gallery, { target });
}
