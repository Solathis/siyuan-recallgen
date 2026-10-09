import katex from "katex";
import { marked, type TokenizerAndRendererExtension } from "marked";
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
 * 把 KaTeX 的产物放行给净化器（放宽到允许 <math> 与 style）会让笔记里的任意
 * HTML 也一起被放行，那是拿安全换省事，不做。
 */

/** 数学表达式占位符包裹字符（Unicode 私有区，正文不会自然出现） */
const PH_START = "\uE000";
const PH_END = "\uE001";

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

/** 一次渲染过程中收集到的公式；由 renderUncached 在调用 marked.parse 前设置 */
interface MathBatch {
    nonce: string;
    rendered: string[];
}

let batch: MathBatch | null = null;
let seq = 0;

/**
 * 公式拆分：marked 的官方行内扩展。
 *
 * 为什么不自己扫原文：
 * 之前是把整段 Markdown 交给一个自写的扫描器找 $...$，它完全不知道「代码区间」
 * 这回事。于是 `` `5$` `` 与 `` `10$` `` 这两个代码区间里的 $ 会被配成一对，
 * 把中间的文字整段吃进公式渲染（实测：`用 \`$state\` 与 \`$derived\` 两个 rune`
 * 会渲染成一段公式 state` 与 `derived），而这正是本项目笔记里最常见的写法。
 *
 * 交给 marked 就解决了：扩展只在 marked 的行内 tokenizer 里被调用，
 * 代码区间由 marked 自己的 codespan / code tokenizer 先整段吃掉，
 * 里面的 $ 根本送不到这里；`\$` 转义同理由 marked 的 escape tokenizer 处理。
 * 这是 marked 官方支持的扩展点（v4 起的稳定 API），不是内部实现。
 */
const mathExtension: TokenizerAndRendererExtension = {
    name: "rgMath",
    level: "inline",
    start(src: string) {
        const index = src.indexOf("$");
        return index < 0 ? undefined : index;
    },
    tokenizer(src: string) {
        if (src[0] !== "$" || !batch) return undefined;
        const display = src.startsWith("$$");
        const delim = display ? "$$" : "$";
        const rest = src.slice(delim.length);
        const end = rest.indexOf(delim);
        if (end < 0) return undefined;
        const body = rest.slice(0, end);
        if (body.trim().length === 0) return undefined;
        if (!display) {
            /*
             * 行内公式采用 Pandoc 的写法约定：开头的 $ 后面不能紧跟空白，
             * 结尾的 $ 前面也不能是空白。
             *
             * 这条规则解决的是「正文里本来就有两个 $」这类真实输入：
             * 笔记与 AI 解析里常把 rune 名直接写在正文中
             * （「$derived 与 $effect 的分工」），不设限时任意两个 $ 都会配成一对，
             * 把中间的文字整段渲染成公式（预览里实测出现过内容为「derived 与」的公式）。
             * 价格写法（「$5 到 $10」）同理：结尾 $ 前是空白，不会被当成公式。
             *
             * 行内公式还不允许跨行，避免把相距很远的两个 $ 之间整段吃掉。
             */
            if (/^\s/.test(body) || /\s$/.test(body)) return undefined;
            if (body.includes("\n")) return undefined;
        }

        batch.rendered.push(renderKatex(body, display));
        const placeholder = `${PH_START}${batch.nonce}-${batch.rendered.length - 1}${PH_END}`;
        return {
            type: "rgMath",
            raw: delim + body + delim,
            // tokens: [] 表示不再对这段内容做行内解析（否则公式里的 _ 会被当强调）
            tokens: [],
            placeholder,
        };
    },
    renderer(token) {
        return typeof token.placeholder === "string" ? token.placeholder : (token.raw ?? "");
    },
};

marked.use({ extensions: [mathExtension] });

/**
 * 渲染结果缓存。
 *
 * marked + DOMPurify + KaTeX 都不便宜，而同一段文本会反复渲染：
 * 切到别的题再切回来、答题面板因作答变化重渲染、结果页来回翻题……
 * 每道题的题干与选项在一次会话里内容是稳定的，正适合记忆化。
 * 输出只取决于输入（占位符序号只是内部中间态），因此按原文缓存是安全的。
 */
const CACHE_LIMIT = 400;
const cache = new Map<string, string>();

/** 空输入直接返回空串，不占缓存 */
function renderUncached(text: string): string {
    const current: MathBatch = { nonce: String(seq++), rendered: [] };
    batch = current;
    let rawHtml: string;
    try {
        rawHtml = marked.parse(text, { breaks: true, gfm: true, async: false }) as string;
    } finally {
        // 无论成功失败都要清掉：留着会让下一次 parse（哪怕是别处的调用）往旧批次里塞
        batch = null;
    }

    let html = DOMPurify.sanitize(rawHtml, PURIFY_CONFIG);
    // 回填 KaTeX：内容由本地 KaTeX 生成，不参与净化，避免 MathML 被裁剪
    current.rendered.forEach((katexHtml, index) => {
        html = html.split(`${PH_START}${current.nonce}-${index}${PH_END}`).join(katexHtml);
    });
    return html;
}

/**
 * 渲染 Markdown + LaTeX 为可安全交给 `{@html}` 的 HTML 字符串。
 * 空输入返回空串。
 */
export function renderMarkdownLatex(text: string): string {
    if (!text) return "";
    const hit = cache.get(text);
    if (hit !== undefined) return hit;

    const html = renderUncached(text);
    // Map 保持插入顺序：超上限时淘汰最早的一条
    if (cache.size >= CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(text, html);
    return html;
}

/** 清空渲染缓存（仅测试用） */
export function clearMarkdownCache(): void {
    cache.clear();
}

/** 当前缓存条目数（仅测试与诊断用） */
export function markdownCacheSize(): number {
    return cache.size;
}
