import { renderMarkdownLatex } from "./latex";

/**
 * 把「多个片段」的答案渲染成一段 HTML。
 *
 * 填空题的答案天然是多个片段（每个空一段，多选答案之间也会有分隔），
 * 直接拼成一个字符串再交给 Markdown 渲染会串味：
 * 拼接后的文本里可能有成对的 `$`，于是第一个空的 `$state` 与第二个空的
 * `$derived` 会配成一对，中间的分隔符与文字整段被当成公式渲染
 * （预览里实测出现内容为「derived / 派生值 / 计算值；」的公式）。
 *
 * 逐段渲染、再用分隔符把渲染结果接起来，各段互不影响——
 * 分隔符本身是纯文本，不需要参与 Markdown 解析。
 */
export function renderAnswerSegments(segments: string[], separator = "；"): string {
    return segments
        .map((segment) => renderMarkdownLatex(segment))
        .filter((html) => html.length > 0)
        .join(separator);
}
