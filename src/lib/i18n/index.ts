/**
 * RecallGen i18n 模块。
 * 组件无法直接访问 plugin.i18n，通过 initI18n 注入后用 t() 读取。
 * 并发安全：只读访问注入的字典。
 */

type Dict = Record<string, string>;

let current: Dict = {};
let fallback: Dict = {};

/** onload 时调用，注入 SiYuan 自动加载的 i18n 字典 */
export function initI18n(i18nObj: Dict): void {
    current = i18nObj ?? {};
}

/** 设置回退字典（英文） */
export function setFallback(dict: Dict): void {
    fallback = dict;
}

/**
 * 翻译键值。优先 current，其次 fallback，最后返回 key 本身。
 * 支持 {0} {1} 占位符替换；同一占位符出现多次时全部替换。
 */
export function t(key: string, ...args: (string | number)[]): string {
    const template = current[key] ?? fallback[key] ?? key;
    if (args.length === 0) return template;
    return template.replace(/\{(\d+)\}/g, (placeholder, index) => {
        const i = Number(index);
        return i < args.length ? String(args[i]) : placeholder;
    });
}
