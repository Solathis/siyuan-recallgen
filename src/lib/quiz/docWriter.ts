import { appendBlock, createDocWithMd, getBlockByID, getHPathByID } from "@/api";
import { t } from "../i18n";
import type { GeneralConfig } from "@/types/config";
import type { Question } from "@/types/quiz";

function typeLabel(type: Question["type"]): string {
    return t(`type.${type}`);
}
function diffLabel(diff: Question["difficulty"]): string {
    return t(`diff.${diff}`);
}

function fmtDate(d = new Date()): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function titleOf(sourceTitle: string): string {
    const safe = sourceTitle.replace(/[\/\\:*?"<>|]/g, "_").slice(0, 40);
    return `${t("doc.titlePrefix")}_${fmtDate()}_${safe}`;
}

/**
 * 将题目集合成为结构化 Markdown，每题块带 IAL `custom-recallgen-id`，
 * 答案与解析置于折叠 details 中防止复习偷看。
 */
export function buildQuestionsMarkdown(questions: Question[]): string {
    const lines: string[] = [];
    for (const q of questions) {
        const head = `### ${typeLabel(q.type)} · ${diffLabel(q.difficulty)}`;
        lines.push(`${head}\n{: custom-recallgen-id="${q.id}"}`);
        lines.push(q.question);
        lines.push("");
        if (q.type === "single_choice" || q.type === "multiple_choice") {
            q.options.forEach((opt, i) => {
                const tag = String.fromCharCode(65 + i);
                lines.push(`${tag}. ${opt}`);
            });
            lines.push("");
        }
        if (q.type === "coding") {
            lines.push("```" + (q.language || ""));
            if (q.starter_code) lines.push(q.starter_code);
            lines.push("```");
            lines.push("");
        }
        lines.push(`<details><summary>查看答案与解析</summary>`);
        lines.push("");
        lines.push(t("doc.answerLabel") + answerText(q));
        if (q.explanation) lines.push("");
        lines.push(t("doc.explanationLabel") + q.explanation);
        lines.push("");
        lines.push(`</details>`);
        lines.push("");
    }
    return lines.join("\n");
}

function answerText(q: Question): string {
    switch (q.type) {
        case "single_choice":
            return String.fromCharCode(65 + q.answer);
        case "multiple_choice":
            return q.answer.map((i) => String.fromCharCode(65 + i)).sort().join("、");
        case "true_false":
            return q.answer ? t("common.true") : t("common.false");
        case "fill_blank":
            return q.answer.map((opts, i) => `${t("doc.blankLabel", String(i + 1))}: ${opts.join(" / ")}`).join("；");
        case "subjective":
            return q.reference_answer;
        case "coding":
            return t("doc.seeCode") + "\n\n```" + q.language + "\n" + q.answer + "\n```";
    }
}

/** 新建子文档存放题目，返回新文档 ID
 * sourceDocId 可以是文档块 ID 或笔记本 ID（笔记本生成时）。
 */
export async function saveAsNewDoc(
    config: GeneralConfig,
    questions: Question[],
    sourceDocId: string,
    sourceTitle: string,
): Promise<string> {
    const md = buildQuestionsMarkdown(questions);
    const title = titleOf(sourceTitle);

    if (config.storageLocation === "notebook" && config.notebookId) {
        return createDocWithMd(config.notebookId, "/" + title, md);
    }

    const block = await getBlockByID(sourceDocId).catch(() => null);
    if (block) {
        // 源是文档：在同级路径下创建子文档
        const hpath = await getHPathByID(sourceDocId).catch(() => block.hpath);
        const parent = hpath.lastIndexOf("/") >= 0 ? hpath.slice(0, hpath.lastIndexOf("/")) : "";
        const path = (parent || "") + "/" + title;
        return createDocWithMd(block.box, path, md);
    }

    // 源是笔记本：直接在该笔记本根目录下创建文档
    return createDocWithMd(sourceDocId as NotebookId, "/" + title, md);
}

/** 插入到当前文档末尾 */
export async function appendQuestions(
    questions: Question[],
    sourceDocId: string,
): Promise<void> {
    const md = buildQuestionsMarkdown(questions);
    await appendBlock("markdown", md, sourceDocId);
}

/** 将薄弱点分析追加到文档末尾 */
export async function appendAnalysis(docId: string, analysis: string): Promise<void> {
    const md = `\n---\n\n${t("doc.analysisTitle")}\n\n${analysis}\n`;
    await appendBlock("markdown", md, docId);
}
