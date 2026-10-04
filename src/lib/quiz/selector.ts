import type { Plugin } from "siyuan";
import { getAllEditor, confirm, showMessage, Menu } from "siyuan";
import { getBlockKramdown, exportMdContent, getHPathByID, lsNotebooks, sql, listDocTree, quoteSqlLiteral } from "@/api";
import { localeText, t } from "../i18n";
import { clampContent, exportDocsMarkdown, MAX_CONTENT_CHARS } from "./content";
import type { QuizTabData } from "./service";

const MIN_LEN = 50;

export type OpenQuizFn = (tabData: QuizTabData) => void;

/**
 * 内容选取与触发注册。
 * 入口：块菜单、文档标题图标菜单、文档树右键菜单、命令面板。
 */
export class QuizSelector {
    private readonly boundBlock = (e: CustomEvent) => this.onBlockIcon(e);
    private readonly boundTitle = (e: CustomEvent) => this.onTitleIcon(e);
    private readonly boundDocTree = (e: CustomEvent) => this.onDocTreeMenu(e);

    constructor(
        private readonly plugin: Plugin,
        private readonly open: OpenQuizFn
    ) {}

    register(): void {
        this.plugin.eventBus.on("click-blockicon", this.boundBlock);
        this.plugin.eventBus.on("click-editortitleicon", this.boundTitle);
        this.plugin.eventBus.on("open-menu-doctree", this.boundDocTree);
        this.plugin.addCommand({
            langKey: "generateQuiz",
            langText: localeText(this.plugin.i18n, "generateQuiz", t("generateQuiz")),
            callback: () => void this.onCommand(),
        });
        this.plugin.addCommand({
            langKey: "reviewDue",
            langText: localeText(this.plugin.i18n, "reviewDue", t("bank.reviewDue")),
            callback: () => this.openDueReview(),
        });
        this.plugin.addCommand({
            langKey: "generateNotebookQuiz",
            langText: localeText(this.plugin.i18n, "generateNotebookQuiz", t("generateNotebookQuiz")),
            callback: () => void this.onNotebookCommand(),
        });
    }

    unregister(): void {
        this.plugin.eventBus.off("click-blockicon", this.boundBlock);
        this.plugin.eventBus.off("click-editortitleicon", this.boundTitle);
        this.plugin.eventBus.off("open-menu-doctree", this.boundDocTree);
    }

    /** 块图标菜单：生成复习题 */
    private onBlockIcon(e: CustomEvent) {
        const detail = (e as any).detail;
        if (!detail?.menu) return;
        detail.menu.addItem({
            icon: "iconSparkles",
            label: this.plugin.i18n.generateQuiz ?? t("generateQuiz"),
            click: () => void this.run(() => this.fromBlocks(detail)),
        });
    }

    /** 文档标题图标菜单 */
    private onTitleIcon(e: CustomEvent) {
        const detail = (e as any).detail;
        if (!detail?.menu) return;
        const rootId: string = detail?.data?.rootID || detail?.data?.id || detail?.protyle?.block?.rootID;
        detail.menu.addItem({
            icon: "iconSparkles",
            label: this.plugin.i18n.generateQuiz ?? t("generateQuiz"),
            click: () => {
                if (rootId) void this.run(() => this.fromDoc(rootId));
            },
        });
        detail.menu.addItem({
            icon: "iconFiles",
            label: this.plugin.i18n.generateNotebookQuiz ?? t("generateNotebookQuiz"),
            click: () => void this.onNotebookCommand(),
        });
        detail.menu.addItem({
            icon: "iconHistory",
            label: t("bank.reviewDue"),
            click: () => this.openDueReview(),
        });
        if (rootId) {
            detail.menu.addItem({
                icon: "iconHistory",
                label: t("bank.reviewDueDoc"),
                click: () =>
                    this.open({
                        mode: "reviewDue",
                        sourceDocId: rootId,
                        sourceTitle: t("bank.reviewDueDoc"),
                        dueSourceDocId: rootId,
                    }),
            });
        }
        detail.menu.addItem({
            icon: "iconCalendar",
            label: t("selector.fromToday"),
            click: () =>
                this.open({
                    mode: "dateGenerate",
                    sourceDocId: "date-today",
                    sourceTitle: t("selector.todayNotes"),
                    dateRange: "today",
                }),
        });
        detail.menu.addItem({
            icon: "iconHistory",
            label: t("selector.fromRecent"),
            click: () =>
                this.open({
                    mode: "dateGenerate",
                    sourceDocId: "date-before",
                    sourceTitle: t("selector.recentNotes"),
                    dateRange: "beforeToday",
                }),
        });
    }

