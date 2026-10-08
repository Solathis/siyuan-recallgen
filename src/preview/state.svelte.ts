/**
 * 预览台的跨文档共享状态。
 *
 * 画廊在父文档、被预览的组件在同源 iframe 里，两者靠 postMessage 同步。
 *
 * 只有「不改变组件树」的开关走消息：主题、强制移动端、粘贴的主题变量。
 * 「渲染哪一页」与界面语言直接放进 iframe 的 URL——它们会改变组件树，
 * 重载 iframe 比在运行时热切更可靠（尤其 i18n 字典是模块级非响应式的）。
 */

export type PreviewTheme = "light" | "dark";

export const view = $state({
    theme: "light" as PreviewTheme,
    /** 真机不会用到，只在预览里把触摸专属的代码路径逼出来 */
    forceMobile: false,
    /** 当前主题下用户粘贴的思源 --b3-* 变量原文 */
    varsText: "",
});

/** 画廊 → iframe：显示方式 */
export interface PreviewMessage {
    type: "rg-preview";
    theme: PreviewTheme;
    forceMobile: boolean;
    varsText: string;
}

/** iframe → 画廊：当前实际渲染的是哪一屏（用于同步左侧高亮，不触发重载） */
export interface PreviewPageMessage {
    type: "rg-preview-page";
    page: string;
}

export const PREVIEW_MESSAGE_TYPE = "rg-preview";
export const PREVIEW_PAGE_TYPE = "rg-preview-page";

export function isPreviewMessage(data: unknown): data is PreviewMessage {
    return typeof data === "object" && data !== null && (data as { type?: unknown }).type === PREVIEW_MESSAGE_TYPE;
}

export function isPreviewPageMessage(data: unknown): data is PreviewPageMessage {
    return typeof data === "object" && data !== null && (data as { type?: unknown }).type === PREVIEW_PAGE_TYPE;
}
