/**
 * 「粘贴思源主题变量」的支持。
 *
 * 预览台自带的 --b3-* 只是一份形似思源默认主题的模拟值。思源用户可以换主题、
 * 也可以只改主色，那时模拟值与真机就会对不上，预览里觉得「颜色怪」其实只是
 * 主题不同。这里允许把思源开发者工具里看到的 --b3-* 整段贴进来覆盖。
 *
 * 明暗两套必须分开存：内联样式会盖过 .theme-dark 的类规则，
 * 若把浅色值一直挂在 documentElement 上，切到深色主题就再也不生效了。
 */

import type { PreviewTheme } from "./state.svelte";

const STORAGE_KEY: Record<PreviewTheme, string> = {
    light: "rg-preview-vars-light",
    dark: "rg-preview-vars-dark",
};

/** 只认 --b3-*，避免把无关样式贴进来污染预览 */
const DECLARATION = /(--b3-[\w-]+)\s*:\s*([^;{}]+)/g;

export function parseThemeVars(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const match of text.matchAll(DECLARATION)) {
        const value = match[2].trim();
        if (value) out[match[1]] = value;
    }
    return out;
}

export function loadThemeVars(theme: PreviewTheme): string {
    try {
        return localStorage.getItem(STORAGE_KEY[theme]) ?? "";
    } catch {
        return "";
    }
}

export function saveThemeVars(theme: PreviewTheme, text: string): void {
    try {
        if (text.trim()) localStorage.setItem(STORAGE_KEY[theme], text);
        else localStorage.removeItem(STORAGE_KEY[theme]);
    } catch {
        /* 隐私模式下 localStorage 可能不可写：预览不该因此崩掉 */
    }
}

/** 先清掉上一次贴的键再应用，否则删掉某一行后旧值会继续生效 */
export function applyThemeVars(theme: PreviewTheme, text: string): number {
    const root = document.documentElement;
    for (const name of trackedKeys()) root.style.removeProperty(name);

    const vars = parseThemeVars(text);
    for (const [name, value] of Object.entries(vars)) {
        root.style.setProperty(name, value);
        track(name);
    }
    void theme;
    return Object.keys(vars).length;
}

/** 记录本台贴过哪些键，便于精确撤销（不清空整个 style，避免影响别的用途） */
const appliedKeys = new Set<string>();

function track(name: string): void {
    appliedKeys.add(name);
}

function trackedKeys(): string[] {
    return [...appliedKeys];
}

export function clearAppliedVars(): void {
    const root = document.documentElement;
    for (const name of trackedKeys()) root.style.removeProperty(name);
    appliedKeys.clear();
}
