import type { QuestionType, ScoreDetail, ScoreIndexEntry } from "@/types/quiz";
import { buildIndexEntry, scorePercent } from "./stats";

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

// ── 完整备份（与上面的报表导出不同：备份含题目与判分明细，可再导入） ──

/** 备份文件格式版本 */
export const BACKUP_VERSION = 1;

export interface ScoreBackupFile {
    app: "recallgen";
    kind: "scores";
    version: number;
    exportedAt: string;
    /** 索引条目（列表与统计所需） */
    entries: ScoreIndexEntry[];
    /** 明细，按成绩 id 索引 */
    details: Record<string, ScoreDetail>;
}

/** 生成完整备份 JSON */
export function buildScoreBackup(entries: ScoreIndexEntry[], details: Record<string, ScoreDetail>): string {
    const file: ScoreBackupFile = {
        app: "recallgen",
        kind: "scores",
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        entries,
        details,
    };
    return JSON.stringify(file);
}

/** 解析备份文件；无法识别时抛出可读错误 */
export function parseScoreBackup(text: string): ScoreBackupFile {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        throw new Error(`备份不是合法 JSON: ${(e as Error).message}`);
    }
    if (!raw || typeof raw !== "object") throw new Error("备份内容不是对象");
    const file = raw as Partial<ScoreBackupFile>;
    if (file.app !== "recallgen" || file.kind !== "scores") throw new Error("不是 RecallGen 的成绩备份文件");
    if (typeof file.version === "number" && file.version > BACKUP_VERSION) {
        throw new Error(`备份版本 ${file.version} 高于当前支持的 ${BACKUP_VERSION}`);
    }
    if (!Array.isArray(file.entries)) throw new Error("备份缺少 entries 数组");
    return {
        app: "recallgen",
        kind: "scores",
        version: typeof file.version === "number" ? file.version : BACKUP_VERSION,
        exportedAt: typeof file.exportedAt === "string" ? file.exportedAt : "",
        entries: file.entries.filter(isPlausibleEntry),
        details: file.details && typeof file.details === "object" ? file.details : {},
    };
}

/** 索引条目至少要能定位与展示，否则丢弃 */
function isPlausibleEntry(value: unknown): value is ScoreIndexEntry {
    const entry = value as Partial<ScoreIndexEntry>;
    return (
        !!entry &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        entry.id.length > 0 &&
        typeof entry.timestamp === "number" &&
        Number.isFinite(entry.timestamp)
    );
}

export interface BackupImportPlan {
    /** 需要写入的「索引条目 + 明细」 */
    items: { entry: ScoreIndexEntry; detail: ScoreDetail | null }[];
    /** 已存在而被跳过的条数 */
    skipped: number;
    /** 需要提示的问题 */
    warnings: string[];
}

/**
 * 计算导入计划：跳过已存在的成绩，并让索引条目与明细保持一致。
 *
 * 有条目的明细时以明细为准重新派生索引（聚合值、通过数、未答数都能得到保证），
 * 只有索引没有明细的记录也会导入（列表与统计可用，但无法回看题目），并提示数量。
 */
export function planBackupImport(backup: ScoreBackupFile, existingIds: Iterable<string>): BackupImportPlan {
    const existing = new Set(existingIds);
    /** 已进入计划的 id：用集合判断，避免在循环里对数组做 some 造成 O(n²) */
    const planned = new Set<string>();
    const items: BackupImportPlan["items"] = [];
    const warnings: string[] = [];
    let skipped = 0;
    let withoutDetail = 0;

    for (const entry of backup.entries) {
        if (existing.has(entry.id) || planned.has(entry.id)) {
            skipped++;
            continue;
        }
        planned.add(entry.id);
        const detail = backup.details[entry.id] ?? null;
        if (!detail || !Array.isArray(detail.detail)) {
            withoutDetail++;
            items.push({ entry, detail: null });
            continue;
        }

        // 用明细重新派生索引，避免备份里的聚合值与明细不一致
        const rebuilt = buildIndexEntry({
            id: entry.id,
            quizId: entry.quizId ?? entry.id,
            title: entry.title ?? "",
            timestamp: entry.timestamp,
            totalScore: entry.totalScore ?? detail.detail.reduce((s, r) => s + r.score, 0),
            maxScore: entry.maxScore ?? detail.detail.reduce((s, r) => s + r.maxScore, 0),
            questionCount: entry.questionCount ?? detail.detail.length,
            detail: detail.detail,
            questions: detail.questions,
            analysis: detail.analysis ?? "",
            duration: entry.duration,
            sourceDocId: entry.sourceDocId,
            sourceTitle: entry.sourceTitle,
        });
        items.push({ entry: rebuilt, detail });
    }

    if (skipped > 0) warnings.push(`已存在 ${skipped} 条成绩，已跳过（不会覆盖本机数据）`);
    if (withoutDetail > 0) warnings.push(`${withoutDetail} 条成绩没有明细，只能用于列表与统计，无法回看题目`);
    return { items, skipped, warnings };
}
