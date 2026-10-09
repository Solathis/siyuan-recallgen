import { EditorState, Compartment, type Extension } from "@codemirror/state";
import {
    EditorView,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    dropCursor,
    rectangularSelection,
    crosshairCursor,
    highlightSpecialChars,
    keymap,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { indentOnInput, bracketMatching, foldGutter, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { tags } from "@lezer/highlight";

/*
 * 编辑器主题一律走思源的 --b3-* 变量。
 *
 * 原先明暗两套是分开的：浅色用 CSS 变量，深色直接挂 @codemirror/theme-one-dark，
 * 而 one-dark 自带写死的 #282c34 背景与一套偏蓝的前景色 —— 在思源的深色主题里
 * 它是卡片中间一块「外来的」深色底，和周围对不上；浅色下又只有很弱的
 * defaultHighlightStyle，注释和字符串几乎看不出区别。
 *
 * 现在两套合成一套变量驱动的主题：颜色全部取自 --b3-*，明暗自动跟随；
 * 也就不再需要 Compartment 与 MutationObserver —— 主题切换由 CSS 变量本身完成，
 * 顺带少一处监听 document.body 的泄漏点。
 */
const theme = EditorView.theme({
    "&": {
        backgroundColor: "var(--b3-theme-background)",
        color: "var(--b3-theme-on-background)",
        /* 跟随外层容器：题目卡里就是 .rg-scope 的 13px，不必再定一套字号 */
        fontSize: "inherit",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-content": { fontFamily: "var(--font-mono)", padding: "6px 0" },
    /*
     * 高度上限压在这里，而不是给外层容器挂 overflow。
     *
     * 补全弹层是绝对定位在 .cm-editor 里的（.cm-editor 直接子元素），
     * 外层容器一旦带 overflow（hidden 或 auto 都一样）就会把弹出到编辑框下沿之外的
     * 候选列表裁掉一半。限制 .cm-scroller 的高度则只滚动代码本身，
     * 弹层仍在 .cm-editor 的可见区域里溢出显示。
     * 上限用变量给，调用方按场景定（答题页 24rem、只读参考代码 20rem）。
     */
    ".cm-scroller": { maxHeight: "var(--rg-code-max-h, 24rem)", overflowY: "auto" },
    ".cm-editor": { overflow: "visible" },
    ".cm-line": { padding: "0 8px" },
    ".cm-gutters": {
        backgroundColor: "var(--b3-theme-background-light, var(--b3-theme-surface))",
        color: "var(--b3-theme-on-surface-light, var(--b3-theme-on-surface))",
        border: "none",
        borderRight: "1px solid var(--b3-border-color)",
    },
    ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--b3-theme-primary) 8%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--b3-theme-primary) 12%, transparent)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
        backgroundColor: "color-mix(in srgb, var(--b3-theme-primary) 24%, transparent)",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--b3-theme-on-background)" },
    ".cm-foldPlaceholder": {
        backgroundColor: "var(--b3-theme-surface)",
        border: "1px solid var(--b3-border-color)",
        color: "var(--b3-theme-on-surface)",
    },
    ".cm-tooltip": {
        backgroundColor: "var(--b3-theme-surface)",
        border: "1px solid var(--b3-border-color)",
        color: "var(--b3-theme-on-surface)",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "var(--b3-theme-primary)",
        color: "var(--b3-theme-on-primary)",
    },
});

/**
 * 语法高亮配色。
 *
 * 逐个 tag 映射到主题变量，而不是引一套固定调色板：关键字用思源主色、
 * 字符串用成功色、注释用次要文字色，深色浅色都由变量自己给出该有的对比度。
 */
const highlight = HighlightStyle.define([
    { tag: tags.comment, color: "var(--b3-theme-on-surface-light)", fontStyle: "italic" },
    { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "var(--b3-theme-primary)" },
    { tag: [tags.string, tags.special(tags.string)], color: "var(--b3-card-success-color, #2d7d46)" },
    { tag: [tags.number, tags.bool, tags.null], color: "var(--b3-card-warning-color, #8a4f00)" },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--b3-theme-primary)" },
    {
        tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)],
        color: "var(--b3-theme-on-background)",
    },
    { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--b3-card-error-color, #a33)" },
    { tag: [tags.propertyName, tags.attributeName], color: "var(--b3-theme-on-surface)" },
    { tag: [tags.tagName, tags.angleBracket], color: "var(--b3-card-error-color, #a33)" },
    { tag: [tags.meta, tags.processingInstruction, tags.annotation], color: "var(--b3-theme-on-surface-light)" },
    { tag: tags.invalid, color: "var(--b3-card-error-color, #a33)", textDecoration: "underline" },
]);

/**
 * 语言包一览。
 *
 * schema 里给模型的提示是「python/javascript/go 等」，所以按可能出现的语言
 * 逐个静态列出、用动态 import 按需加载：只有真正用到的语言会被载入，
 * 但打包时 inlineDynamicImports 会把它们内联进单文件产物，因此这份清单
 * 只放「笔记里真的会写到的」几门，不做大而全。
 */
const LANGUAGE_LOADERS: Record<string, () => Promise<Extension>> = {
    python: async () => (await import("@codemirror/lang-python")).python(),
    javascript: async () => (await import("@codemirror/lang-javascript")).javascript(),
    typescript: async () => (await import("@codemirror/lang-javascript")).javascript({ typescript: true, jsx: true }),
    css: async () => (await import("@codemirror/lang-css")).css(),
    markdown: async () => (await import("@codemirror/lang-markdown")).markdown(),
    go: async () => (await import("@codemirror/lang-go")).go(),
    java: async () => (await import("@codemirror/lang-java")).java(),
    cpp: async () => (await import("@codemirror/lang-cpp")).cpp(),
    c: async () => (await import("@codemirror/lang-cpp")).cpp(),
    sql: async () => (await import("@codemirror/lang-sql")).sql(),
    json: async () => (await import("@codemirror/lang-json")).json(),
};

