import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 数据属性变体一致性检查。
 *
 * 背景：shadcn（nova 风格）组件用 data-checked: / data-open: / data-horizontal:
 * 这类简写变体，而 Tailwind 会把它们编译成同名属性选择器；bits-ui 输出的却是
 * data-state / data-orientation。两者对不上时样式会静默失效——开关看不出开/关、
 * 分隔线高度 0（整条线消失）、标签页方向不对、弹层动画失效。
 * 这类问题 typecheck 与纯函数单测都拦不住（曾经真的漏到了用户手里），
 * 所以这里从三处交叉核对：
 *   1. 源码里实际用到的变体
 *   2. who 会输出对应的属性（组件自己、或 bits-ui）
 *   3. src/app.css 里有没有对应的搭桥
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BITS_UI_DIST = join(ROOT, "node_modules", "bits-ui", "dist");
const APP_CSS = join(ROOT, "src", "app.css");

/** 把 `data-[size=default]` / `data-checked` 归一成属性名 `data-size` / `data-checked` */
function attrOf(variant: string): string {
    if (variant.startsWith("data-[")) return "data-" + variant.slice(6, -1).split("=")[0].trim();
    return variant;
}

function svelteFiles(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".svelte"))
        .map((e) => join(e.parentPath, e.name));
}

/** 源码里用到的变体（data-xxx: / data-[a=b]:），以及组件自己设置的 data-xxx= */
function scanSources() {
    const used = new Map<string, Set<string>>();
    const selfSet = new Set<string>();
    for (const file of svelteFiles(join(ROOT, "src"))) {
        const text = readFileSync(file, "utf8");
        const re = /(?:([a-zA-Z-]*-))?(data-\[[^\]]+\]|data-[a-zA-Z][\w-]*)/g;
        for (const m of text.matchAll(re)) {
            const prefix = m[1] ?? "";
            const variant = m[2];
            const next = text[m.index + m[0].length];
            if (next === "=") {
                selfSet.add(attrOf(variant));
                continue;
            }
            if (next !== ":" && next !== "/") continue;
            // has- / in- 看的是子孙元素上的属性，由调用方（业务代码）决定，
            // 不属于「本元素的自身状态」这一类，无法在这里核对，跳过。
            if (prefix === "has-" || prefix === "in-") continue;
            if (!used.has(variant)) used.set(variant, new Set());
            used.get(variant)!.add(file.slice(ROOT.length));
        }
    }
    return { used, selfSet };
}

/** bits-ui 实际会输出的 data-* 属性 */
function bitsUiAttributes(): Set<string> {
    const out = new Set<string>();
    const walk = (dir: string) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".js")) {
                for (const m of readFileSync(p, "utf8").matchAll(/"data-([a-z-]+)"/g)) out.add(`data-${m[1]}`);
            }
        }
    };
    if (existsSync(BITS_UI_DIST)) walk(BITS_UI_DIST);
    return out;
}

/** src/app.css 里的搭桥：变体 -> 目标属性 */
function bridges(): Map<string, string> {
    const css = readFileSync(APP_CSS, "utf8");
    const out = new Map<string, string>();
    for (const m of css.matchAll(/@custom-variant\s+(data-[a-z-]+)\s*\(&\[([a-z-]+)=/g)) out.set(m[1], m[2]);
    return out;
}

const { used, selfSet } = scanSources();
const emitted = bitsUiAttributes();
const bridged = bridges();

describe("Tailwind data-* 变体与 bits-ui 输出属性的一致性", () => {
    it("bridge: src/app.css 的搭桥指向 bits-ui 真的会输出的属性", () => {
        expect(bridged.size).toBeGreaterThan(0);
        for (const [variant, target] of bridged) {
            expect(emitted.has(target), `搭桥 ${variant} → ${target} 已失效：bits-ui 不再输出 ${target}`).toBe(true);
        }
    });

    it("每个用到的变体都有出处（组件自设 / bits-ui 输出 / app.css 搭桥）", () => {
        const unresolved: string[] = [];
        for (const [variant, files] of used) {
            const attr = attrOf(variant);
            if (selfSet.has(attr) || emitted.has(attr) || bridged.has(variant)) continue;
            unresolved.push(`${variant} (属性 ${attr}) 出现在 ${[...files].join(", ")}`);
        }
        expect(unresolved, `以下变体没有任何元素会输出对应属性，样式永远不会生效：\n${unresolved.join("\n")}`).toEqual(
            []
        );
    });

    it("搭桥覆盖了所有简写变体，没有漏网的必选项", () => {
        // 这几个是 bits-ui 用 data-state / data-orientation 表达、而 shadcn 用简写消费的，
        // 少任何一个都会让对应组件的样式静默失效。
        for (const name of [
            "data-checked",
            "data-unchecked",
            "data-open",
            "data-closed",
            "data-horizontal",
            "data-vertical",
        ]) {
            if (!used.has(name)) continue;
            expect(bridged.has(name), `用到了 ${name}: 却没有搭桥，样式不会生效`).toBe(true);
        }
    });
});
