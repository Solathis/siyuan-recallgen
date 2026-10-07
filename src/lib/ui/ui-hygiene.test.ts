import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "svelte/compiler";
import { describe, expect, it } from "vitest";

/**
 * 界面静态体检。
 *
 * 拦的是三类「编译器、typecheck、渲染快照都过得去，只在真机上表现为
 * 难看 / 读不出 / 错位」的写法，本项目里都真实发生过：
 *
 * 1. 属性写在开始标签之后 → Svelte 把它当成文本与插值，页面上直接印出
 *    「aria-label=删除 title=删除 ✕」（题库页与历史页各出现过一次）
 * 2. 纯图标按钮没有可访问名称 → 读屏软件只会念「按钮」
 * 3. 行内 style 写死 px 间距，与相邻的 Tailwind rem 间距混用 →
 *    每行差零点几像素，行数一多就明显错位（热力图标签列差过 5px）
 *
 * 实现上必须走 Svelte 自己的解析器：用正则匹配 `<button ...>` 会在
 * `onclick={() => {}}` 的 `>` 处截断，且区分不出 Element 与 InlineComponent，
 * 于是整条规则静默失效——第一版就是这么写的，探针文件里三个问题只抓到两个。
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

interface Node {
    type: string;
    name?: string;
    data?: string;
    start?: number;
    children?: Node[];
    attributes?: Node[];
    value?: Node[] | unknown;
    [key: string]: unknown;
}

/** 本该写在开始标签里的属性名 */
const ATTR_LIKE =
    /^(aria-[a-z-]+|title|class|id|role|type|value|placeholder|disabled|style|name|href|target|alt|tabindex|colspan|for|min|max|step|checked|open|lang)\s*=/;
/** 至少有一个字母/数字/汉字才算「有可读文本」 */
const READABLE = /[A-Za-z0-9\u4e00-\u9fff]/;
const ELEMENT_TYPES = new Set(["Element", "InlineComponent", "SvelteElement", "SvelteComponent"]);
const TEXT_BEARING =
    /^(Text|MustacheTag|RenderTag|IfBlock|EachBlock|AwaitBlock|KeyBlock|SnippetBlock|HtmlTag|DebugTag|ConstTag)$/;

function svelteFiles(): string[] {
    return readdirSync(ROOT, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".svelte"))
        .map((e) => join(e.parentPath, e.name))
        .sort();
}

const rel = (file: string) => file.slice(ROOT.length).replace(/\\/g, "/");
const files = svelteFiles();
const lineOf = (source: string, offset?: number) =>
    offset === undefined ? 0 : source.slice(0, offset).split("\n").length;

/** 遍历整棵树（含元素子节点、属性值里的表达式） */
function walk(node: Node, visit: (n: Node) => void): void {
    visit(node);
    for (const [key, value] of Object.entries(node)) {
        if (key === "parent" || key === "metadata") continue;
        if (Array.isArray(value)) {
            for (const child of value)
                if (child && typeof child === "object" && "type" in child) walk(child as Node, visit);
        } else if (value && typeof value === "object" && "type" in (value as object)) {
            walk(value as Node, visit);
        }
    }
}

/** 只看节点的「内容子节点」，不看属性（属性里的表达式不算按钮文本） */
function contentOf(node: Node): { text: string; dynamic: boolean } {
    let text = "";
    let dynamic = false;
    const visitChildren = (parent: Node): void => {
        for (const child of parent.children ?? []) {
            if (!child || typeof child !== "object") continue;
            if (child.type === "Text") {
                text += child.data ?? "";
                continue;
            }
            // 嵌套元素里的文字同样算按钮的可读文本（<span>删除</span>），
            // 但 <svg> 这类没有文字，不应由此获得名称
            if (ELEMENT_TYPES.has(child.type)) {
                visitChildren(child);
                continue;
            }
            if (!TEXT_BEARING.test(child.type)) continue;
            // 插值 / 条件块 / 循环：运行时才知道文本，不能判为「没有名称」
            dynamic = true;
            visitChildren(child);
        }
    };
    visitChildren(node);
    return { text, dynamic };
}

const parsed = files.map((file) => {
    const source = readFileSync(file, "utf8");
    const root = parse(source) as unknown as { html: Node };
    return { file, source, fragment: root.html };
});

describe("界面静态体检", () => {
    it("扫描范围覆盖到全部组件", () => {
        expect(files.length).toBeGreaterThan(50);
        // 解析器与节点类型名对得上，否则下面的规则会静默失效
        const buttons = parsed.flatMap(({ fragment }) => {
            const found: string[] = [];
            walk(fragment, (n) => {
                if (ELEMENT_TYPES.has(n.type) && (n.name === "button" || n.name === "Button")) found.push(n.type);
            });
            return found;
        });
        expect(buttons.length, "一个按钮都没扫到说明节点类型判断失效").toBeGreaterThan(20);
    });

    it("没有把属性写在开始标签之后的写法", () => {
        const issues: string[] = [];
        for (const { file, source, fragment } of parsed) {
            walk(fragment, (n) => {
                if (n.type !== "Text" || typeof n.data !== "string") return;
                for (const line of n.data.split("\n")) {
                    const trimmed = line.trim();
                    if (!ATTR_LIKE.test(trimmed)) continue;
                    issues.push(`${rel(file)}:${lineOf(source, n.start)}  ${trimmed.split("=")[0]}=… 会被当成文本渲染`);
                }
            });
        }
        expect(issues, `以下内容会被当成文本渲染出来：\n${issues.join("\n")}`).toEqual([]);
    });

    it("纯图标按钮都有可访问名称", () => {
        const issues: string[] = [];
        for (const { file, source, fragment } of parsed) {
            walk(fragment, (n) => {
                if (!ELEMENT_TYPES.has(n.type)) return;
                if (n.name !== "button" && n.name !== "Button") return;
                const names = (n.attributes ?? [])
                    .filter((a) => a.type === "Attribute" && typeof a.name === "string")
                    .map((a) => a.name as string);
                if (names.includes("aria-label") || names.includes("title")) return;

                const { text, dynamic } = contentOf(n);
                if (dynamic || READABLE.test(text)) return;
                issues.push(
                    `${rel(file)}:${lineOf(source, n.start)}  <${n.name}> 只有「${text.trim()}」这类内容，读屏念不出它是什么按钮`
                );
            });
        }
        expect(issues, `图标按钮缺 aria-label / title：\n${issues.join("\n")}`).toEqual([]);
    });

    it("行内 style 不写死 px 间距（会与 Tailwind 的 rem 间距错位）", () => {
        // 只拦间距类属性：width/height 用 px 是刻意的（热力图格子、图表尺寸）
        const SPACING = /(margin|padding|gap)[a-z-]*\s*:\s*[^;"']*\d+px/;
        const issues: string[] = [];
        for (const { file, source, fragment } of parsed) {
            walk(fragment, (n) => {
                if (n.type !== "Attribute" || n.name !== "style" || !Array.isArray(n.value)) return;
                const style = (n.value as Node[])
                    .map((part) => (typeof part.data === "string" ? part.data : ""))
                    .join("");
                if (!SPACING.test(style)) return;
                issues.push(
                    `${rel(file)}:${lineOf(source, n.start)}  ${style.trim().slice(0, 40)}（改用 gap-1 / mb-1 等工具类）`
                );
            });
        }
        expect(issues, `间距请与相邻工具类同源：\n${issues.join("\n")}`).toEqual([]);
    });
});
