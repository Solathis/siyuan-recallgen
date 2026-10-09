// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isElementVisible } from "./visibility";

/**
 * 这两个面板把快捷键挂在 window 上，靠这个函数判断自己是否在前台。
 * jsdom 没有布局引擎，getClientRects() 恒为空——因此实现不能依赖它，
 * 否则「面板不可见就不响应按键」这条规则在真机上测不到、在测试里写不出。
 */
function mount(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    return host;
}

describe("isElementVisible", () => {
    it("普通挂载的元素可见", () => {
        const host = mount('<div id="a"><button>x</button></div>');
        expect(isElementVisible(host.querySelector("#a"))).toBe(true);
        document.body.removeChild(host);
    });

    it("自身 display:none 不可见", () => {
        const host = mount('<div id="a" style="display:none">x</div>');
        expect(isElementVisible(host.querySelector("#a"))).toBe(false);
        document.body.removeChild(host);
    });

    it("祖先 display:none 也不可见（思源隐藏非活动 tab 的方式）", () => {
        const host = mount('<div id="outer" style="display:none"><div id="inner"><button>x</button></div></div>');
        expect(isElementVisible(host.querySelector("#inner"))).toBe(false);
        expect(isElementVisible(host.querySelector("button"))).toBe(false);
        document.body.removeChild(host);
    });

    it("祖先 visibility:hidden 也不可见", () => {
        const host = mount('<div id="outer" style="visibility:hidden"><div id="inner">x</div></div>');
        expect(isElementVisible(host.querySelector("#inner"))).toBe(false);
        document.body.removeChild(host);
    });

    it("已脱离文档的元素不可见", () => {
        const orphan = document.createElement("div");
        expect(isElementVisible(orphan)).toBe(false);
        expect(isElementVisible(null)).toBe(false);
        expect(isElementVisible(undefined)).toBe(false);
    });
});