/** 别名归一到上表的键 */
const LANGUAGE_ALIASES: Record<string, string> = {
    py: "python",
    python3: "python",
    js: "javascript",
    node: "javascript",
    ts: "typescript",
    golang: "go",
    "c++": "cpp",
    cxx: "cpp",
    md: "markdown",
    yml: "json",
    yaml: "json",
};

/** 语言的展示名，用于编辑器外壳的语言标识 */
export function languageLabel(lang: string): string {
    const key = normalizeLanguage(lang);
    if (key === "cpp") return "C/C++";
    if (key === "typescript") return "TypeScript";
    if (key === "javascript") return "JavaScript";
    if (!key) return lang || "text";
    return key.charAt(0).toUpperCase() + key.slice(1);
}

function normalizeLanguage(lang: string): string {
    const key = (lang || "").toLowerCase().trim();
    const aliased = LANGUAGE_ALIASES[key] ?? key;
    return aliased in LANGUAGE_LOADERS ? aliased : "";
}

/** 是否存在语言包：没有时编辑器仍可用，只是不高亮，调用方据此决定显示什么 */
export function hasLanguageSupport(lang: string): boolean {
    return normalizeLanguage(lang) !== "";
}

async function loadLanguage(lang: string): Promise<Extension> {
    const key = normalizeLanguage(lang);
    if (!key) return [];
    try {
        return await LANGUAGE_LOADERS[key]();
    } catch (e) {
        console.warn(`[RecallGen] 语言包加载失败: ${lang}`, e);
        return [];
    }
}

/** 软换行开关：长行按容器宽度折行，而不是把横向滚动条塞进面板 */
const wrapCompartment = new Compartment();

function wrapExt(on: boolean): Extension {
    return on ? EditorView.lineWrapping : [];
}

function keymaps(): Extension[] {
    return [
        keymap.of([...defaultKeymap, ...historyKeymap, ...closeBracketsKeymap, ...completionKeymap, indentWithTab]),
    ];
}

function baseExtensions(): Extension[] {
    return [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        syntaxHighlighting(highlight),
        theme,
    ];
}

/**
 * 可编辑的代码编辑器。
 * mount/destroy 必须成对调用，避免泄漏。
 * 非并发对象：每个编辑器实例仅供单一答题面板使用。
 */
export class CodeEditor {
    private view: EditorView | null = null;
    /** 语言包是异步加载的，期间可能已被销毁，用它避免创建出无人回收的编辑器 */
    private destroyed = false;
    private wrap = false;

    constructor(
        private readonly parent: HTMLElement,
        private readonly lang: string,
        private readonly initialCode = "",
        private readonly onChange?: (doc: string) => void
    ) {}

    async mount(): Promise<void> {
        const languageExt = await loadLanguage(this.lang);
        // 等待语言包期间若已销毁，直接放弃创建，否则会留下永不销毁的编辑器实例
        if (this.destroyed) return;
        this.view = new EditorView({
            parent: this.parent,
            state: EditorState.create({
                doc: this.initialCode,
                extensions: [
                    ...baseExtensions(),
                    ...keymaps(),
                    EditorView.updateListener.of((v) => {
                        if (v.docChanged && this.onChange) {
                            this.onChange(v.state.doc.toString());
                        }
                    }),
                    languageExt,
                    wrapCompartment.of(wrapExt(this.wrap)),
                ],
            }),
        });
    }

    getValue(): string {
        return this.view?.state.doc.toString() ?? "";
    }

    setValue(code: string): void {
        if (!this.view) return;
        this.view.dispatch({
            changes: { from: 0, to: this.view.state.doc.length, insert: code },
        });
    }

    /** 软换行开关：只重配这一项，不重建编辑器（保住光标与撤销历史） */
    setWrap(on: boolean): void {
        this.wrap = on;
        this.view?.dispatch({ effects: wrapCompartment.reconfigure(wrapExt(on)) });
    }

    /** 当前是否已挂载；异步语言包还在路上时为 false */
    get ready(): boolean {
        return this.view !== null;
    }

    destroy(): void {
        this.destroyed = true;
        this.view?.destroy();
        this.view = null;
    }
}

/**
 * 只读高亮视图。
 *
 * 结果页的参考代码、以及导出预览都用它：同一套主题、同一套高亮，
 * 只是不给编辑能力 —— 用 editable: false 而不是单纯把 state 标成只读，
 * 后者仍会渲染出可聚焦的光标与选区。
 */
export class CodeViewer {
    private view: EditorView | null = null;
    private destroyed = false;

    constructor(
        private readonly parent: HTMLElement,
        private readonly lang: string,
        private readonly code: string
    ) {}

    async mount(): Promise<void> {
        const languageExt = await loadLanguage(this.lang);
        if (this.destroyed) return;
        this.view = new EditorView({
            parent: this.parent,
            state: EditorState.create({
                doc: this.code,
                extensions: [
                    lineNumbers(),
                    highlightSpecialChars(),
                    languageExt,
                    syntaxHighlighting(highlight),
                    theme,
                    EditorState.readOnly.of(true),
                    EditorView.editable.of(false),
                    wrapCompartment.of(wrapExt(true)),
                ],
            }),
        });
    }

    destroy(): void {
        this.destroyed = true;
        this.view?.destroy();
        this.view = null;
    }
}
