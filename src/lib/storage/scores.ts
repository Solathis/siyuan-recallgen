import type { StoragePlugin } from "./store";
import type { ScoreDetail, ScoreIndexEntry, ScoreRecord } from "@/types/quiz";
import { buildIndexEntry, monthKey } from "@/lib/quiz/stats";
import { AsyncStore } from "./store";

const INDEX_NAME = "recallgen-scores-index.json";
/** v1 单一文件，迁移后保留为备份 */
const LEGACY_NAME = "recallgen-scores.json";
const LEGACY_BACKUP_NAME = "recallgen-scores.v1-backup.json";
const SHARD_PREFIX = "recallgen-scores-";

/** 索引文件结构，带版本号便于后续演进 */
interface IndexFile {
    version: number;
    entries: ScoreIndexEntry[];
}

const INDEX_VERSION = 2;

/** 索引形状兜底：结构不对时按空索引处理 */
function asIndexFile(value: unknown): IndexFile {
    const file = value as Partial<IndexFile> | null | undefined;
    if (!file || typeof file !== "object" || !Array.isArray(file.entries)) {
        return { version: INDEX_VERSION, entries: [] };
    }
    return { version: INDEX_VERSION, entries: [...file.entries] };
}

/** 明细分片形状兜底 */
function asDetailMap(value: unknown): Record<string, ScoreDetail> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? { ...(value as Record<string, ScoreDetail>) }
        : {};
}

/** 成绩索引存储：轻量条目列表 */
class ScoreIndexStore extends AsyncStore {
    constructor(plugin: StoragePlugin) {
        super(plugin, INDEX_NAME);
    }

    async readAll(): Promise<IndexFile> {
        return asIndexFile(await this.read<IndexFile>({ version: INDEX_VERSION, entries: [] }));
    }

    async writeAll(entries: ScoreIndexEntry[]): Promise<void> {
        await this.write({ version: INDEX_VERSION, entries });
    }

    /** 原子读改写索引；mutate 返回 null 表示无变化 */
    edit(mutate: (file: IndexFile) => IndexFile | null): Promise<void> {
        return super.update(() => this.readAll(), mutate);
    }
}

/** 某个月份的明细分片 */
class ShardStore extends AsyncStore {
    constructor(
        plugin: StoragePlugin,
        readonly month: string
    ) {
        super(plugin, `${SHARD_PREFIX}${month}.json`);
    }

    async readAll(): Promise<Record<string, ScoreDetail>> {
        return asDetailMap(await this.read<Record<string, ScoreDetail>>({}));
    }

    async writeAll(map: Record<string, ScoreDetail>): Promise<void> {
        await this.write(map);
    }

    /** 原子读改写分片；mutate 返回 null 表示无变化 */
    edit(mutate: (map: Record<string, ScoreDetail>) => Record<string, ScoreDetail> | null): Promise<void> {
        return super.update(() => this.readAll(), mutate);
    }
}

/**
 * 成绩历史存储。
 *
 * 结构：
 * - recallgen-scores-index.json：轻量索引（含按题型/难度的聚合值），列表与统计只读它
 * - recallgen-scores-YYYY-MM.json：按月分片的明细（题目、判分明细、分析）
 *
 * 相比原先「单个文件装下全部记录、每次交卷全量重写」，
 * 交卷写入量与该月记录数成正比，而不是与全部历史成正比。
 */
export class ScoreStore {
    private readonly index: ScoreIndexStore;
    private readonly shards = new Map<string, ShardStore>();

    constructor(private readonly plugin: StoragePlugin) {
        this.index = new ScoreIndexStore(plugin);
    }

    private shard(month: string): ShardStore {
        let store = this.shards.get(month);
        if (!store) {
            store = new ShardStore(this.plugin, month);
            this.shards.set(month, store);
        }
        return store;
    }

    /** 首次访问时把 v1 单文件迁移到「索引 + 分月分片」结构 */
    async migrateIfNeeded(): Promise<{ migrated: number }> {
        const file = await this.index.readAll();
        if (file.entries.length > 0) return { migrated: 0 };

        const legacy = await this.plugin.loadData(LEGACY_NAME).catch(() => null);
        const records = parseLegacy(legacy);
        if (records.length === 0) return { migrated: 0 };

        // 先写备份，再写新结构，最后删除旧文件：任一步失败都不会丢数据
        await this.plugin.saveData(LEGACY_BACKUP_NAME, records);
        const entries: ScoreIndexEntry[] = [];
        const byMonth = new Map<string, ScoreDetail[]>();

        for (const record of records) {
            entries.push(buildIndexEntry(record));
            const month = monthKey(record.timestamp);
            const details = byMonth.get(month) ?? [];
            details.push({
                id: record.id,
                detail: record.detail ?? [],
                questions: record.questions,
                analysis: record.analysis,
            });
            byMonth.set(month, details);
        }

        for (const [month, details] of byMonth) {
            const shard = this.shard(month);
            const map = await shard.readAll();
            for (const detail of details) map[detail.id] = detail;
            await shard.writeAll(map);
        }
        await this.index.writeAll(entries);
        await this.plugin.removeData?.(LEGACY_NAME).catch(() => undefined);

        return { migrated: records.length };
    }

    /** 全部索引条目，按时间倒序 */
    async listIndex(): Promise<ScoreIndexEntry[]> {
        const file = await this.index.readAll();
        return [...file.entries].sort((a, b) => b.timestamp - a.timestamp);
    }

    /** 按 id 加载明细；条目不存在或分片缺失时返回 null */
    async loadDetail(id: string): Promise<ScoreDetail | null> {
        const file = await this.index.readAll();
        const entry = file.entries.find((e) => e.id === id);
        if (!entry) return null;
        const map = await this.shard(monthKey(entry.timestamp)).readAll();
        return map[id] ?? null;
    }