    /** 文档树右键菜单 */
    private onDocTreeMenu(e: CustomEvent) {
        const detail = (e as any).detail;
        if (!detail?.menu || !detail?.type) return;
        const elements: NodeListOf<HTMLElement> = detail.elements;
        if (!elements || elements.length === 0) return;

        if (detail.type === "doc") {
            const docId = elements[0].getAttribute("data-node-id") || elements[0].getAttribute("data-id");
            if (!docId) return;
            detail.menu.addItem({
                icon: "iconSparkles",
                label: this.plugin.i18n.generateQuiz ?? t("generateQuiz"),
                click: () => void this.run(() => this.fromDoc(docId)),
            });
            detail.menu.addItem({
                icon: "iconHistory",
                label: t("bank.reviewDueDoc"),
                click: () => this.run(async () => this.openDueReviewForDoc(docId, await safeTitle(docId))),
            });
            detail.menu.addItem({
                icon: "iconCalendar",
                label: t("selector.fromToday"),
                click: () =>
                    this.open({
                        mode: "dateGenerate",
                        sourceDocId: "date-today",
                        sourceTitle: t("selector.todayNotes"),
                        dateRange: "today",
                    }),
            });
            detail.menu.addItem({
                icon: "iconHistory",
                label: t("selector.fromRecent"),
                click: () =>
                    this.open({
                        mode: "dateGenerate",
                        sourceDocId: "date-before",
                        sourceTitle: t("selector.recentNotes"),
                        dateRange: "beforeToday",
                    }),
            });
        } else if (detail.type === "notebook") {
            const el = elements[0];
            const nbId =
                el.getAttribute("data-url") ||
                el.getAttribute("data-box") ||
                el.getAttribute("data-id") ||
                el.getAttribute("data-node-id");
            if (!nbId) return;
            const nbName =
                el.querySelector(".b3-list-item__text")?.textContent?.trim() ||
                el.querySelector("[title]")?.getAttribute("title") ||
                t("selector.notebook");
            detail.menu.addItem({
                icon: "iconFiles",
                label: this.plugin.i18n.generateNotebookQuiz ?? t("generateNotebookQuiz"),
                click: () => void this.run(() => this.fromNotebook(nbId, nbName)),
            });
            detail.menu.addItem({
                icon: "iconCalendar",
                label: t("selector.fromToday"),
                click: () =>
                    this.open({
                        mode: "dateGenerate",
                        sourceDocId: `nb-${nbId}-today`,
                        sourceTitle: t("selector.todayNotebookPrefix", nbName),
                        dateRange: "today",
                        notebookId: nbId,
                    }),
            });
            detail.menu.addItem({
                icon: "iconHistory",
                label: t("selector.fromRecent"),
                click: () =>
                    this.open({
                        mode: "dateGenerate",
                        sourceDocId: `nb-${nbId}-before`,
                        sourceTitle: t("selector.recentNotebookPrefix", nbName),
                        dateRange: "beforeToday",
                        notebookId: nbId,
                    }),
            });
        }
    }

    /** 复习某篇文档的到期题目 */
    private openDueReviewForDoc(docId: string, title: string) {
        this.open({
            mode: "reviewDue",
            sourceDocId: docId,
            sourceTitle: title,
            dueSourceDocId: docId,
        });
    }

    /** 复习到期题目：不依赖文档，直接按题库排程出题 */
    private openDueReview() {
        this.open({
            mode: "reviewDue",
            sourceDocId: "bank-due",
            sourceTitle: t("bank.reviewDue"),
        });
    }

    /** 命令面板：从当前文档生成 */
    private async onCommand() {
        const editors = getAllEditor();
        if (!editors || editors.length === 0) {
            showMessage(localeText(this.plugin.i18n, "openDocFirst", t("openDocFirst")));
            return;
        }
        const rootId = editors[0].protyle.block.rootID;
        await this.run(() => this.fromDoc(rootId));
    }

    /** 命令面板/标题菜单：从笔记本生成 */
    private async onNotebookCommand() {
        await this.run(async () => {
            const res = await lsNotebooks().catch(() => null);
            const notebooks = res?.notebooks?.filter((n: Notebook) => !n.closed) ?? [];
            if (notebooks.length === 0) {
                showMessage(t("selector.noNotebook"));
                return;
            }
            if (notebooks.length === 1) {
                await this.fromNotebook(notebooks[0].id, notebooks[0].name);
                return;
            }
            const menu = new Menu("rg-notebook");
            for (const nb of notebooks) {
                menu.addItem({
                    icon: "iconFiles",
                    label: nb.name,
                    click: () => void this.run(() => this.fromNotebook(nb.id, nb.name)),
                });
            }
            const rect = document.body.getBoundingClientRect();
            menu.open({ x: rect.width / 2 - 100, y: rect.height / 2 - 50 });
        });
    }

