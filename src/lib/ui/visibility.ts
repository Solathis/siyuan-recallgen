/**
 * 面板可见性判断。
 *
 * 两个面板（答题、闪卡）都把快捷键监听挂在 window 上——用户常常刚点完别处、
 * 焦点并不在面板里，挂在元素上会漏掉大量按键。代价是必须自己判断「这个面板
 * 是不是真的在前台」：思源会把非活动的 tab 留在 DOM 里，不加判断就会出现
 * 「在别的 tab 里按空格/方向键，这边跟着动」。
 *
 * 实现上走祖先的 display/visibility，而不是 `getClientRects()`：
 * 后者依赖布局引擎，jsdom 下恒为空列表，等于让整条按键路径无法写用例
 * （闪卡那三个键盘用例最初就是这么失败的）。而 display/visibility 在
 * 真机与 jsdom 下含义一致，也是思源隐藏非活动 tab 的方式。
 *
 * 两处曾各自实现过一遍（一份用 getClientRects、一份用这个走法），
 * 同一个问题两套答案迟早分叉，所以收在这里。
 */
export function isElementVisible(element: Element | null | undefined): boolean {
    if (!element?.isConnected) return false;
    for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
}
