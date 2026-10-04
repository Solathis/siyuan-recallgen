import type { BankItem } from "./bank";
import { isPlausibleCard, normalizeBankItem, questionFingerprint } from "./bank";

/**
 * 题库备份：与成绩备份（见 export.ts）同一思路，但文件名与结构独立。
 *
 * 题库里存的是逐题的复习排程与作答历史，是使用越久越有价值的数据，
 * 却一直只能整体清空、无法迁移，因此单独提供可导出/导入的备份。
 * 导入策略与成绩备份一致：**只新增不覆盖**，已存在的指纹一律跳过，
 * 避免用旧机器的排程覆盖本机已经推进过的复习进度。
 */

/** 备份文件格式版本 */
export const BANK_BACKUP_VERSION = 1;

export interface BankBackupFile {
    app: "recallgen";
    kind: "bank";
    version: number;
    exportedAt: string;
    items: BankItem[];
}

export interface BankBackupParseResult {
    file: BankBackupFile;
    /** 解析过程中的问题提示 */
    warnings: string[];
}

/** 生成题库备份 JSON */
export function buildBankBackup(items: BankItem[]): string {
    const file: BankBackupFile = {
        app: "recallgen",
        kind: "bank",
        version: BANK_BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        items,
    };
    return JSON.stringify(file);
}

/**
 * 解析题库备份。
 * 结构不合法的条目会被丢弃并记入 warnings（而不是让整份备份失败），
 * 这样一份部分损坏的备份仍然能救回大部分题目。
 */
export function parseBankBackup(text: string): BankBackupParseResult {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        throw new Error(`题库备份不是合法 JSON: ${(e as Error).message}`);
    }
    if (!raw || typeof raw !== "object") throw new Error("题库备份内容不是对象");

    const file = raw as Partial<BankBackupFile>;
    if (file.app !== "recallgen" || file.kind !== "bank") throw new Error("不是 RecallGen 的题库备份文件");
    if (typeof file.version === "number" && file.version > BANK_BACKUP_VERSION) {
        throw new Error(`备份版本 ${file.version} 高于当前支持的 ${BANK_BACKUP_VERSION}`);
    }
    if (!Array.isArray(file.items)) throw new Error("题库备份缺少 items 数组");

    const warnings: string[] = [];
    const items: BankItem[] = [];
    const seen = new Set<string>();
    let dropped = 0;
    let repaired = 0;
    let duplicated = 0;
    let rescheduled = 0;

    for (const value of file.items) {
        const item = value as Partial<BankItem>;
        if (!isPlausibleItem(item)) {
            dropped++;
            continue;
        }
        if (!isPlausibleCard(item.card)) rescheduled++;
        const normalized = normalizeBankItem(item as BankItem);
        // 指纹是去重键：与题干不一致时以题干为准修正，而不是丢弃整条记录
        const fingerprint = questionFingerprint(normalized.question);
        if (fingerprint !== normalized.id) {
            repaired++;
            normalized.id = fingerprint;
        }
        if (seen.has(fingerprint)) {
            duplicated++;
            continue;
        }
        seen.add(fingerprint);
        items.push(normalized);
    }

    if (dropped > 0) warnings.push(`有 ${dropped} 条记录结构不完整，已跳过`);
    if (repaired > 0) warnings.push(`有 ${repaired} 条记录的题目指纹与题干不符，已按题干重新计算`);
    if (rescheduled > 0) warnings.push(`有 ${rescheduled} 条记录的复习排程缺失或非法，已重置为待复习`);
    if (duplicated > 0) warnings.push(`备份内有 ${duplicated} 条重复题目，已合并为一条`);

    return {
        file: {
            app: "recallgen",
            kind: "bank",
            version: typeof file.version === "number" ? file.version : BANK_BACKUP_VERSION,
            exportedAt: typeof file.exportedAt === "string" ? file.exportedAt : "",
            items,
        },
        warnings,
    };
}

const QUESTION_TYPES = ["single_choice", "multiple_choice", "fill_blank", "true_false", "subjective", "coding"];

/**
 * 条目至少要能定位与展示：有题干、题型可识别。
 * 排程字段缺失或非法不算致命——normalizeBankItem 会把它重置成待复习的新卡，
 * 否则一条坏记录会让裁剪/统计在后续使用时抛异常。
 */
function isPlausibleItem(value: unknown): value is BankItem {
    const item = value as Partial<BankItem>;
    return (
        !!item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        !!item.question &&
        typeof item.question === "object" &&
        typeof item.question.question === "string" &&
        item.question.question.length > 0 &&
        QUESTION_TYPES.includes(item.question.type as string)
    );
}
