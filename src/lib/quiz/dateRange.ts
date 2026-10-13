import { sql, lsNotebooks, quoteSqlLiteral } from "@/api";
import { t } from "@/lib/i18n";
import type { DateGenConfig } from "@/lib/quiz/service";
import { exportDocsMarkdown, MAX_DOCS_PER_NOTEBOOK } from "./content";

/** 日期范围类型 */
export type DateRange = "today" | "beforeToday";

/** 出题页的范围选项：今天 / 最近 N 天 / 基点之前全部 */
export type DateScope = "today" | "recent" | "all";

/**
 * 由当前配置推导所选范围。
 *
 * 「全部」沿用 beforeToday + days=0 的既有语义（dateClause 就是这么算的），
 * 所以滑块拖到 0 与点「全部」是同一件事，不必再造第三种 range。
 */
export function scopeOf(range: DateRange, days: number): DateScope {
    if (range === "today") return "today";
    return days > 0 ? "recent" : "all";
}

/** 选完范围应写入的配置：选「最近」而天数为 0 时落到缺省 7 天 */
export function applyScope(scope: DateScope, days: number): { range: DateRange; days: number } {
    if (scope === "today") return { range: "today", days };
    if (scope === "recent") return { range: "beforeToday", days: days > 0 ? days : 7 };
    return { range: "beforeToday", days: 0 };
}

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

interface CollectedDocs {
    ids: string[];
    /** 命中上限，可能还有未取到的文档 */
    capped: boolean;
}

/** 收集指定笔记本内某日期范围的文档 ID */
async function collectDocIdsByDate(notebookId: string, cfg: DateGenConfig, range: DateRange): Promise<CollectedDocs> {
    const clause = dateClause(cfg, range);
    const rows = await sql(
        `SELECT id FROM blocks WHERE box = ${quoteSqlLiteral(notebookId)} AND type = ${quoteSqlLiteral("d")} AND ${clause} ORDER BY hpath ASC LIMIT ${MAX_DOCS_PER_NOTEBOOK}`
    );
    const ids = rows?.map((r: { id: string }) => r.id) ?? [];
    return { ids, capped: ids.length >= MAX_DOCS_PER_NOTEBOOK };
}

/** 收集所有打开笔记本内某日期范围的文档 ID */
async function collectAllDocIdsByDate(cfg: DateGenConfig, range: DateRange): Promise<CollectedDocs> {
    const res = await lsNotebooks().catch(() => null);
    const notebooks = res?.notebooks?.filter((n: { closed: boolean }) => !n.closed) ?? [];
    const out: string[] = [];
    let capped = false;
    for (const nb of notebooks) {
        const collected = await collectDocIdsByDate(nb.id, cfg, range);
        out.push(...collected.ids);
        capped = capped || collected.capped;
    }
    return { ids: out, capped };
}

export interface DateRangeCount {
    /** 范围内的文档数 */
    count: number;
    /** 某个笔记本达到取用上限，实际可出题的文档只会更多 */
    capped: boolean;
}

/** 单箱 COUNT，避开把 ID 全捞出来只为数个数 */
async function countDocsByDate(notebookId: string, clause: string): Promise<number> {
    const rows = await sql(
        `SELECT COUNT(*) AS count FROM blocks WHERE box = ${quoteSqlLiteral(notebookId)} AND type = ${quoteSqlLiteral("d")} AND ${clause}`
    );
    const n = Number(rows?.[0]?.count ?? 0);
    return Number.isFinite(n) ? n : 0;
}

/** 出题前统计范围内的文档数，只作取材预估，不改变实际取用逻辑 */
export async function countDateRangeNotes(
    cfg: DateGenConfig,
    range: DateRange,
    notebookId?: string
): Promise<DateRangeCount> {
    const clause = dateClause(cfg, range);
    if (notebookId) {
        const count = await countDocsByDate(notebookId, clause);
        return { count, capped: count >= MAX_DOCS_PER_NOTEBOOK };
    }
    const res = await lsNotebooks().catch(() => null);
    const notebooks = res?.notebooks?.filter((n: { closed: boolean }) => !n.closed) ?? [];
    let count = 0;
    let capped = false;
    for (const nb of notebooks) {
        const one = await countDocsByDate(nb.id, clause);
        count += one;
        capped = capped || one >= MAX_DOCS_PER_NOTEBOOK;
    }
    return { count, capped };
}

export interface DateRangeNotes {
    content: string;
    title: string;
    /** 命中单笔记本上限，可能还有笔记未纳入 */
    capped: boolean;
    /** 因超出字符预算被跳过的文档数 */
    skipped: number;
    /** 导出失败的文档数 */
    failed: number;
}

/** 加载日期范围内的笔记内容 */
export async function loadDateRangeNotes(
    cfg: DateGenConfig,
    range: DateRange,
    notebookId?: string
): Promise<DateRangeNotes> {
    const label =
        range === "today"
            ? t("date.today")
            : cfg.days <= 0
              ? t("date.beforeBase")
              : t("date.recentDays", String(cfg.days));

    const collected = notebookId
        ? await collectDocIdsByDate(notebookId, cfg, range)
        : await collectAllDocIdsByDate(cfg, range);

    if (collected.ids.length === 0) {
        throw new Error(t("date.noNotes", label));
    }

    const result = await exportDocsMarkdown(collected.ids);
    if (!result.content.trim()) {
        throw new Error(t("date.emptyNotes", label));
    }

    // 标题里的篇数用「实际纳入」的数量：命中了多少不等于送进了提示词
    const title = notebookId
        ? t("date.notebookTitle", label, String(result.exported))
        : t("date.title", label, String(result.exported));

    return {
        content: result.content,
        title,
        capped: collected.capped,
        skipped: result.skipped,
        failed: result.failed,
    };
}
