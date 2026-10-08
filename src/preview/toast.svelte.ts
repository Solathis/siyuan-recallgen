/**
 * 预览台的 toast 队列。
 *
 * 思源的 showMessage 会把提示浮在思源窗口里，插件在浏览器里单独跑时它无处可去，
 * 于是所有提示都会静默消失——一旦界面上有「保存成功」「已复制」这类纯提示反馈，
 * 预览就完全看不出来。这里给它们一个可见的去处。
 */

export interface PreviewToast {
    id: number;
    msg: string;
}

let seq = 0;

/** 当前显示的提示。只做增删改查，不整体重新赋值（Svelte 5 不允许导出会被重新赋值的 $state） */
export const toasts = $state<PreviewToast[]>([]);

export function pushToast(msg: string, timeout = 4000): void {
    const id = ++seq;
    toasts.push({ id, msg });
    setTimeout(() => {
        const index = toasts.findIndex((item) => item.id === id);
        if (index >= 0) toasts.splice(index, 1);
    }, timeout);
}

export function clearToasts(): void {
    toasts.length = 0;
}
