import katex from "katex";
import { marked } from "marked";
import DOMPurify, { type Config } from "dompurify";

/**
 * Markdown + LaTeX 渲染。
 *
 * 题干、解析与答疑都来自 AI，主观题内容来自用户输入，全是不可信数据。
 * marked 默认保留原始 HTML（`<img onerror>`、`<script>` 等会原样输出），
 * 因此它的输出必须先经 DOMPurify 净化，之后才能交给 `{@html}`。
 *
 * 处理顺序刻意设计为「先净化、后回填 KaTeX」：
 * 净化时数学公式还只是占位符，净化器不会误伤 KaTeX 生成的 MathML 与内联样式。
 */

/** 数学表达式占位符包裹字符（Unicode 私有区，正文不会自然出现） */
const PH_START = "\uE000";
const PH_END = "\uE001";

/** 自增序号，配合每次调用的序号保证占位符不会被正文文本意外命中 */
let phSeq = 0;

/** 净化策略：在 DOMPurify 默认策略之上禁止可注入样式与提交行为的标签/属性 */
const PURIFY_CONFIG: Config = {
    FORBID_TAGS: [
        "style",
        "script",
        "iframe",
        "frame",
        "object",
        "embed",
        "form",
        "input",
        "button",
        "link",
        "meta",
        "base",
    ],
    FORBID_ATTR: ["style", "srcset", "formaction", "ping", "target"],
    ALLOW_DATA_ATTR: false,
};

/** HTML 转义，用于 KaTeX 渲染失败时的降级输出 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/** 单个数学表达式渲染为 HTML；失败时退化为等宽文本而非抛错 */
function renderKatex(math: string, displayMode: boolean): string {
    try {
        return katex.renderToString(math.trim(), { displayMode, throwOnError: false, strict: false });
    } catch {
        return `<code>${escapeHtml(math)}</code>`;
    }
}

interface ExtractedMath {
    /** 数学表达式已替换为占位符的文本 */
    processed: string;
    /** 按出现顺序排列的渲染结果 */
    rendered: string[];
    /** 本次调用的占位符序号 */
    nonce: string;
}

/**
 * 提取 $...$ 与 $$...$$ 数学表达式并替换为占位符。
 * 转义写法 `\$` 会被跳过，因此正文里的价格等不会被误判为公式。
 */
function extractMath(text: string): ExtractedMath {
    const nonce = String(phSeq++);
    const rendered: string[] = [];
    let processed = "";
    let i = 0;

    while (i < text.length) {
        if (text[i] === "\\") {
            processed += text.slice(i, i + 2);
            i += 2;
            continue;
        }
        if (text[i] === "$") {
            const display = text[i + 1] === "$";
            const delimiter = display ? "$$" : "$";
            const end = text.indexOf(delimiter, i + delimiter.length);
            if (end > i) {
                const body = text.slice(i + delimiter.length, end);
                // 行内公式不允许跨行，避免把相距很远的两个 $ 之间内容整段吃掉
                const usable = body.trim().length > 0 && (display || !body.includes("\n"));
                if (usable) {
                    rendered.push(renderKatex(body, display));
                    processed += `${PH_START}${nonce}-${rendered.length - 1}${PH_END}`;
                    i = end + delimiter.length;
                    continue;
                }
            }
        }
        processed += text[i];
        i++;
    }

    return { processed, rendered, nonce };
}

/**
 * 渲染 Markdown + LaTeX 为可安全交给 `{@html}` 的 HTML 字符串。
 * 空输入返回空串。
 */
export function renderMarkdownLatex(text: string): string {
    if (!text) return "";
    const { processed, rendered, nonce } = extractMath(text);
    const rawHtml = marked.parse(processed, { breaks: true, gfm: true, async: false }) as string;
    let html = DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
    // 回填 KaTeX：内容由本地 KaTeX 生成，不参与净化，避免 MathML 被裁剪
    rendered.forEach((katexHtml, index) => {
        html = html.split(`${PH_START}${nonce}-${index}${PH_END}`).join(katexHtml);
    });
    return html;
}
