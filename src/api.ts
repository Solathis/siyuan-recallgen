/**
 * 思源内核 API 封装。
 * 只保留 RecallGen 实际使用的接口；返回值统一为 `data` 字段（`code !== 0` 时返回 null）。
 *
 * API 文档见 https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md
 */

import { fetchSyncPost, IWebSocketData } from "siyuan";

/** 调用内核 API。payload 为对象或 FormData。 */
export async function request<T = unknown>(url: string, payload: unknown, returnType: "data" | "response" = "data") {
    const response: IWebSocketData = await fetchSyncPost(url, payload);
    const res = response.code === 0 ? response.data : null;
    return (returnType === "data" ? res : response) as T;
}

// ── SQL ──────────────────────────────────────────────────────────────

export async function sql(stmt: string): Promise<any[]> {
    return request("/api/query/sql", { stmt });
}

// ── 块 ───────────────────────────────────────────────────────────────

export async function getBlockByID(blockId: string): Promise<Block> {
    const data = await sql(`select * from blocks where id ='${blockId}'`);
    return data?.[0];
}

export async function getBlockKramdown(id: BlockId): Promise<IResGetBlockKramdown> {
    return request("/api/block/getBlockKramdown", { id });
}

export async function appendBlock(
    dataType: "markdown" | "dom",
    data: string,
    parentID: BlockId | DocumentId
): Promise<IResdoOperations[]> {
    return request("/api/block/appendBlock", { dataType, data, parentID });
}

// ── 笔记本 ───────────────────────────────────────────────────────────

export async function lsNotebooks(): Promise<IReslsNotebooks> {
    return request("/api/notebook/lsNotebooks", "");
}

// ── 文档树 ───────────────────────────────────────────────────────────

export async function listDocTree(notebook: NotebookId, path: string): Promise<IDocTreeNode[]> {
    const resData = await request<{ tree: IDocTreeNode[] }>("/api/filetree/listDocTree", { notebook, path });
    return resData?.tree;
}

export async function createDocWithMd(notebook: NotebookId, path: string, markdown: string): Promise<DocumentId> {
    return request("/api/filetree/createDocWithMd", { notebook, path, markdown });
}

export async function getHPathByID(id: BlockId): Promise<string> {
    return request("/api/filetree/getHPathByID", { id });
}

// ── 导出 ─────────────────────────────────────────────────────────────

/** 导出文档 Markdown 内容 */
export async function exportMdContent(
    id: DocumentId,
    options?: {
        /** 2: 锚点文本块链；3: 仅锚点文本；4: 块引用转脚注 + 锚点哈希 */
        refMode?: 2 | 3 | 4;
        /** 0: 使用原始文本；1: 使用块引述 */
        embedMode?: 0 | 1;
        /** 是否导出 YAML front matter */
        yfm?: boolean;
    }
): Promise<IResExportMdContent> {
    return request("/api/export/exportMdContent", { id, ...(options ?? {}) });
}
