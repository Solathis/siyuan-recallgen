import type { Plugin } from "siyuan";
import { getAllEditor, confirm, showMessage, Menu } from "siyuan";
import { getBlockKramdown, exportMdContent, getHPathByID, lsNotebooks, sql, listDocTree } from "@/api";
import { t } from "../i18n";
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
        private readonly open: OpenQuizFn,
    ) {}

    register(): void {
        this.plugin.eventBus.on("click-blockicon", this.boundBlock);
        this.plugin.eventBus.on("click-editortitleicon", this.boundTitle);
        this.plugin.eventBus.on("open-menu-doctree", this.boundDocTree);
        this.plugin.addCommand({
            langKey: "generateQuiz",
            langText: this.plugin.i18n.generateQuiz ?? t("generateQuiz"),
            callback: () => void this.onCommand(),
        });
        this.plugin.addCommand({
            langKey: "generateNotebookQuiz",
            langText: this.plugin.i18n.generateNotebookQuiz ?? t("generateNotebookQuiz"),
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
            click: () => void this.fromBlocks(detail),
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
            click: () => { if (rootId) void this.fromDoc(rootId); },
        });
        detail.menu.addItem({
            icon: "iconFiles",
            label: this.plugin.i18n.generateNotebookQuiz ?? t("generateNotebookQuiz"),
            click: () => void this.onNotebookCommand(),
        });
        detail.menu.addItem({
            icon: "iconCalendar",
            label: t("selector.fromToday"),
            click: () => this.open({ mode: "dateGenerate", sourceDocId: "date-today", sourceTitle: t("selector.todayNotes"), dateRange: "today" }),
        });
        detail.menu.addItem({
            icon: "iconHistory",
            label: t("selector.fromRecent"),
            click: () => this.open({ mode: "dateGenerate", sourceDocId: "date-before", sourceTitle: t("selector.recentNotes"), dateRange: "beforeToday" }),
        });
    }

    /** 文档树右键菜单 */
    private onDocTreeMenu(e: CustomEvent) {
        const detail = (e as any).detail;
        if (!detail?.menu || !detail?.type) return;
        const elements: NodeListOf<HTMLElement> = detail.elements;
        if (!elements || elements.length === 0) return;

        if (detail.type === "doc") {
            const docId = elements[0].getAttribute("data-node-id")
                || elements[0].getAttribute("data-id");
            if (!docId) return;
            detail.menu.addItem({
                icon: "iconSparkles",
                label: this.plugin.i18n.generateQuiz ?? t("generateQuiz"),
                click: () => void this.fromDoc(docId),
            });
            detail.menu.addItem({
                icon: "iconCalendar",
                label: t("selector.fromToday"),
                click: () => this.open({ mode: "dateGenerate", sourceDocId: "date-today", sourceTitle: t("selector.todayNotes"), dateRange: "today" }),
            });
            detail.menu.addItem({
                icon: "iconHistory",
                label: t("selector.fromRecent"),
                click: () => this.open({ mode: "dateGenerate", sourceDocId: "date-before", sourceTitle: t("selector.recentNotes"), dateRange: "beforeToday" }),
            });
        } else if (detail.type === "notebook") {
            const el = elements[0];
            const nbId = el.getAttribute("data-url")
                || el.getAttribute("data-box")
                || el.getAttribute("data-id")
                || el.getAttribute("data-node-id");
            if (!nbId) return;
            const nbName = el.querySelector(".b3-list-item__text")?.textContent?.trim()
                || el.querySelector("[title]")?.getAttribute("title")
                || t("selector.notebook");
            detail.menu.addItem({
                icon: "iconFiles",
                label: this.plugin.i18n.generateNotebookQuiz ?? t("generateNotebookQuiz"),
                click: () => void this.fromNotebook(nbId, nbName),
            });
            detail.menu.addItem({
                icon: "iconCalendar",
                label: t("selector.fromToday"),
                click: () => this.open({ mode: "dateGenerate", sourceDocId: `nb-${nbId}-today`, sourceTitle: t("selector.todayNotebookPrefix", nbName), dateRange: "today", notebookId: nbId }),
            });
            detail.menu.addItem({
                icon: "iconHistory",
                label: t("selector.fromRecent"),
                click: () => this.open({ mode: "dateGenerate", sourceDocId: `nb-${nbId}-before`, sourceTitle: t("selector.recentNotebookPrefix", nbName), dateRange: "beforeToday", notebookId: nbId }),
            });
        }
    }

    /** 命令面板：从当前文档生成 */
    private async onCommand() {
        const editors = getAllEditor();
        if (!editors || editors.length === 0) {
            showMessage(this.plugin.i18n.openDocFirst ?? t("openDocFirst"));
            return;
        }
        const rootId = editors[0].protyle.block.rootID;
        await this.fromDoc(rootId);
    }

    /** 命令面板/标题菜单：从笔记本生成 */
    private async onNotebookCommand() {
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
                click: () => void this.fromNotebook(nb.id, nb.name),
            });
        }
        const rect = document.body.getBoundingClientRect();
        menu.open({ x: rect.width / 2 - 100, y: rect.height / 2 - 50 });
    }

    private async fromBlocks(detail: any) {
        const elements: HTMLElement[] = detail.blockElements ?? [];
        const rootId: string = detail.protyle?.block?.rootID;
        const ids = elements
            .map((el: HTMLElement) => el?.dataset?.nodeId)
            .filter((id: string): id is string => !!id);
        if (ids.length === 0) return;
        let content = "";
        for (const id of ids) {
            const kr = await getBlockKramdown(id).catch(() => null);
            if (kr?.kramdown) content += kr.kramdown + "\n\n";
        }
        const title = await safeTitle(rootId);
        await this.launch(content, rootId, title);
    }

    private async fromDoc(rootId: string) {
        const exp = await exportMdContent(rootId).catch(() => null);
        const content = exp?.content ?? "";
        const title = exp?.hPath || (await safeTitle(rootId));
        await this.launch(content, rootId, title);
    }

    private async fromNotebook(notebookId: string, notebookName: string) {
        showMessage(t("selector.loadingNotebook", notebookName));
        const docIds = await collectDocIds(notebookId);
        if (docIds.length === 0) {
            showMessage(t("selector.noDocs"));
            return;
        }
        const content = await collectContent(docIds);
        if (!content.trim()) {
            showMessage(t("selector.emptyContent"));
            return;
        }
        await this.launch(content, notebookId, t("selector.notebookPrefix", notebookName));
    }

    private async launch(content: string, rootId: string, title: string) {
        const text = content.trim();
        if (text.length < MIN_LEN) {
            await this.confirmShort(text.length);
        }
        this.open({
            mode: "generate",
            content,
            sourceDocId: rootId,
            sourceTitle: title,
        });
    }

    private confirmShort(len: number): Promise<void> {
        return new Promise((resolve) => {
            confirm(
                t("selector.confirmShortTitle"),
                t("selector.confirmShortMsg", String(len)),
                () => resolve(),
                () => resolve(),
            );
        });
    }
}

/** 递归收集笔记本下所有文档 ID */
async function collectDocIds(notebookId: string): Promise<string[]> {
    const rows = await sql(`SELECT id FROM blocks WHERE box = '${notebookId}' AND type = 'd' ORDER BY hpath ASC LIMIT 200`);
    if (rows && rows.length > 0) return rows.map((r: any) => r.id as string);
    const tree = await listDocTree(notebookId as NotebookId, "/").catch(() => [] as IDocTreeNode[]);
    const ids: string[] = [];
    function walk(nodes: IDocTreeNode[]) {
        for (const n of nodes) {
            if (n.id) ids.push(n.id);
            if (n.children) walk(n.children);
        }
    }
    walk(tree);
    return ids;
}

/** 批量导出文档内容，用 --- 分隔 */
async function collectContent(docIds: string[]): Promise<string> {
    let content = "";
    for (const id of docIds) {
        const exp = await exportMdContent(id).catch(() => null);
        if (exp?.content) content += exp.content + "\n\n---\n\n";
    }
    return content;
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
