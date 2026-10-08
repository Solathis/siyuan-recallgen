/**
 * 预览台专用的 `siyuan` 包替身。
 *
 * 思源把 `siyuan` 作为外部依赖注入，包里只有类型没有实现；插件在浏览器里
 * 单独跑时，任何 `import { showMessage } from "siyuan"` 都会解析失败。
 * 预览配置把这个裸导入指到这里。
 *
 * 与单测用的替身（src/test/siyuan-stub.ts）的区别只在提示的去处：
 * 这里的 showMessage / confirm 会把内容送进预览台的 toast 区，看得见。
 */

import { pushToast } from "./toast.svelte";

export type { IWebSocketData } from "../test/siyuan-stub";
export { fetchSyncPost, fetchPost, getFrontend, openTab, getAllEditor, Plugin } from "../test/siyuan-stub";

export function showMessage(msg: string, timeout = 4000): void {
    pushToast(msg, Math.min(timeout, 8000));
}

/**
 * 二次确认。
 * 浏览器里的 confirm() 会阻塞整个页面、且预览台是自动化观察的对象，
 * 因此这里直接按「确认」继续，并在 toast 里留痕，避免误以为操作没生效。
 */
export function confirm(title: string, text: string, yes?: () => void, no?: () => void): void {
    pushToast(`[预览自动确认] ${title}｜${text}`);
    yes?.();
    void no;
}

/** 这些宿主类在预览里没有行为，占位即可 */
export class Dialog {}
export class Menu {}
export class Setting {}
