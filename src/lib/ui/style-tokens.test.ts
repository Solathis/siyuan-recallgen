import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 样式令牌的落地检查。
 *
 * 这里守的是「注册了令牌，工具类才会跟随思源主题」这类问题：
 * 漏注册时 Tailwind 会用自带默认值，界面上看不出报错，只是字体/颜色
 * 与思源（以及插件自己的其它位置）不一致——属于静默失效。
 */

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const APP_CSS = readFileSync(join(ROOT, "src", "app.css"), "utf8");

function svelteFiles(dir: string): string[] {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".svelte"))
        .map((e) => join(e.parentPath, e.name));
}

describe("样式令牌", () => {
    it("font-mono 跟随思源的代码字体，而不是 Tailwind 的默认字体栈", () => {
        // 界面里有 8 处 font-mono（代码报错、语言标记、选项序号、提示词编辑框），
        // 不注册这个令牌它们就会用另一套等宽字体，
        // 而 .rg-markdown code 用的是 --b3-font-family-code
        expect(APP_CSS, "app.css 必须注册 --font-mono").toMatch(/--font-mono:\s*var\(--b3-font-family-code/);
    });

    it("组件里不使用任意字体族（绕开令牌的写法）", () => {
        const offenders: string[] = [];
        for (const file of svelteFiles(join(ROOT, "src"))) {
            const text = readFileSync(file, "utf8");
            for (const match of text.matchAll(/\bfont-\[[^\]]+\]/g)) {
                offenders.push(`${file.slice(ROOT.length)}: ${match[0]}`);
            }
        }
        expect(offenders, `应改用 font-mono / font-sans 等令牌：\n${offenders.join("\n")}`).toEqual([]);
    });

    it("语义色用 --b3-* 成对变量，不用思源不存在的单值变量", () => {
        // 思源只提供 --b3-card-{error,success,warning,info}-{color,background}，
        // 没有 --b3-card-error 这种单值变量（早期误用导致这些颜色在真机上不生效）
        const used = [...APP_CSS.matchAll(/var\((--b3-card-[a-z]+)(?=[,)\s])/g)].map((m) => m[1]);
        expect(used, `没有 --b3-card-xxx 单值变量：${used.join(", ")}`).toEqual([]);
    });
});
