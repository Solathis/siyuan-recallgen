/**
 * 文本导出文件的下载。
 *
 * 此前四段导出逻辑各写了一遍 Blob + <a download> + revoke，
 * 并且都在 a.click() 之后同步 revoke：click() 只是发起下载，
 * 浏览器尚未读取 blob，Firefox 会因此取消下载。这里统一延迟释放。
 */

/** 触发一次文本文件下载 */
export function downloadText(filename: string, content: string, mime: string): void {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.click();
    // 延迟释放：立即 revoke 会打断尚未开始的下载
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 导出文件名使用的日期戳 YYYY-MM-DD（本地时区） */
export function exportStamp(date = new Date()): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
