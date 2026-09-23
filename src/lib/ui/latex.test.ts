// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdownLatex } from "./latex";

const PLACEHOLDER_MARK = "\uE000";

describe("renderMarkdownLatex - 安全性", () => {
    it("剥离 <script> 标签", () => {
        const html = renderMarkdownLatex("正常文本<script>window.__pwned = 1;</script>");
        expect(html).not.toContain("<script");
        expect(html).toContain("正常文本");
    });

    it("剥离事件处理属性（onerror 等）", () => {
        const html = renderMarkdownLatex('<img src="x" onerror="window.__pwned = 1">');
        expect(html).not.toContain("onerror");
    });

    it("剥离 <iframe>", () => {
        expect(renderMarkdownLatex('<iframe src="https://evil.example"></iframe>')).not.toContain("<iframe");
    });

    it("剥离 javascript: 协议链接", () => {
        const html = renderMarkdownLatex("[点我](javascript:alert(1))");
        expect(html).not.toContain("javascript:");
    });

    it("剥离内联 style 属性与 <style> 标签", () => {
        const html = renderMarkdownLatex('<style>body{display:none}</style><div style="position:fixed">x</div>');
        expect(html).not.toContain("<style");
        expect(html).not.toContain("position:fixed");
    });

    it("剥离 <form> 等提交类标签", () => {
        expect(renderMarkdownLatex('<form action="https://evil.example"><input name="a"></form>')).not.toContain(
            "<form"
        );
    });

    it("保留正常的 Markdown 结构", () => {
        const html = renderMarkdownLatex("**粗体** 和 `代码`\n\n- 甲\n- 乙");
        expect(html).toContain("<strong>");
        expect(html).toContain("<code>");
        expect(html).toContain("<li>");
    });

    it("保留代码块中的尖括号内容", () => {
        const html = renderMarkdownLatex("```js\nconst a = 1 < 2;\n```");
        expect(html).toContain("&lt;");
        expect(html).toContain("<pre>");
    });
});

describe("renderMarkdownLatex - LaTeX 渲染", () => {
    it("渲染行内公式", () => {
        const html = renderMarkdownLatex("勾股定理 $a^2+b^2=c^2$ 成立");
        expect(html).toContain('class="katex"');
        expect(html).toContain("勾股定理");
    });

    it("渲染行间公式", () => {
        const html = renderMarkdownLatex("$$\\int_0^1 x\\,dx$$");
        expect(html).toContain("katex-display");
    });

    it("回填后不残留占位符", () => {
        const html = renderMarkdownLatex("$x$");
        expect(html).not.toContain(PLACEHOLDER_MARK);
        expect(html).not.toContain("KATEX");
    });

    it("同一字符串内多个公式全部渲染", () => {
        const html = renderMarkdownLatex("$a$ 与 $b$ 与 $c$");
        expect(html.match(/class="katex"/g)).toHaveLength(3);
        expect(html).not.toContain(PLACEHOLDER_MARK);
    });

    // 回归：占位符序号曾是模块级计数器、回填却用局部下标，
    // 导致本次应用生命周期内第二次及以后的公式全部渲染失败
    it("连续多次调用都能正常渲染公式（占位符序号回归）", () => {
        for (let i = 0; i < 5; i++) {
            const html = renderMarkdownLatex(`第 ${i} 次 $x_{${i}}$`);
            expect(html).toContain('class="katex"');
            expect(html).not.toContain(PLACEHOLDER_MARK);
        }
    });

    it("同一次调用内多公式与多次调用交替都不串号", () => {
        const a = renderMarkdownLatex("$a$ $b$");
        const b = renderMarkdownLatex("$c$");
        expect(a.match(/class="katex"/g)).toHaveLength(2);
        expect(b.match(/class="katex"/g)).toHaveLength(1);
        expect(b).not.toContain(PLACEHOLDER_MARK);
    });

    it("公式渲染失败时退化为代码文本而不抛错", () => {
        const html = renderMarkdownLatex("$\\frac{1}{$");
        expect(html).toBeTruthy();
    });

    it("转义的 \\$ 不被当作公式起始", () => {
        const html = renderMarkdownLatex("价格是 \\$100 元");
        expect(html).toContain("$100");
        expect(html).not.toContain('class="katex"');
    });

    it("行内公式不跨行匹配", () => {
        const html = renderMarkdownLatex("$ 开头\n换行\n结束 $");
        expect(html).not.toContain('class="katex"');
    });

    it("正文中的 $ 数量为奇数时不吞掉后续内容", () => {
        const html = renderMarkdownLatex("价格 $5 和 $9 都不含税");
        expect(html).toContain("不含税");
    });
});

describe("renderMarkdownLatex - 边界", () => {
    it("空输入返回空串", () => {
        expect(renderMarkdownLatex("")).toBe("");
    });

    it("纯空白输入不抛错", () => {
        expect(() => renderMarkdownLatex("   ")).not.toThrow();
    });
});
