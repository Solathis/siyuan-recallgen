import { exportMdContent } from "@/api";
import PromiseLimitPool from "@/libs/promise-pool";

/**
 * 单次生成请求允许携带的笔记字符上限。
 * 超出的文档整体跳过而不是拼接后截断，避免把一篇文档切一半送进提示词。
 */
export const MAX_CONTENT_CHARS = 200_000;

/** 并发导出文档的并发度，避免大笔记本一次性打满内核 */
const EXPORT_CONCURRENCY = 4;

export interface ExportResult {
    /** 按原顺序拼接的 Markdown 内容 */
    content: string;
    /** 成功纳入的文档数 */
    exported: number;
    /** 因超出字符预算被跳过的文档数 */
    skipped: number;
    /** 导出失败的文档数 */
    failed: number;
    /** 首篇文档即超出预算、被截断保底 */
    truncated: boolean;
}

/**
 * 并发导出多个文档的 Markdown 并按原顺序拼接。
 * - 单个文档导出失败不影响其余文档
 * - 超出字符预算的文档整体跳过，但保证至少返回首篇（必要时截断）
 */
export async function exportDocsMarkdown(docIds: string[], maxChars = MAX_CONTENT_CHARS): Promise<ExportResult> {
    const pool = new PromiseLimitPool<{ index: number; content: string | null }>(EXPORT_CONCURRENCY);

    for (let index = 0; index < docIds.length; index++) {
        const id = docIds[index];
        pool.add(async () => {
            const exported = await exportMdContent(id).catch(() => null);
            return { index, content: exported?.content ?? null };
        });
    }

    const ordered = (await pool.awaitAll()).sort((a, b) => a.index - b.index);

    const parts: string[] = [];
    let failed = 0;
    for (const item of ordered) {
        if (item.content === null) {
            failed++;
            continue;
        }
        if (item.content.trim().length > 0) parts.push(item.content);
    }

    let content = "";
    let exported = 0;
    let skipped = 0;
    let truncated = false;

    for (const part of parts) {
        if (content.length === 0 && part.length > maxChars) {
            // 首篇就超预算：截断保底，否则用户会因为一篇长文档完全无法生成题目
            content = part.slice(0, maxChars);
            truncated = true;
            exported++;
            continue;
        }
        if (content.length + part.length > maxChars) {
            skipped++;
            continue;
        }
        content += part + (exported > 0 ? "\n\n---\n\n" : "");
        exported++;
    }

    return { content, exported, skipped, failed, truncated };
}
