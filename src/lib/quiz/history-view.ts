import type { ScoreIndexEntry } from "@/types/quiz";

/**
 * 答题记录页「按来源」分组与「跳回原笔记」用到的判断。
 */

/**
 * 来源分组的键。
 *
 * 原先按标题去掉「·」之后的部分分组：前缀相同的两篇文档会被并成一组，
 * 文档改名后它的历史又会拆成两组。改为按 sourceDocId 分组；
 * 没有 sourceDocId 的旧记录退回按来源标题，两种键加前缀，不会互相撞上。
 */
export function sourceGroupKey(entry: Pick<ScoreIndexEntry, "sourceDocId" | "sourceTitle" | "title">): string {
    if (entry.sourceDocId) return `doc:${entry.sourceDocId}`;
    const title = (entry.sourceTitle || entry.title || "").trim();
    return title ? `title:${title}` : "none";
}

/**
 * sourceDocId 是不是一篇真实的文档。
 *
 * 粘贴材料、按日期出题、复习到期题目这些入口没有对应的文档，
 * sourceDocId 是 `manual-…`、`date-before`、`nb-…-today`、`bank-due` 这类占位值，
 * 拿去 openTab 只会打开一个找不到的块。思源的块 id 以 14 位时间戳开头。
 */
export function isOpenableDocId(id: string | undefined): id is string {
    return typeof id === "string" && /^\d{14}-[0-9a-z]+$/.test(id);
}
