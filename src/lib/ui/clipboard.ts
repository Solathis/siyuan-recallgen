/**
 * 复制文本到剪贴板。
 *
 * 思源是桌面端为主，Electron 下 navigator.clipboard 在非安全上下文里可能不可用，
 * 因此保留 execCommand 兜底；两条路都失败时返回 false，由调用方提示用户手动选择。
 */
export async function copyText(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        /* 落到兜底实现 */
    }
    return legacyCopy(text);
}

/** execCommand 兜底：临时插入一个只读 textarea 并选中复制 */
export function legacyCopy(text: string): boolean {
    let area: HTMLTextAreaElement | null = null;
    try {
        area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.top = "-1000px";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        return document.execCommand("copy");
    } catch {
        return false;
    } finally {
        // 必须无条件清理：execCommand 抛错时若留在 DOM 里，
        // 思源文档中就会永久残留一个隐藏 textarea
        area?.remove();
    }
}
