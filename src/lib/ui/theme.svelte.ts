/**
 * 主题信号。
 *
 * 思源通过给 body 加/去 `.theme-dark` 切换明暗主题，且没有对外事件，
 * 因此这里用 MutationObserver 把它转成可响应的信号，供图表等需要按主题取色的组件使用。
 *
 * 写成 .svelte.ts 是为了能在模块里使用 $state：组件中读取 isDarkTheme()
 * 会建立响应式依赖，主题切换时相关派生值会自动重算。
 */

let dark = $state(false);
let observer: MutationObserver | null = null;

function readTheme(): boolean {
    if (typeof document === "undefined") return false;
    const siyuanMode = (window as unknown as { siyuan?: { config?: { appearance?: { mode?: number } } } }).siyuan
        ?.config?.appearance?.mode;
    if (typeof siyuanMode === "number") return siyuanMode === 1;
    return document.body.classList.contains("theme-dark");
}

function sync(): void {
    dark = readTheme();
}

/** 当前是否暗色主题（可响应式读取） */
export function isDarkTheme(): boolean {
    if (!observer && typeof document !== "undefined") {
        sync();
        observer = new MutationObserver(sync);
        observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }
    return dark;
}

/** 停止监听（插件卸载时调用） */
export function stopThemeSync(): void {
    observer?.disconnect();
    observer = null;
}

/**
 * 从插件容器上读取主题相关颜色。
 * 图表不能直接用 Tailwind 类，因此把 CSS 变量解析成具体色值交给 ECharts。
 */
export interface ChartPalette {
    text: string;
    axis: string;
    grid: string;
    primary: string;
    success: string;
    warning: string;
    destructive: string;
    surface: string;
}

export function chartPalette(element: HTMLElement | null): ChartPalette {
    const styles = element ? getComputedStyle(element) : getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
    return {
        text: read("--color-foreground", "#333"),
        axis: read("--color-muted-foreground", "#888"),
        grid: read("--color-border", "#ddd"),
        primary: read("--color-primary", "#3575f0"),
        success: read("--color-success", "#65a84c"),
        warning: read("--color-warning", "#d97706"),
        destructive: read("--color-destructive", "#d23f31"),
        surface: read("--color-card", "#fff"),
    };
}
