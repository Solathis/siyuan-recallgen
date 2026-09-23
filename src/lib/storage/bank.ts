import type { StoragePlugin } from "./store";
import type { BankItem, BankSummary } from "@/lib/quiz/bank";
import { masteryScore, summarizeBank } from "@/lib/quiz/bank";
import { AsyncStore } from "./store";

const BANK_NAME = "recallgen-bank.json";

/** 默认保留策略：长期未考且已掌握的题目在裁剪时优先移除 */
export const BANK_PRUNE_AFTER_MS = 180 * 24 * 60 * 60 * 1000;
/** 掌握度达到该值即认为已掌握 */
export const BANK_MASTERED_AT = 85;

/**
 * 题库存储。
 *
 * 以题干指纹为键保存题目与 FSRS 排程状态，用于：
 * - 生成时复用已有题目，避免同一篇笔记反复生成几乎相同的题
 * - 「复习到期题目」按排程出题
 * - 记录每题的作答历史，用于难度自适应与掌握度展示
 *
 * 与成绩存储不同，题库条目本身就是题目，因此使用单个文件；
 * 但为避免无限增长，提供 prune() 按保留策略清理。
 */
export class BankStore extends AsyncStore {
    constructor(plugin: StoragePlugin) {
        super(plugin, BANK_NAME);
    }

    private async readMap(): Promise<Record<string, BankItem>> {
        const data = await this.read<Record<string, BankItem>>({});
        return data && typeof data === "object" && !Array.isArray(data) ? { ...data } : {};
    }

    /** 全部题库条目 */
    async list(): Promise<BankItem[]> {
        return Object.values(await this.readMap());
    }

    async get(id: string): Promise<BankItem | null> {
        return (await this.readMap())[id] ?? null;
    }

    async count(): Promise<number> {
        return Object.keys(await this.readMap()).length;
    }

    async summary(now = Date.now()): Promise<BankSummary> {
        return summarizeBank(await this.list(), now);
    }

    /** 按指纹批量查询（生成时用于判断题目是否已存在） */
    async findMany(ids: string[]): Promise<Map<string, BankItem>> {
        const map = await this.readMap();
        const found = new Map<string, BankItem>();
        for (const id of ids) {
            const item = map[id];
            if (item) found.set(id, item);
        }
        return found;
    }

    /** 新增或整体覆盖一个条目 */
    async upsert(item: BankItem): Promise<void> {
        const map = await this.readMap();
        map[item.id] = item;
        await this.write(map);
    }

    /** 批量新增或覆盖（已存在的条目由调用方决定是否保留原有排程状态） */
    async upsertMany(items: BankItem[]): Promise<void> {
        if (items.length === 0) return;
        const map = await this.readMap();
        for (const item of items) map[item.id] = item;
        await this.write(map);
    }

    /**
     * 入库题目：已存在的条目只更新题目内容与来源，保留既有排程与作答统计。
     * 这样再次从同一篇笔记生成时，不会把复习进度清零。
     */
    async mergeQuestions(items: BankItem[]): Promise<{ added: number; updated: number }> {
        if (items.length === 0) return { added: 0, updated: 0 };
        const map = await this.readMap();
        let added = 0;
        let updated = 0;

        for (const item of items) {
            const existing = map[item.id];
            if (existing) {
                map[item.id] = {
                    ...existing,
                    // 保留 card / timesSeen / timesPassed / lastPercent / createdAt
                    question: item.question,
                    sourceDocId: item.sourceDocId,
                    sourceTitle: item.sourceTitle,
                    updatedAt: item.updatedAt,
                };
                updated++;
            } else {
                map[item.id] = item;
                added++;
            }
        }
        await this.write(map);
        return { added, updated };
    }

    async remove(id: string): Promise<void> {
        const map = await this.readMap();
        if (!(id in map)) return;
        delete map[id];
        await this.write(map);
    }

    async clear(): Promise<void> {
        await this.write({});
    }

    /**
     * 按保留策略裁剪：删除「长期未考且已掌握」的题目。
     * 返回删除条数。pruneBefore 用于测试注入时间。
     */
    async prune(
        now = Date.now(),
        { olderThanMs = BANK_PRUNE_AFTER_MS, masteredAt = BANK_MASTERED_AT } = {}
    ): Promise<number> {
        const map = await this.readMap();
        const kept: Record<string, BankItem> = {};
        let removed = 0;

        for (const [id, item] of Object.entries(map)) {
            const stale = now - (item.updatedAt || item.createdAt || 0) > olderThanMs;
            if (stale && masteryScore(item) >= masteredAt) {
                removed++;
                continue;
            }
            kept[id] = item;
        }
        if (removed > 0) await this.write(kept);
        return removed;
    }

    /** 卸载插件时删除题库数据 */
    async purgeAll(): Promise<void> {
        await this.plugin.removeData?.(BANK_NAME).catch(() => undefined);
    }
}
