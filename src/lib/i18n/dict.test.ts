import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import zhCN from "@/../public/i18n/zh-CN.json";
import en from "@/../public/i18n/en.json";

const SRC_DIR = fileURLToPath(new URL("../../", import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL("../../../public/", import.meta.url));

const zh = zhCN as Record<string, string>;
const enDict = en as Record<string, string>;

/** 需要按前缀整体视为「已使用」的动态 key，见 docWriter.ts 的 t(`type.${type}`) */
const DYNAMIC_KEY_PREFIXES = ["type.", "diff."];

function walk(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
            if (name === "test") continue;
            out.push(...walk(full));
        } else if ([".ts", ".svelte"].includes(extname(name)) && !name.endsWith(".test.ts")) {
            out.push(full);
        }
    }
    return out;
}

/** 收集源码中引用的 i18n key（含通过 t(`prefix.${x}`) 动态拼接的前缀） */
function collectReferencedKeys(): { literal: Set<string>; prefixes: Set<string> } {
    const literal = new Set<string>();
    const prefixes = new Set<string>();

    for (const file of walk(SRC_DIR)) {
        const code = readFileSync(file, "utf8");
        for (const match of code.matchAll(/\bt\(\s*"([^"]+)"/g)) {
            literal.add(match[1]);
        }
        for (const match of code.matchAll(/\bt\(\s*`([^`$]*)\$\{/g)) {
            if (match[1]) prefixes.add(match[1]);
        }
    }
    return { literal, prefixes };
}

/** key 是否被使用：字面量命中，或落在某个动态前缀下 */
function isUsed(key: string, literal: Set<string>, prefixes: Set<string>): boolean {
    if (literal.has(key)) return true;
    return [...prefixes, ...DYNAMIC_KEY_PREFIXES].some((p) => key.startsWith(p));
}

describe("i18n 字典", () => {
    it("中英文字典的 key 集合一致", () => {
        expect(Object.keys(enDict).sort()).toEqual(Object.keys(zh).sort());
    });

    it("中英文字典的 key 顺序一致（便于逐行对照维护）", () => {
        expect(Object.keys(enDict)).toEqual(Object.keys(zh));
    });

    it("中英文字典均无空值", () => {
        const emptyZh = Object.entries(zh).filter(([, v]) => !String(v).trim());
        const emptyEn = Object.entries(enDict).filter(([, v]) => !String(v).trim());
        expect(emptyZh).toEqual([]);
        expect(emptyEn).toEqual([]);
    });

    it("占位符集合在两种语言中保持一致", () => {
        const placeholders = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join(",");
        const mismatched = Object.keys(zh).filter((k) => placeholders(zh[k]) !== placeholders(enDict[k]));
        expect(mismatched).toEqual([]);
    });

    it("源码引用的 key 全部存在于字典中", () => {
        const { literal } = collectReferencedKeys();
        const missing = [...literal].filter((k) => !(k in zh));
        expect(missing).toEqual([]);
    });

    it("字典中没有未被源码引用的死 key", () => {
        const { literal, prefixes } = collectReferencedKeys();
        const unused = Object.keys(zh).filter((k) => !isUsed(k, literal, prefixes));
        expect(unused).toEqual([]);
    });

    it("递归收集到的源码文件数量符合预期（防止 walk 失效导致断言空转）", () => {
        expect(walk(SRC_DIR).length).toBeGreaterThan(20);
    });

    it("检测到动态 key 前缀，避免把 type./diff. 误报为死 key", () => {
        const { prefixes } = collectReferencedKeys();
        expect([...prefixes].sort()).toEqual(["diff.", "type."]);
    });

    it("字典文件位于 public/i18n 下（打包后由 Vite publicDir 复制）", () => {
        expect(relative(PUBLIC_DIR, join(PUBLIC_DIR, "i18n", "zh-CN.json"))).toBe(join("i18n", "zh-CN.json"));
    });
});
