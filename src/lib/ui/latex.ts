import katex from "katex";
import { marked } from "marked";

// 动态注入 KaTeX CSS（CDN），避免打包字体导致 CSS 超大
const KATEX_CSS_CDN = "https://cdn.jsdelivr.net/npm/katex@0.18.1/dist/katex.min.css";
let cssInjected = false;
function ensureCss() {
    if (cssInjected || document.querySelector('link[data-katex-css]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = KATEX_CSS_CDN;
    link.setAttribute("data-katex-css", "");
    document.head.appendChild(link);
    cssInjected = true;
}
ensureCss();

/** HTML 转义 */
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

/** KaTeX 渲染为 HTML 字符串 */
function renderKatex(math: string, displayMode: boolean): string {
    try {
        return katex.renderToString(math.trim(), {
            displayMode,
            throwOnError: false,
            strict: false,
        });
    } catch {
        return `<code>${escapeHtml(math)}</code>`;
    }
}

/** 占位符格式，避免被 marked 解析 */
const PH_PREFIX = "\x00KATEX\x00";
const PH_SUFFIX = "\x00ENDKATEX\x00";
let phCounter = 0;

/**
 * 将文本转为安全 HTML，支持行内 $...$ 和行间 $$...$$ LaTeX 渲染。
 * 非数学部分 HTML 转义，保留换行。
 */
export function renderLatex(text: string): string {
    if (!text) return "";
    let result = "";
    let i = 0;
    while (i < text.length) {
        // 行间 $$...$$
        if (text[i] === "$" && text[i + 1] === "$") {
            const end = text.indexOf("$$", i + 2);
            if (end >= 0) {
                const math = text.slice(i + 2, end);
                result += renderKatex(math, true);
                i = end + 2;
                continue;
            }
        }
        // 行内 $...$
        if (text[i] === "$") {
            const end = text.indexOf("$", i + 1);
            if (end > i && !text[i + 1].includes("\n")) {
                const math = text.slice(i + 1, end);
                if (!math.includes("\n") && math.trim().length > 0) {
                    result += renderKatex(math, false);
                    i = end + 1;
                    continue;
                }
            }
        }
        // 普通字符
        const chunk = text.slice(i);
        const nextDollar = chunk.indexOf("$");
        if (nextDollar >= 0) {
            result += escapeHtml(chunk.slice(0, nextDollar));
            i += nextDollar;
        } else {
            result += escapeHtml(chunk);
            break;
        }
    }
    return result.replace(/\n/g, "<br />");
}

/**
 * 渲染 Markdown + LaTeX：
 * 1. 提取 $...$ 和 $$...$$ 数学表达式，替换为占位符
 * 2. 用 marked 渲染剩余 Markdown
 * 3. 将占位符替换回 KaTeX HTML
 */
export function renderMarkdownLatex(text: string): string {
    if (!text) return "";
    const placeholders: string[] = [];

    // 提取数学表达式
    let processed = "";
    let i = 0;
    while (i < text.length) {
        // 行间 $$...$$
        if (text[i] === "$" && text[i + 1] === "$") {
            const end = text.indexOf("$$", i + 2);
            if (end >= 0) {
                const math = text.slice(i + 2, end);
                const ph = `${PH_PREFIX}${phCounter++}${PH_SUFFIX}`;
                placeholders.push(renderKatex(math, true));
                processed += ph;
                i = end + 2;
                continue;
            }
        }
        // 行内 $...$
        if (text[i] === "$") {
            const end = text.indexOf("$", i + 1);
            if (end > i) {
                const math = text.slice(i + 1, end);
                if (!math.includes("\n") && math.trim().length > 0) {
                    const ph = `${PH_PREFIX}${phCounter++}${PH_SUFFIX}`;
                    placeholders.push(renderKatex(math, false));
                    processed += ph;
                    i = end + 1;
                    continue;
                }
            }
        }
        processed += text[i];
        i++;
    }

    // 配置 marked
    marked.setOptions({ breaks: true, gfm: true });
    let html = marked.parse(processed) as string;

    // 恢复 KaTeX 占位符
    placeholders.forEach((katexHtml, idx) => {
        const ph = `${PH_PREFIX}${idx}${PH_SUFFIX}`;
        html = html.split(ph).join(katexHtml);
    });

    return html;
}
