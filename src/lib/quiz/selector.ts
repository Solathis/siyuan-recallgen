import type { Plugin } from "siyuan";
import { getAllEditor, confirm, showMessage, Menu } from "siyuan";
import { getBlockKramdown, exportMdContent, getHPathByID, lsNotebooks, sql, listDocTree } from "@/api";
import type { QuizTabData } from "./service";

const MIN_LEN = 50;

export type OpenQuizFn = (tabData: QuizTabData) => void;

/** 日期范围："today"=今日 | "beforeToday"=今天之前 */
type DateRange = "today" | "beforeToday";

/** 格式化 Date 为 SiYuan created 字段格式 YYYYMMDDHHmmss */
function fmtTS(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 构造日期查询 SQL 条件 */
function dateClause(range: DateRange): string {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const todayStart = fmtTS(now);
    if (range === "today") {
        const end = new Date(now);
        end.setHours(23, 59, 59);
        return `created >= '${todayStart}' AND created <= '${fmtTS(end)}'`;
    }
    // beforeToday: 今天之前的所有笔记
    return `created < '${todayStart}'`;
}

/** 收集指定笔记本内某日期范围的文档 ID */
async function collectDocIdsByDate(notebookId: string, range: DateRange): Promise<string[]> {
    const clause = dateClause(range);
    const rows = await sql(`SELECT id FROM blocks WHERE box = '${notebookId}' AND type = 'd' AND ${clause} ORDER BY hpath ASC LIMIT 100`);
    return rows?.map((r: any) => r.id as string) ?? [];
}

/** 收集所有打开笔记本内某日期范围的文档 ID */
async function collectAllDocIdsByDate(range: DateRange): Promise<{ id: string; name: string }[]> {
    const res = await lsNotebooks().catch(() => null);
    const notebooks = res?.notebooks?.filter((n: Notebook) => !n.closed) ?? [];
    const out: { id: string; name: string }[] = [];
    for (const nb of notebooks) {
        const ids = await collectDocIdsByDate(nb.id, range);
        for (const id of ids) out.push({ id, name: nb.name });
    }
    return out;
}

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
            langText: this.plugin.i18n.generateQuiz ?? "💡 生成复习题",
            callback: () => void this.onCommand(),
        });
        this.plugin.addCommand({
            langKey: "generateNotebookQuiz",
            langText: this.plugin.i18n.generateNotebookQuiz ?? "📚 从笔记本生成复习题",
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
            label: this.plugin.i18n.generateQuiz ?? "生成复习题",
            click: () => void this.fromBlocks(detail),
        });
    }

    /** 文档标题图标菜单：生成复习题 + 从笔记本生成 + 今日/今天之前笔记 */
    private onTitleIcon(e: CustomEvent) {
        const detail = (e as any).detail;
        if (!detail?.menu) return;
        const rootId: string = detail?.data?.rootID || detail?.data?.id || detail?.protyle?.block?.rootID;
        detail.menu.addItem({
            icon: "iconSparkles",
            label: this.plugin.i18n.generateQuiz ?? "生成复习题",
            click: () => { if (rootId) void this.fromDoc(rootId); },
        });
        detail.menu.addItem({
            icon: "iconFiles",
            label: this.plugin.i18n.generateNotebookQuiz ?? "从笔记本生成复习题",
            click: () => void this.onNotebookCommand(),
        });
        detail.menu.addItem({
            icon: "iconCalendar",
            label: "从今日笔记生成",
            click: () => void this.fromDateRange("today"),
        });
        detail.menu.addItem({
            icon: "iconHistory",
            label: "从今天之前笔记生成",
            click: () => void this.fromDateRange("beforeToday"),
        });
    }

    /** 文档树右键菜单：文档→生成复习题，笔记本→从笔记本生成+日期范围 */
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
                label: this.plugin.i18n.generateQuiz ?? "生成复习题",
                click: () => void this.fromDoc(docId),
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
                || "笔记本";
            detail.menu.addItem({
                icon: "iconFiles",
                label: this.plugin.i18n.generateNotebookQuiz ?? "从笔记本生成复习题",
                click: () => void this.fromNotebook(nbId, nbName),
            });
            detail.menu.addItem({
                icon: "iconCalendar",
                label: "从今日笔记生成",
                click: () => void this.fromNotebookByDate(nbId, nbName, "today"),
            });
            detail.menu.addItem({
                icon: "iconHistory",
                label: "从今天之前笔记生成",
                click: () => void this.fromNotebookByDate(nbId, nbName, "beforeToday"),
            });
        }
    }

    /** 命令面板：从当前文档生成 */
    private async onCommand() {
        const editors = getAllEditor();
        if (!editors || editors.length === 0) {
            showMessage(this.plugin.i18n.openDocFirst ?? "请先打开文档");
            return;
        }
        const rootId = editors[0].protyle.block.rootID;
        await this.fromDoc(rootId);
    }

    /** 命令面板/标题菜单：从笔记本生成（弹出选择对话框） */
    private async onNotebookCommand() {
        const res = await lsNotebooks().catch(() => null);
        const notebooks = res?.notebooks?.filter((n: Notebook) => !n.closed) ?? [];
        if (notebooks.length === 0) {
            showMessage("没有打开的笔记本");
            return;
        }
        if (notebooks.length === 1) {
            await this.fromNotebook(notebooks[0].id, notebooks[0].name);
            return;
        }
        // 多个笔记本时弹出 Menu 选择
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
        showMessage(`正在加载笔记本「${notebookName}」的内容…`);
        const docIds = await collectDocIds(notebookId);
        if (docIds.length === 0) {
            showMessage("笔记本中没有文档");
            return;
        }
        const content = await collectContent(docIds);
        if (!content.trim()) {
            showMessage("笔记本中的文档内容为空");
            return;
        }
        await this.launch(content, notebookId, `笔记本·${notebookName}`);
    }

    /** 从所有笔记本中收集今日/今天之前笔记并生成 */
    private async fromDateRange(range: DateRange) {
        const label = range === "today" ? "今日" : "今天之前";
        showMessage(`正在加载${label}笔记…`);
        const docs = await collectAllDocIdsByDate(range);
        if (docs.length === 0) {
            showMessage(`${label}没有笔记，已停止生成`);
            return;
        }
        const content = await collectContent(docs.map((d) => d.id));
        if (!content.trim()) {
            showMessage(`${label}笔记内容为空，已停止生成`);
            return;
        }
        await this.launch(content, `date-${range}`, `${label}笔记（${docs.length} 篇）`);
    }

    /** 从指定笔记本中收集今日/今天之前笔记并生成 */
    private async fromNotebookByDate(notebookId: string, notebookName: string, range: DateRange) {
        const label = range === "today" ? "今日" : "今天之前";
        showMessage(`正在加载「${notebookName}」${label}笔记…`);
        const docIds = await collectDocIdsByDate(notebookId, range);
        if (docIds.length === 0) {
            showMessage(`「${notebookName}」${label}没有笔记，已停止生成`);
            return;
        }
        const content = await collectContent(docIds);
        if (!content.trim()) {
            showMessage(`「${notebookName}」${label}笔记内容为空，已停止生成`);
            return;
        }
        await this.launch(content, notebookId, `${notebookName}·${label}笔记`);
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
                "⚠️",
                `笔记内容过短（${len} 字），可能无法生成有效题目，是否继续？`,
                () => resolve(),
                () => resolve(),
            );
        });
    }
}

/** 递归收集笔记本下所有文档 ID */
async function collectDocIds(notebookId: string): Promise<string[]> {
    const rows = await sql(`SELECT id FROM blocks WHERE box = '${notebookId}' AND type = 'd' ORDER BY hpath ASC LIMIT 100`);
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
    if (!rootId) return "未命名";
    try {
        const t = await getHPathByID(rootId);
        return t || "未命名";
    } catch {
        return "未命名";
    }
}
