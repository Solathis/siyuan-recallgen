import { exportMdContent } from "@/api";
import pLimit from "p-limit";

/**
 * 单次生成请求允许携带的笔记字符上限。
 * 超出的文档整体跳过而不是拼接后截断，避免把一篇文档切一半送进提示词。
 */
export const MAX_CONTENT_CHARS = 200_000;

/**
 * 单个笔记本一次最多取多少篇文档。
 *
 * 笔记本出题（selector）与日期范围出题（dateRange）都受此约束：
 * 一次性把整个笔记本送进提示词既会撑爆上下文，也会把内核拖慢。
 * 各自的模块负责在命中上限时告知用户。
 */
export const MAX_DOCS_PER_NOTEBOOK = 200;

/** 并发导出文档的并发度，避免大笔记本一次性打满内核 */
export const EXPORT_CONCURRENCY = 4;

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
 * 把一段内容收敛到字符预算内。
 *
 * 单文档与选块这两条路径原先完全没有预算：一篇长文档会整篇进入提示词，
 * 模型侧只会回一个难以理解的 400（上下文超限），用户无从判断原因。
 * 截断时由调用方提示用户，避免「静默少了一半笔记」。
 */
export function clampContent(content: string, maxChars = MAX_CONTENT_CHARS): { content: string; truncated: boolean } {
    if (content.length <= maxChars) return { content, truncated: false };
    return { content: content.slice(0, maxChars), truncated: true };
}

/**
 * 并发导出多个文档的 Markdown 并按原顺序拼接。
 * - 单个文档导出失败不影响其余文档
 * - 超出字符预算的文档整体跳过，但保证至少返回首篇（必要时截断）
 */
export async function exportDocsMarkdown(docIds: string[], maxChars = MAX_CONTENT_CHARS): Promise<ExportResult> {
    // p-limit 管并发，Promise.all 的返回顺序与传入顺序一致，
    // 因此不必再自己记 index 再排序
    const limit = pLimit(EXPORT_CONCURRENCY);
    const ordered = await Promise.all(
        docIds.map((id) =>
            limit(async () => {
                const exported = await exportMdContent(id).catch(() => null);
                return { content: exported?.content ?? null };
            })
        )
    );

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
