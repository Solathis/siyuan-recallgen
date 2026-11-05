// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderMarkdownLatex } from "./latex";
import { renderAnswerSegments, renderAcceptedAnswers } from "./answer-render";

describe("math compatibility", () => {
    it("renders all four delimiters and mixed physics notation", () => {
        const html = renderMarkdownLatex(
            String.raw`$x$ $$y$$ \(R_x(\pi)\sigma_z R_x(\pi)^\dagger=-\sigma_z\) \[\begin{pmatrix}1&0\\0&1\end{pmatrix}\]`
        );
        expect(html.match(/class="katex"/g)).toHaveLength(4);
        expect(html).not.toContain("katex-error");
    });

    it("leaves code and unmatched delimiters alone", () => {
        expect(renderMarkdownLatex("code: `\\(x\\)`")).not.toContain('class="katex"');
        expect(renderMarkdownLatex("```latex\n\\[x\\]\n```")).not.toContain('class="katex"');
        expect(renderMarkdownLatex(String.raw`unfinished \(x`)).not.toContain('class="katex"');
    });

    it("renders legacy accepted alternatives without altering source answers", () => {
        const answers = [String.raw`-\sigma_z`, String.raw`$-\sigma_z$`, String.raw`-\alpha_1`];
        const original = [...answers];
        const html = renderAcceptedAnswers([answers.slice(0, 2), answers.slice(2)]);
        expect(html.match(/class="katex"/g)).toHaveLength(3);
        expect(answers).toEqual(original);
        expect(renderAnswerSegments(["ordinary text", "`\\sigma_z`", "\\unknownCommand"])).not.toContain(
            'class="katex"'
        );
    });
});
