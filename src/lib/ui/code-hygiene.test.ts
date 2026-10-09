import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "svelte/compiler";
import { describe, expect, it } from "vitest";

/**
 * 代码静态体检（模板与脚本两类）。
 *
 * 四类问题都属于「能跑、能过 typecheck，但一用就不对」：
 * 1. 模板里硬编码中文 → 英文界面下露出来（本轮改前有 1 处「字符」）
 * 2. {@html} 的取值绕过了净化助手 → 模型输出直接注入 DOM
 * 3. 遗留的 console.log → 调试噪音
 * 4. $derived 里读 Date.now() → 不是响应式依赖，面板长期开着不刷新
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = join(ROOT, "src");

function filesWith(ext: string): string[] {
    return readdirSync(SRC, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(ext))
        .map((e) => join(e.parentPath, e.name))
        .filter((f) => !f.endsWith(".test.ts"))
        .sort();
}

const rel = (file: string) => file.slice(ROOT.length).replace(/\\/g, "/");
const svelteFiles = filesWith(".svelte");
const codeFiles = [...svelteFiles, ...filesWith(".ts")];

const templates = svelteFiles.map((file) => ({
    file,
    source: readFileSync(file, "utf8"),
    html: (parse(readFileSync(file, "utf8")) as unknown as { html: unknown }).html,
}));

interface Json {
    [key: string]: unknown;
}

function walk(node: Json, visit: (n: Json) => void): void {
    visit(node);
    for (const [key, value] of Object.entries(node)) {
        if (key === "parent" || key === "metadata") continue;
        if (Array.isArray(value)) {
            for (const child of value)
                if (child && typeof child === "object" && "type" in child) walk(child as Json, visit);
        } else if (value && typeof value === "object" && "type" in (value as object)) {
            walk(value as Json, visit);
        }
    }
}

describe("代码静态体检", () => {
    it("模板里没有硬编码的中文（否则英文界面会露出来）", () => {
        const issues: string[] = [];
        for (const { file, source, html } of templates) {
            walk(html as Json, (n) => {
                if (n.type !== "Text" || typeof n.data !== "string") return;
                const text = n.data.replace(/\s+/g, " ").trim();
                // 单个标点（如「·」分隔符）不算硬编码文案
                if (!/[\u4e00-\u9fff]{2,}/.test(text)) return;
                const line = source.slice(0, (n.start as number) ?? 0).split("\n").length;
                issues.push(`${rel(file)}:${line}  「${text.slice(0, 40)}」应走 t()`);
            });
        }
        expect(issues, `以下文案应走 i18n：\n${issues.join("\n")}`).toEqual([]);
    });

    it("{@html} 的取值都经过净化助手（renderMarkdownLatex / renderAnswerSegments / DOMPurify）", () => {
        /*
         * renderAnswerSegments 也算净化助手：它内部逐段调用 renderMarkdownLatex，
         * 只是把「多个片段」各自渲染后用分隔符拼起来（填空题的每个空一段）。
         * 允许列表里列的是「明确经过净化的入口」，新增时要先确认它确实走 renderMarkdownLatex。
         */
        const SANITIZED = /renderMarkdownLatex|renderAnswerSegments|DOMPurify|sanitize/;
        const issues: string[] = [];

        for (const { file, source, html } of templates) {
            // 允许 {@html 变量}：把变量名解析回它自己的初始化表达式再看
            const initializers = new Map<string, string>();
            for (const m of source.matchAll(
                /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(\$derived(?:\.by)?\([\s\S]{0,600}?\)|[^;]{0,300}?);/g
            )) {
                initializers.set(m[1], m[2]);
            }
            // 循环别名：{#each optionHtml as optionMarkup} 里的 optionMarkup
            // 继承集合并表达式的净化情况
            for (const m of source.matchAll(/\{#each\s+([^}]+?)\s+as\s+([A-Za-z_$][\w$]*)/g)) {
                initializers.set(m[2], m[1]);
            }
            const resolvesToSanitizer = (expr: string): boolean => {
                if (SANITIZED.test(expr)) return true;
                const identifier = expr.trim();
                if (!/^[A-Za-z_$][\w$]*$/.test(identifier)) return false;
                const init = initializers.get(identifier);
                if (!init || init === expr) return false;
                return SANITIZED.test(init) || resolvesToSanitizer(init);
            };

            walk(html as Json, (n) => {
                if (n.type !== "RawMustacheTag") return;
                const expression = n.expression as { start: number; end: number };
                const expr = source.slice(expression.start, expression.end);
                if (resolvesToSanitizer(expr)) return;
                const line = source.slice(0, expression.start).split("\n").length;
                issues.push(`${rel(file)}:${line}  {@html ${expr.slice(0, 40)}} 未经净化`);
            });
        }
        expect(issues, `以下位置会把未净化内容注入 DOM：\n${issues.join("\n")}`).toEqual([]);
    });

    it("源码里没有遗留的 console.log", () => {
        const issues: string[] = [];
        for (const file of codeFiles) {
            readFileSync(file, "utf8")
                .split("\n")
                .forEach((line, i) => {
                    const trimmed = line.trim();
                    if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
                    if (/console\.log\(/.test(line)) issues.push(`${rel(file)}:${i + 1}  ${trimmed.slice(0, 60)}`);
                });
        }
        expect(issues, `调试输出请改用 console.warn/error 或删掉：\n${issues.join("\n")}`).toEqual([]);
    });

    it("$derived 里不直接读时钟（不是响应式依赖）", () => {
        const issues: string[] = [];
        for (const file of svelteFiles) {
            const source = readFileSync(file, "utf8");
            for (const m of source.matchAll(/\$derived(?:\.by)?\s*\(/g)) {
                let depth = 0;
                let i = m.index + m[0].length - 1;
                while (i < source.length) {
                    if (source[i] === "(") depth++;
                    else if (source[i] === ")" && --depth === 0) break;
                    i++;
                }
                const body = source.slice(m.index, i + 1);
                const code = body
                    .split("\n")
                    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
                    .join("\n");
                if (!/Date\.now\(\)/.test(code)) continue;
                const line = source.slice(0, m.index).split("\n").length;
                issues.push(`${rel(file)}:${line}  ${body.replace(/\s+/g, " ").slice(0, 80)}`);
            }
        }
        expect(issues, `请改用 createClock().now：\n${issues.join("\n")}`).toEqual([]);
    });
});
