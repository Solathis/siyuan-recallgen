import type { QuestionType, ScoreIndexEntry } from "@/types/quiz";
import { scorePercent } from "./stats";

/**
 * 成绩导出。
 *
 * 全部是纯函数（不触碰 DOM 与文件系统），便于单测；
 * 实际写文件由调用方用 Blob + <a download> 完成。
 */

/** 导出格式 */
export type ExportFormat = "json" | "csv" | "markdown";

/** 导出文件名的扩展名 */
export const EXPORT_EXTENSION: Record<ExportFormat, string> = {
    json: "json",
    csv: "csv",
    markdown: "md",
};

/** 导出内容所用的 MIME 类型 */
export const EXPORT_MIME: Record<ExportFormat, string> = {
    json: "application/json",
    csv: "text/csv",
    markdown: "text/markdown",
};

/** CSV 字段转义：含逗号、引号、换行时用双引号包裹并转义内部引号 */
export function csvCell(value: unknown): string {
    const text = value === null || value === undefined ? "" : String(value);
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

/** Markdown 表格单元格转义：竖线与换行会破坏表格结构 */
export function markdownCell(value: unknown): string {
    const text = value === null || value === undefined ? "" : String(value);
    return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** 按时间戳格式化为本地时间字符串 */
function fmtTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 题型标签（导出用，避免依赖界面语言字典） */
const TYPE_ORDER: QuestionType[] = [
    "single_choice",
    "multiple_choice",
    "fill_blank",
    "true_false",
    "subjective",
    "coding",
];

/**
 * 汇总某个题型维度的得分，供导出里的「题型表现」列使用。
 * 输出形如 `single_choice:12/20`，按固定题型顺序拼接，便于横向对比。
 */
export function summarizeByType(entry: ScoreIndexEntry): string {
    return TYPE_ORDER.filter((type) => entry.byType[type])
        .map((type) => {
            const agg = entry.byType[type]!;
            return `${type}:${agg.score}/${agg.maxScore}`;
        })
        .join(" ");
}

/** 导出为 JSON：保留完整索引字段，便于程序再处理 */
export function buildJsonExport(entries: ScoreIndexEntry[]): string {
    return JSON.stringify(
        {
            exportedAt: new Date().toISOString(),
            count: entries.length,
            records: entries,
        },
        null,
        2
    );
}

/** JSON 导出的列顺序 */
const CSV_HEADERS = [
    "id",
    "timestamp",
    "datetime",
    "title",
    "sourceTitle",
    "score",
    "maxScore",
    "percent",
    "questionCount",
    "passedCount",
    "unanswered",
    "durationSeconds",
    "byType",
] as const;

/** 导出为 CSV（首行为表头） */
export function buildCsvExport(entries: ScoreIndexEntry[]): string {
    const rows = entries.map((e) =>
        [
            e.id,
            e.timestamp,
            fmtTime(e.timestamp),
            e.title,
            e.sourceTitle ?? "",
            e.totalScore,
            e.maxScore,
            scorePercent(e).toFixed(1),
            e.questionCount,
            e.passedCount,
            e.unanswered,
            e.duration ?? "",
            summarizeByType(e),
        ]
            .map(csvCell)
            .join(",")
    );
    return [CSV_HEADERS.join(","), ...rows].join("\n");
}

/** 导出为 Markdown 表格 */
export function buildMarkdownExport(entries: ScoreIndexEntry[], title = "RecallGen"): string {
    const header = ["时间", "标题", "来源", "得分", "百分比", "题数", "正确", "未答", "耗时", "题型表现"];
    const align = ["---", "---", "---", "---:", "---:", "---:", "---:", "---:", "---:", "---"];
    const rows = entries.map((e) =>
        [
            fmtTime(e.timestamp),
            e.title,
            e.sourceTitle ?? "",
            `${e.totalScore}/${e.maxScore}`,
            `${scorePercent(e).toFixed(0)}%`,
            e.questionCount,
            e.passedCount,
            e.unanswered,
            e.duration ? `${e.duration}s` : "-",
            summarizeByType(e),
        ]
            .map(markdownCell)
            .join(" | ")
    );
    return [
        `# ${title}`,
        "",
        `| ${header.join(" | ")} |`,
        `| ${align.join(" | ")} |`,
        ...rows.map((r) => `| ${r} |`),
        "",
    ].join("\n");
}

/** 按格式生成导出内容 */
export function buildExport(entries: ScoreIndexEntry[], format: ExportFormat, title?: string): string {
    switch (format) {
        case "json":
            return buildJsonExport(entries);
        case "csv":
            return buildCsvExport(entries);
        case "markdown":
            return buildMarkdownExport(entries, title);
    }
}