    /** 保存一次成绩：同时写索引条目与所在月份的明细分片 */
    async add(record: ScoreRecord): Promise<void> {
        const entry = buildIndexEntry(record);
        const month = monthKey(record.timestamp);
        const detail: ScoreDetail = {
            id: record.id,
            detail: record.detail,
            questions: record.questions,
            analysis: record.analysis,
        };

        // 先写明细，再写索引：索引是列表的来源，最后写入可保证「可见即完整」
        await this.shard(month).edit((map) => ({ ...map, [record.id]: detail }));
        await this.index.edit((file) => ({
            version: INDEX_VERSION,
            entries: [...file.entries.filter((e) => e.id !== record.id), entry],
        }));
    }

    /** 导出全部成绩（索引 + 明细），用于完整备份 */
    async exportAll(): Promise<{ entries: ScoreIndexEntry[]; details: Record<string, ScoreDetail> }> {
        const file = await this.index.readAll();
        const details: Record<string, ScoreDetail> = {};
        for (const month of new Set(file.entries.map((e) => monthKey(e.timestamp)))) {
            Object.assign(details, await this.shard(month).readAll());
        }
        return { entries: [...file.entries], details };
    }

    /**
     * 批量导入成绩：按月份分组写入，索引一次写入。
     * 调用方负责跳过已存在的 id（见 planBackupImport）。
     */
    async importMany(items: { entry: ScoreIndexEntry; detail: ScoreDetail | null }[]): Promise<void> {
        if (items.length === 0) return;

        const detailByMonth = new Map<string, Record<string, ScoreDetail>>();
        for (const { entry, detail } of items) {
            if (!detail) continue;
            const month = monthKey(entry.timestamp);
            detailByMonth.set(month, { ...(detailByMonth.get(month) ?? {}), [entry.id]: detail });
        }

        for (const [month, details] of detailByMonth) {
            await this.shard(month).edit((map) => ({ ...map, ...details }));
        }

        await this.index.edit((file) => {
            const known = new Set(file.entries.map((e) => e.id));
            const merged = [...file.entries];
            for (const { entry } of items) {
                if (known.has(entry.id)) continue;
                known.add(entry.id);
                merged.push(entry);
            }
            return merged.length === file.entries.length ? null : { version: INDEX_VERSION, entries: merged };
        });
    }

    /** 更新薄弱点分析（写入明细并同步索引的 hasAnalysis 标记） */
    async updateAnalysis(id: string, analysis: string): Promise<void> {
        const month = await this.monthOf(id);
        if (!month) return;

        await this.shard(month).edit((map) => {
            const detail = map[id];
            if (!detail) return null;
            return { ...map, [id]: { ...detail, analysis } };
        });

        await this.index.edit((file) => {
            const entry = file.entries.find((e) => e.id === id);
            if (!entry || entry.hasAnalysis) return null;
            return {
                version: INDEX_VERSION,
                entries: file.entries.map((e) => (e.id === id ? { ...e, hasAnalysis: true } : e)),
            };
        });
    }

    /** 删除单条成绩（索引与明细同时删除） */
    async remove(id: string): Promise<void> {
        const month = await this.monthOf(id);
        if (!month) return;

        // 先删索引：条目立刻从列表消失，不会出现「点进去提示明细缺失」
        await this.index.edit((file) => {
            if (!file.entries.some((e) => e.id === id)) return null;
            return { version: INDEX_VERSION, entries: file.entries.filter((e) => e.id !== id) };
        });
        // 明细随后清理；即便这里失败也只剩无人引用的残留数据，不影响使用
        await this.shard(month).edit((map) => {
            if (!(id in map)) return null;
            const next = { ...map };
            delete next[id];
            return next;
        });
    }

    /** 条目所在月份；不存在时返回 null */
    private async monthOf(id: string): Promise<string | null> {
        const file = await this.index.readAll();
        const entry = file.entries.find((e) => e.id === id);
        return entry ? monthKey(entry.timestamp) : null;
    }

    /** 清空全部成绩（索引与所有已知分片） */
    async clear(): Promise<void> {
        const file = await this.index.readAll();
        const months = new Set(file.entries.map((e) => monthKey(e.timestamp)));
        for (const month of months) {
            await this.shard(month).writeAll({});
        }
        await this.index.writeAll([]);
    }

    /** 卸载插件时删除全部成绩数据 */
    async purgeAll(): Promise<void> {
        const file = await this.index.readAll();
        const months = new Set(file.entries.map((e) => monthKey(e.timestamp)));
        for (const month of months) {
            await this.plugin.removeData?.(`${SHARD_PREFIX}${month}.json`).catch(() => undefined);
        }
        await this.plugin.removeData?.(INDEX_NAME).catch(() => undefined);
        await this.plugin.removeData?.(LEGACY_NAME).catch(() => undefined);
        await this.plugin.removeData?.(LEGACY_BACKUP_NAME).catch(() => undefined);
    }

    /** 等待索引与全部分片的写入完成 */
    async flush(): Promise<void> {
        await this.index.flush();
        for (const shard of this.shards.values()) {
            await shard.flush();
        }
    }
}

/** 解析 v1 单文件内容（数组或 JSON 字符串），非法时返回空数组 */
function parseLegacy(raw: unknown): ScoreRecord[] {
    if (!raw) return [];
    let data: unknown = raw;
    if (typeof raw === "string") {
        try {
            data = JSON.parse(raw);
        } catch {
            return [];
        }
    }
    return Array.isArray(data) ? (data as ScoreRecord[]) : [];
}