    /**
     * 统一入口包装：所有以 `void` 触发的异步入口都必须经过这里，
     * 否则失败会变成无人处理的 Promise 拒绝，用户看不到任何提示。
     */
    private async run(action: () => Promise<void>): Promise<void> {
        try {
            await action();
        } catch (e) {
            console.error("[RecallGen] 生成复习题失败", e);
            showMessage(t("selector.actionFailed", (e as Error).message ?? String(e)), 7000, "error");
        }
    }

    private async fromBlocks(detail: any) {
        const elements: HTMLElement[] = detail.blockElements ?? [];
        const rootId: string = detail.protyle?.block?.rootID;
        const ids = elements.map((el: HTMLElement) => el?.dataset?.nodeId).filter((id: string): id is string => !!id);
        if (ids.length === 0) return;

        const parts: string[] = [];
        for (const id of ids) {
            const kr = await getBlockKramdown(id).catch(() => null);
            if (kr?.kramdown) parts.push(kr.kramdown);
        }
        const title = await safeTitle(rootId);
        const { content, truncated } = clampContent(parts.join("\n\n"));
        this.warnTruncated(truncated);
        await this.launch(content, rootId, title);
    }

    private async fromDoc(rootId: string) {
        const exp = await exportMdContent(rootId).catch(() => null);
        const title = exp?.hPath || (await safeTitle(rootId));
        // 单文档同样要过预算：整篇长文档送进提示词只会换来一个看不懂的 400
        const { content, truncated } = clampContent(exp?.content ?? "");
        this.warnTruncated(truncated);
        await this.launch(content, rootId, title);
    }

    /** 内容被截断时告知用户，避免以为整篇笔记都参与了出题 */
    private warnTruncated(truncated: boolean): void {
        if (truncated) showMessage(t("selector.contentTruncated", String(MAX_CONTENT_CHARS)), 8000);
    }

    private async fromNotebook(notebookId: string, notebookName: string) {
        showMessage(t("selector.loadingNotebook", notebookName));
        const { ids, truncated } = await collectDocIds(notebookId);
        if (ids.length === 0) {
            showMessage(t("selector.noDocs"), 7000, "error");
            return;
        }
        if (truncated) {
            showMessage(t("selector.docsTruncated", String(ids.length)), 7000, "error");
        }

        const result = await exportDocsMarkdown(ids);
        if (!result.content.trim()) {
            showMessage(t("selector.emptyContent"), 7000, "error");
            return;
        }
        if (result.skipped > 0 || result.truncated) {
            showMessage(t("selector.contentLimited", String(result.exported)));
        }
        await this.launch(result.content, notebookId, t("selector.notebookPrefix", notebookName));
    }

    private async launch(content: string, rootId: string, title: string) {
        const text = content.trim();
        if (text.length < MIN_LEN) {
            // 内容过短时先确认；用户取消则不再打开答题面板
            const ok = await this.confirmShort(text.length);
            if (!ok) return;
        }
        this.open({
            mode: "generate",
            content,
            sourceDocId: rootId,
            sourceTitle: title,
        });
    }

    /** 内容过短时的二次确认，返回用户是否选择继续 */
    private confirmShort(len: number): Promise<boolean> {
        return new Promise((resolve) => {
            confirm(
                t("selector.confirmShortTitle"),
                t("selector.confirmShortMsg", String(len)),
                () => resolve(true),
                () => resolve(false)
            );
        });
    }
}

/** 文档数量上限，超过则截断并提示用户缩小范围 */
const MAX_DOCS = 200;

/** 收集笔记本下所有文档 ID；truncated 表示命中了数量上限 */
async function collectDocIds(notebookId: string): Promise<{ ids: string[]; truncated: boolean }> {
    const rows = await sql(
        `SELECT id FROM blocks WHERE box = ${quoteSqlLiteral(notebookId)} AND type = ${quoteSqlLiteral("d")} ORDER BY hpath ASC LIMIT ${MAX_DOCS + 1}`
    ).catch(() => null);

    if (rows && rows.length > 0) {
        return { ids: rows.slice(0, MAX_DOCS).map((r: any) => r.id as string), truncated: rows.length > MAX_DOCS };
    }

    const tree = await listDocTree(notebookId as NotebookId, "/").catch(() => [] as IDocTreeNode[]);
    const ids: string[] = [];
    const walk = (nodes: IDocTreeNode[]) => {
        for (const n of nodes) {
            if (ids.length >= MAX_DOCS) return;
            if (n.id) ids.push(n.id);
            if (n.children) walk(n.children);
        }
    };
    walk(tree);
    return { ids, truncated: false };
}

async function safeTitle(rootId?: string): Promise<string> {
    if (!rootId) return t("selector.unnamed");
    try {
        const t2 = await getHPathByID(rootId);
        return t2 || t("selector.unnamed");
    } catch {
        return t("selector.unnamed");
    }
}
