import { sql, exportMdContent, lsNotebooks } from "@/api";
import type { DateGenConfig } from "@/lib/quiz/service";

/** 日期范围类型 */
export type DateRange = "today" | "beforeToday";

/** 格式化 Date 为 SiYuan created 字段格式 YYYYMMDDHHmmss */
export function fmtTS(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 根据基点时间获取"今日"的起止时间戳。now 可注入以便测试。 */
export function dayBoundary(cfg: DateGenConfig, now: Date = new Date()): { start: Date; end: Date } {
    const start = new Date(now);
    start.setHours(cfg.baseHour, cfg.baseMinute, 0, 0);
    // 如果基点时间尚未到（现在是凌晨2点，基点是4点），"今日"从昨天4点开始
    if (start > now) start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
}

/** 构造日期查询 SQL 条件。now 可注入以便测试。 */
export function dateClause(cfg: DateGenConfig, range: DateRange, now: Date = new Date()): string {
    const { start } = dayBoundary(cfg, now);
    if (range === "today") {
        return `created >= '${fmtTS(start)}' AND created <= '${fmtTS(now)}'`;
    }
    // beforeToday: 近 N 天，基点之前
    if (cfg.days <= 0) {
        // 0 = 基点之前的所有笔记
        return `created < '${fmtTS(start)}'`;
    }
    const past = new Date(start);
    past.setDate(past.getDate() - cfg.days);
    return `created >= '${fmtTS(past)}' AND created < '${fmtTS(start)}'`;
}

/** 收集指定笔记本内某日期范围的文档 ID */
async function collectDocIdsByDate(notebookId: string, cfg: DateGenConfig, range: DateRange): Promise<string[]> {
    const clause = dateClause(cfg, range);
    const rows = await sql(
        `SELECT id FROM blocks WHERE box = '${notebookId}' AND type = 'd' AND ${clause} ORDER BY hpath ASC LIMIT 200`
    );
    return rows?.map((r: { id: string }) => r.id) ?? [];
}

/** 收集所有打开笔记本内某日期范围的文档 ID */
async function collectAllDocIdsByDate(cfg: DateGenConfig, range: DateRange): Promise<string[]> {
    const res = await lsNotebooks().catch(() => null);
    const notebooks = res?.notebooks?.filter((n: { closed: boolean }) => !n.closed) ?? [];
    const out: string[] = [];
    for (const nb of notebooks) {
        const ids = await collectDocIdsByDate(nb.id, cfg, range);
        out.push(...ids);
    }
    return out;
}

/** 加载日期范围内的笔记内容 */
export async function loadDateRangeNotes(
    cfg: DateGenConfig,
    range: DateRange,
    notebookId?: string
): Promise<{ content: string; title: string }> {
    const label = range === "today" ? "今日" : cfg.days <= 0 ? "基点之前" : `近 ${cfg.days} 天`;

    let docIds: string[];
    if (notebookId) {
        docIds = await collectDocIdsByDate(notebookId, cfg, range);
    } else {
        docIds = await collectAllDocIdsByDate(cfg, range);
    }

    if (docIds.length === 0) {
        throw new Error(`${label}没有笔记，请调整日期范围或基点时间后重试`);
    }

    let content = "";
    for (const id of docIds) {
        const exp = await exportMdContent(id).catch(() => null);
        if (exp?.content) content += exp.content + "\n\n---\n\n";
    }

    if (!content.trim()) {
        throw new Error(`${label}笔记内容为空，请检查文档是否有实际内容`);
    }

    const title = notebookId ? `笔记本·${label}笔记（${docIds.length} 篇）` : `${label}笔记（${docIds.length} 篇）`;

    return { content, title };
}
