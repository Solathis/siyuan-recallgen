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

/**
 * 生成文档标题。
 * 思源桌面端会用 hpath 落文件，因此需要剔除路径非法字符、控制字符，
 * 并去掉结尾的点和空格（Windows 不允许），截断长度避免超长路径。
 */
export function titleOf(sourceTitle: string, date = new Date()): string {
    const safe =
        String(sourceTitle)
            .replace(/[\u0000-\u001f]/g, "")
            .replace(/[/\\:*?"<>|]/g, "_")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/[.\s]+$/, "")
            .slice(0, 40)
            .trim() || t("doc.titlePrefix");
    return `${t("doc.titlePrefix")}_${fmtDate(date)}_${safe}`;
}

/** 选取比内容中最长反引号串更长的代码围栏，避免内容提前闭合围栏 */
function fenceFor(content: string): string {
    let longest = 0;
    for (const match of content.matchAll(/`+/g)) {
        longest = Math.max(longest, match[0].length);
    }
    return "`".repeat(Math.max(3, longest + 1));
}

/** 将内容包裹为代码块 */
function codeBlock(content: string, language = ""): string {
    const fence = fenceFor(content);
    return `${fence}${language}\n${content}\n${fence}`;
}

/**
 * 将题目集合成为结构化 Markdown，每题块带 IAL `custom-recallgen-id`，
 * 答案与解析置于折叠 details 中防止复习偷看。
 */
export function buildQuestionsMarkdown(questions: Question[]): string {
    const lines: string[] = [];

    for (const q of questions) {
        lines.push(`### ${typeLabel(q.type)} · ${diffLabel(q.difficulty)}`);
        lines.push(`{: custom-recallgen-id="${q.id}"}`);
        lines.push(q.question);
        lines.push("");

        if (q.type === "single_choice" || q.type === "multiple_choice") {
            q.options.forEach((opt, i) => {
                lines.push(`${String.fromCharCode(65 + i)}. ${opt}`);
            });
            lines.push("");
        }

        if (q.type === "coding" && q.starter_code) {
            lines.push(codeBlock(q.starter_code, q.language || ""));
            lines.push("");
        }

        lines.push(`<details><summary>${t("doc.answerSummary")}</summary>`);
        lines.push("");
        lines.push(t("doc.answerLabel") + answerText(q));
        // 解析可能为空，此时不应输出「解析：undefined」
        if (q.explanation) {
            lines.push("");
            lines.push(t("doc.explanationLabel") + q.explanation);
        }
        lines.push("");
        lines.push("</details>");
        lines.push("");
    }

    return lines.join("\n");
}

function answerText(q: Question): string {
    switch (q.type) {
        case "single_choice":
            return String.fromCharCode(65 + q.answer);
        case "multiple_choice":
            return q.answer
                .map((i) => String.fromCharCode(65 + i))
                .sort()
                .join("、");
        case "true_false":
            return q.answer ? t("common.true") : t("common.false");
        case "fill_blank":
            return q.answer.map((opts, i) => `${t("doc.blankLabel", String(i + 1))}: ${opts.join(" / ")}`).join("；");
        case "subjective":
            return q.reference_answer;
        case "coding":
            return `${t("doc.seeCode")}\n\n${codeBlock(q.answer, q.language)}`;
    }
}

/**
 * 新建文档存放题目，返回新文档 ID。
 * sourceDocId 可以是文档块 ID 或笔记本 ID（笔记本生成时）。
 */
export async function saveAsNewDoc(
    config: GeneralConfig,
    questions: Question[],
    sourceDocId: string,
    sourceTitle: string
): Promise<string> {
    const md = buildQuestionsMarkdown(questions);
    const title = titleOf(sourceTitle);

    if (config.storageLocation === "notebook" && config.notebookId) {
        return createDocWithMd(config.notebookId, `/${title}`, md);
    }

    const block = await getBlockByID(sourceDocId).catch(() => null);
    if (block) {
        // 源是文档：创建在其同级路径下
        const hpath = await getHPathByID(sourceDocId).catch(() => block.hpath);
        const parent = hpath.lastIndexOf("/") > 0 ? hpath.slice(0, hpath.lastIndexOf("/")) : "";
        return createDocWithMd(block.box, `${parent}/${title}`, md);
    }

    // 源是笔记本：直接在该笔记本根目录下创建文档
    return createDocWithMd(sourceDocId as NotebookId, `/${title}`, md);
}

/** 将薄弱点分析追加到文档末尾 */
export async function appendAnalysis(docId: string, analysis: string): Promise<void> {
    const md = `\n---\n\n${t("doc.analysisTitle")}\n\n${analysis}\n`;
    await appendBlock("markdown", md, docId);
}
