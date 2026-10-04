/**
 * RecallGen i18n 模块。
 * 组件无法直接访问 plugin.i18n，通过 initI18n 注入后用 t() 读取。
 * 并发安全：只读访问注入的字典。
 */

type Dict = Record<string, string>;

let current: Dict = {};
let fallback: Dict = {};

/** 只保留字符串值：思源的词典类型是 JSON 值，非字符串一律丢弃并由 key 兜底 */
function asDict(values: Record<string, unknown> | null | undefined): Dict {
    const out: Dict = {};
    for (const [key, value] of Object.entries(values ?? {})) {
        if (typeof value === "string") out[key] = value;
    }
    return out;
}

/** onload 时调用，注入 SiYuan 自动加载的 i18n 字典 */
export function initI18n(i18nObj: Record<string, unknown>): void {
    current = asDict(i18nObj);
}

/** 设置回退字典（英文） */
export function setFallback(dict: Record<string, unknown>): void {
    fallback = asDict(dict);
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

/**
 * 带兜底取词。
 *
 * 用于「初始值」这类场景：调用发生在 getDefaultConfig() 里，
 * 而字典可能尚未注入（单测、或字典缺键）。此时不能把 key 本身当成文案，
 * 否则默认端点会被命名成 "config.defaultEndpointName" 并被持久化到配置里。
 */
export function tOr(key: string, fallbackText: string): string {
    const value = current[key] ?? fallback[key];
    return typeof value === "string" && value.length > 0 ? value : fallbackText;
}

/**
 * 取插件自带 i18n 字典里的文案。
 *
 * 思源把插件词典声明为 Record<string, JSONValue>，直接当 string 用在新版
 * 类型定义下会报错（值可能是数字/数组）。这里统一判类型并回落到界面文案。
 */
export function localeText(dict: Record<string, unknown> | undefined | null, key: string, fallback: string): string {
    const value = dict?.[key];
    return typeof value === "string" && value.length > 0 ? value : fallback;
}
