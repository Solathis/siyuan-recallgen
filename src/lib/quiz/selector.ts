import type { Plugin } from "siyuan";
import { getAllEditor, confirm, showMessage } from "siyuan";
import { getBlockKramdown, exportMdContent, getHPathByID } from "@/api";
import type { QuizTabData } from "./service";

const MIN_LEN = 50;

export type OpenQuizFn = (tabData: QuizTabData) => void;

/**
 * 内容选取与触发注册：右键块菜单 + 命令面板。
 * register/unregister 成对调用。
 */
export class QuizSelector {
    private readonly bound = (e: CustomEvent) => this.onBlockIcon(e);

    constructor(
        private readonly plugin: Plugin,
        private readonly open: OpenQuizFn,
    ) {}

    register(): void {
        this.plugin.eventBus.on("click-blockicon", this.bound);
        this.plugin.addCommand({
            langKey: "generateQuiz",
            callback: () => void this.onCommand(),
        });
    }

    unregister(): void {
        this.plugin.eventBus.off("click-blockicon", this.bound);
    }

    private onBlockIcon(e: CustomEvent) {
        const detail = (e as any).detail;
        detail.menu.addItem({
            icon: "iconSparkles",
            label: this.plugin.i18n.generateQuiz ?? "生成复习题",
            click: () => void this.fromBlocks(detail),
        });
    }

    private async fromBlocks(detail: any) {
        const elements: HTMLElement[] = detail.blockElements ?? [];
        const rootId: string = detail.protyle?.block?.rootID;
        const ids = elements
            .map((el) => el?.dataset?.nodeId)
            .filter((id): id is string => !!id);
        if (ids.length === 0) return;
        let content = "";
        for (const id of ids) {
            const kr = await getBlockKramdown(id).catch(() => null);
            if (kr?.kramdown) content += kr.kramdown + "\n\n";
        }
        const title = await safeTitle(rootId);
        await this.launch(content, rootId, title);
    }

    private async onCommand() {
        const editors = getAllEditor();
        if (!editors || editors.length === 0) {
            showMessage(this.plugin.i18n.openDocFirst ?? "请先打开文档");
            return;
        }
        const rootId = editors[0].protyle.block.rootID;
        const exp = await exportMdContent(rootId).catch(() => null);
        const content = exp?.content ?? "";
        const title = exp?.hPath || (await safeTitle(rootId));
        await this.launch(content, rootId, title);
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

async function safeTitle(rootId?: string): Promise<string> {
    if (!rootId) return "未命名";
    try {
        const t = await getHPathByID(rootId);
        return t || "未命名";
    } catch {
        return "未命名";
    }
}
