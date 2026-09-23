import { EditorState, Compartment } from "@codemirror/state";
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
import {
    indentOnInput,
    bracketMatching,
    foldGutter,
    syntaxHighlighting,
    defaultHighlightStyle,
} from "@codemirror/language";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { oneDarkTheme, oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import type { Extension } from "@codemirror/state";

/** 浅色主题：背景跟随思源变量，行号栏有边框 */
const lightTheme = EditorView.theme({
    "&": { backgroundColor: "var(--b3-theme-background)", color: "var(--b3-theme-on-background)" },
    ".cm-gutters": {
        backgroundColor: "var(--b3-theme-background-light)",
        color: "var(--b3-theme-on-surface-light)",
        borderRight: "1px solid var(--b3-border-color)",
    },
    ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--b3-theme-primary) 8%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--b3-theme-primary) 12%, transparent)" },
});

/**
 * CodeMirror 6 嵌入式编辑器封装。
 * 按题目语言动态 import 语言包；主题跟随思源（MutationObserver 监听 body class）。
 * mount/destroy 必须成对调用，避免泄漏。
 * 非并发对象：每个编辑器实例仅供单一答题面板使用。
 */
export class CodeEditor {
    private view: EditorView | null = null;
    private readonly themeCompartment = new Compartment();
    private observer: MutationObserver | null = null;

    constructor(
        private readonly parent: HTMLElement,
        private readonly lang: string,
        private readonly initialCode = "",
        private readonly onChange?: (doc: string) => void
    ) {}

    async mount(): Promise<void> {
        const languageExt = await this.loadLanguage(this.lang);
        this.view = new EditorView({
            parent: this.parent,
            state: EditorState.create({
                doc: this.initialCode,
                extensions: [
                    ...this.basicExtensions(),
                    keymap.of([
                        ...defaultKeymap,
                        ...historyKeymap,
                        ...closeBracketsKeymap,
                        ...completionKeymap,
                        indentWithTab,
                    ]),
                    languageExt,
                    this.themeCompartment.of(this.resolveTheme()),
                    EditorView.updateListener.of((v) => {
                        if (v.docChanged && this.onChange) {
                            this.onChange(v.state.doc.toString());
                        }
                    }),
                ],
            }),
        });
        this.observeTheme();
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

    destroy(): void {
        this.observer?.disconnect();
        this.observer = null;
        this.view?.destroy();
        this.view = null;
    }

    private basicExtensions(): Extension[] {
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
        ];
    }

    private resolveTheme(): Extension {
        if (this.isDark()) {
            return [oneDarkTheme, syntaxHighlighting(oneDarkHighlightStyle)];
        }
        return [lightTheme, syntaxHighlighting(defaultHighlightStyle)];
    }

    private isDark(): boolean {
        const mode = (window as any).siyuan?.config?.appearance?.mode;
        if (typeof mode === "number") return mode === 1;
        return document.body.classList.contains("theme-dark");
    }

    private observeTheme(): void {
        this.observer = new MutationObserver(() => {
            if (!this.view) return;
            this.view.dispatch({
                effects: this.themeCompartment.reconfigure(this.resolveTheme()),
            });
        });
        this.observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }

    private async loadLanguage(lang: string): Promise<Extension> {
        const key = (lang || "").toLowerCase();
        try {
            if (key === "python" || key === "py") {
                return (await import("@codemirror/lang-python")).python();
            }
            if (key === "javascript" || key === "js" || key === "typescript" || key === "ts") {
                return (await import("@codemirror/lang-javascript")).javascript({
                    typescript: key === "typescript" || key === "ts",
                });
            }
            if (key === "css") {
                return (await import("@codemirror/lang-css")).css();
            }
            if (key === "markdown" || key === "md") {
                return (await import("@codemirror/lang-markdown")).markdown();
            }
        } catch (e) {
            console.warn(`[RecallGen] 语言包加载失败: ${lang}`, e);
        }
        return [];
    }
}
