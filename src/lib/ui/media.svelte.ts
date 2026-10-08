/**
 * 设备相关的判定（触摸、减少动态效果）。
 *
 * 布局自适应一律走容器查询（Tailwind v4 的 `@container` 与 `@md:` 变体），
 * 因为插件的可用宽度与视口宽度无关：思源的 tab 可以很窄，设置弹窗永远比视口窄，
 * 用 `md:` 这类视口断点判断「是不是该收成单栏」从根上就是错的。
 *
 * 这里只放容器宽度判断不出来的东西——指针是不是触摸、要不要放大触摸目标、
 * 底部要不要留安全区——这些取决于设备本身。
 *
 * 预览台需要在不换设备的前提下看到移动端表现，所以留了一个可注入的覆盖值；
 * 真机运行时它始终是 null。
 */

let forcedMobile = $state<boolean | null>(null);

/** 预览台用：强制走移动端路径；传 null 恢复按真实设备判断 */
export function setForcedMobile(value: boolean | null): void {
    forcedMobile = value;
}

function matches(query: string): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
}

/**
 * 是否按触摸设备渲染。
 * 触摸设备没有 hover：纯 hover 交互会永远不出现，触摸目标也要放大。
 */
export function useTouchLayout(): boolean {
    if (forcedMobile !== null) return forcedMobile;
    return matches("(pointer: coarse)");
}

/** 是否按移动端渲染。仅用于少数「容器宽度也判断不出」的路径 */
export function useMobileLayout(): boolean {
    if (forcedMobile !== null) return forcedMobile;
    return matches("(pointer: coarse)") || matches("(max-width: 640px)");
}

/**
 * 系统是否要求减少动态效果。
 * 纯 CSS 的动画由 app.css 里的 media 查询处理，这里给需要改判断逻辑的地方用。
 */
export function useReducedMotion(): boolean {
    return matches("(prefers-reduced-motion: reduce)");
}
