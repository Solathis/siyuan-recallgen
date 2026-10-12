import type { StoragePlugin } from "./store";
import type { BankItem, BankSummary } from "@/lib/quiz/bank";
import { masteryScore, normalizeBankItem, summarizeBank } from "@/lib/quiz/bank";
import { monthKey } from "@/lib/quiz/stats";
import { AsyncStore } from "./store";

const INDEX_NAME = "recallgen-bank-index.json";
const SHARD_PREFIX = "recallgen-bank-";

/** 默认保留策略：长期未考且已掌握的题目在裁剪时优先移除 */
export const BANK_PRUNE_AFTER_MS = 180 * 24 * 60 * 60 * 1000;
/** 掌握度达到该值即认为已掌握 */
export const BANK_MASTERED_AT = 85;

/** 索引文件结构：只记录「分片月份 → 该月的题目指纹」，用于按需定位条目 */
interface BankIndexFile {
    version: number;
    months: Record<string, string[]>;
}

const INDEX_VERSION = 1;

/** 索引形状兜底 */
function asIndexFile(value: unknown): BankIndexFile {
    const file = value as Partial<BankIndexFile> | null | undefined;
    if (!file || typeof file !== "object" || typeof file.months !== "object" || file.months === null) {
        return { version: INDEX_VERSION, months: {} };
    }
    return { version: INDEX_VERSION, months: { ...file.months } };
}

/** 题库索引：只存月份与指纹，体积很小 */
class BankIndexStore extends AsyncStore {
    constructor(plugin: StoragePlugin) {
        super(plugin, INDEX_NAME);
    }

    async readAll(): Promise<BankIndexFile> {
        return asIndexFile(await this.read<BankIndexFile>({ version: INDEX_VERSION, months: {} }));
    }

    async writeAll(months: Record<string, string[]>): Promise<void> {
        await this.write({ version: INDEX_VERSION, months });
    }

    /** 原子读改写索引；mutate 返回 null 表示无变化 */
    edit(mutate: (file: BankIndexFile) => BankIndexFile | null): Promise<void> {
        return super.update(() => this.readAll(), mutate);
    }
}

/** 某个月份的题目分片 */
class BankShardStore extends AsyncStore {
    constructor(
        plugin: StoragePlugin,
        readonly month: string
    ) {
        super(plugin, `${SHARD_PREFIX}${month}.json`);
    }

    /**
     * 读取分片并规范化条目。
     * 旧版本没有 history 字段，统一在这里补齐，
     * 这样后续写回（入库、裁剪、删除）会顺带把老数据补成新结构。
     */
    async readAll(): Promise<Record<string, BankItem>> {
        const data = await this.read<Record<string, BankItem>>({});
        if (!data || typeof data !== "object" || Array.isArray(data)) return {};
        const out: Record<string, BankItem> = {};
        for (const [id, item] of Object.entries(data)) {
            if (!item || typeof item !== "object") continue;
            out[id] = normalizeBankItem(item);
        }
        return out;
    }

    async writeAll(map: Record<string, BankItem>): Promise<void> {
        await this.write(map);
    }

    /** 原子读改写分片；mutate 返回 null 表示无变化 */
    edit(mutate: (map: Record<string, BankItem>) => Record<string, BankItem> | null): Promise<void> {
        return super.update(() => this.readAll(), mutate);
    }
}

/**
 * 题库存储。
 *
 * 与成绩采用同样的分片思路：条目按「创建月份」分片，索引只记录每月有哪些指纹。
 * 于是每次交卷只需重写当月分片与索引，写入量与当月题目数成正比，
 * 而不是与题库总量成正比——题库是随使用持续增长的，这一点很关键。
 */
export class BankStore {
    private readonly index: BankIndexStore;
    private readonly shards = new Map<string, BankShardStore>();
    /** list() 的结果缓存，写入后失效 */
    private listCache: BankItem[] | null = null;
    /** 每次写入失效时递增;读取期间代数变了,说明快照已过时,不能回填缓存 */
    private listGeneration = 0;

    constructor(protected readonly plugin: StoragePlugin) {
        this.index = new BankIndexStore(plugin);
    }

    private shard(month: string): BankShardStore {
        let store = this.shards.get(month);
        if (!store) {
            store = new BankShardStore(this.plugin, month);
            this.shards.set(month, store);
        }
        return store;
    }

    /**
     * 全部题库条目。
     *
     * 结果按「写入时失效」缓存：一次面板加载会依次调用 summary() 与 listBank()，
     * 复习入口也会再读一次，而每次读取都要遍历所有分片并逐条规范化
     * （实测 5000 条约 8ms）。缓存期间返回浅拷贝，避免调用方改动缓存数组。
     */
    async list(): Promise<BankItem[]> {
        if (this.listCache) return [...this.listCache];
        const generation = this.listGeneration;
        const file = await this.index.readAll();
        const out: BankItem[] = [];
        for (const month of Object.keys(file.months)) {
            out.push(...Object.values(await this.shard(month).readAll()));
        }
        if (generation === this.listGeneration) this.listCache = out;
        return [...out];
    }

    /** 任何写入之后都必须让 list() 的缓存失效 */
    private invalidateList(): void {
        this.listGeneration++;
        this.listCache = null;
    }

    async count(): Promise<number> {
        const file = await this.index.readAll();
        return Object.values(file.months).reduce((sum, ids) => sum + ids.length, 0);
    }

    async get(id: string): Promise<BankItem | null> {
        const file = await this.index.readAll();
        for (const [month, ids] of Object.entries(file.months)) {
            if (!ids.includes(id)) continue;
            const item = (await this.shard(month).readAll())[id];
            if (item) return item;
        }
        return null;
    }

    async summary(now = Date.now()): Promise<BankSummary> {
        return summarizeBank(await this.list(), now);
    }

    /** 按指纹批量查询：只加载命中指纹所在的月份分片 */
    async findMany(ids: string[]): Promise<Map<string, BankItem>> {
        const wanted = new Set(ids);
        const file = await this.index.readAll();
        const months = Object.entries(file.months)
            .filter(([, list]) => list.some((id) => wanted.has(id)))
            .map(([month]) => month);

        const found = new Map<string, BankItem>();
        for (const month of months) {
            const map = await this.shard(month).readAll();
            for (const id of ids) {
                const item = map[id];
                if (item && !found.has(id)) found.set(id, item);
            }
        }
        return found;
    }

    /**
     * 导入题库条目：**只新增不覆盖**。
     * 已存在的指纹一律跳过——本机可能已经把这道题复习了若干轮，
     * 用备份里的旧排程覆盖会直接抹掉复习进度。
     */
    async importItems(items: BankItem[]): Promise<{ added: number; skipped: number }> {
        if (items.length === 0) return { added: 0, skipped: 0 };
        // 同一批次内的重复先把指纹收敛，否则 added 会把同一条题算两次
        const unique = new Map<string, BankItem>();
        for (const item of items) if (!unique.has(item.id)) unique.set(item.id, item);

        const candidates = [...unique.values()];
        const existing = await this.findMany(candidates.map((item) => item.id));
        const fresh = candidates.filter((item) => !existing.has(item.id));
        await this.upsertMany(fresh);
        return { added: fresh.length, skipped: items.length - fresh.length };
    }

    /** 新增或整体覆盖一个条目 */
    async upsert(item: BankItem): Promise<void> {
        await this.upsertMany([item]);
    }

    /** 批量新增或覆盖：只写涉及的月份分片与索引 */
    async upsertMany(items: BankItem[]): Promise<void> {
        if (items.length === 0) return;
        const touched = new Map<string, string[]>();
        const groups = [...groupByMonth(items)];

        /*
         * 先把「这个月份存在」登记进索引，再写分片。
         * 索引里的 months 就是分片清单；万一分片写完而索引的 id 更新失败，
         * 启动时的 reconcile 仍能凭登记找到这个分片并把 id 补回来。
         * 只有新增月份时才会多写一次索引，代价可忽略。
         */
        const registered = await this.index.readAll();
        const fresh = groups.map(([month]) => month).filter((month) => !(month in registered.months));
        if (fresh.length > 0) {
            await this.index.edit((file) => {
                const next = { ...file.months };
                for (const month of fresh) next[month] = next[month] ?? [];
                return { ...file, months: next };
            });
        }

        for (const [month, list] of groups) {
            const shard = this.shard(month);
            await shard.edit((map) => {
                const next = { ...map };
                for (const item of list) next[item.id] = item;
                touched.set(month, Object.keys(next));
                return next;
            });
        }

        await this.index.edit((file) => ({
            ...file,
            months: { ...file.months, ...Object.fromEntries(touched) },
        }));
        this.invalidateList();
    }

    /**
     * 入库题目：已存在的条目只更新题目内容与来源，保留既有排程与作答统计。
     * 这样再次从同一篇笔记生成时，不会把复习进度清零。
     */
    async mergeQuestions(items: BankItem[]): Promise<{ added: number; updated: number }> {
        if (items.length === 0) return { added: 0, updated: 0 };

        const existing = await this.findMany(items.map((item) => item.id));
        const merged = items.map((item) => {
            const previous = existing.get(item.id);
            if (!previous) return item;
            return {
                ...previous,
                // 保留 card / timesSeen / timesPassed / lastPercent / history / createdAt
                question: item.question,
                sourceDocId: item.sourceDocId,
                sourceTitle: item.sourceTitle,
                updatedAt: item.updatedAt,
            };
        });

        await this.upsertMany(merged);
        return { added: items.length - existing.size, updated: existing.size };
    }

    async remove(id: string): Promise<void> {
        const file = await this.index.readAll();
        for (const [month, ids] of Object.entries(file.months)) {
            if (!ids.includes(id)) continue;
            const shard = this.shard(month);
            let keys: string[] | null = null;
            await shard.edit((map) => {
                if (!(id in map)) return null;
                const next = { ...map };
                delete next[id];
                keys = Object.keys(next);
                return next;
            });
            if (keys === null) return;
            // 闭包里读 let 会丢掉收窄结果，先固定成 const
            const remaining = keys;
            await this.index.edit((file) => ({ ...file, months: { ...file.months, [month]: remaining } }));
            this.invalidateList();
            return;
        }
    }

    async clear(): Promise<void> {
        const file = await this.index.readAll();
        const months = { ...file.months };
        for (const month of Object.keys(months)) {
            await this.shard(month).writeAll({});
        }
        await this.index.writeAll({});
        this.invalidateList();
    }

    /**
     * 按保留策略裁剪：删除「长期未考且已掌握」的题目，返回删除条数。
     */
    async prune(
        now = Date.now(),
        { olderThanMs = BANK_PRUNE_AFTER_MS, masteredAt = BANK_MASTERED_AT } = {}
    ): Promise<number> {
        const file = await this.index.readAll();
        let removed = 0;
        const touched = new Map<string, string[]>();

        for (const month of Object.keys(file.months)) {
            const shard = this.shard(month);
            await shard.edit((map) => {
                const kept: Record<string, BankItem> = {};
                let changed = false;

                for (const [id, item] of Object.entries(map)) {
                    const stale = now - (item.updatedAt || item.createdAt || 0) > olderThanMs;
                    if (stale && masteryScore(item) >= masteredAt) {
                        removed++;
                        changed = true;
                        continue;
                    }
                    kept[id] = item;
                }

                if (!changed) return null;
                touched.set(month, Object.keys(kept));
                return kept;
            });
        }

        if (touched.size === 0) return removed;

        // 索引键取分片的最新内容，避免与并发的入库操作错位
        for (const month of touched.keys()) {
            touched.set(month, Object.keys(await this.shard(month).readAll()));
        }
        await this.index.edit((file) => ({ ...file, months: { ...file.months, ...Object.fromEntries(touched) } }));
        this.invalidateList();
        return removed;
    }

    /**
     * 用分片内容重建索引的 id 列表，返回修复的月份数。
     *
     * 索引只是分片的派生视图：分片才是题目本体（含排程与复习历史）。
     * 两次写入之间崩溃会让两者不一致——分片里有而索引没登记（题目看不见），
     * 或索引登记了而分片里没有（列表里点开是空的）。
     * 启动时对账一次即可把两个方向都修正过来。
     *
     * 读取失败的月份跳过：可能是临时故障，绝不能把它的 id 清空成「没有题目」。
     */
    async reconcile(): Promise<number> {
        const file = await this.index.readAll();
        const months = Object.keys(file.months);
        if (months.length === 0) return 0;

        const repaired: Record<string, string[]> = {};
        for (const month of months) {
            let keys: string[];
            try {
                keys = Object.keys(await this.shard(month).readAll());
            } catch (e) {
                console.warn(`[RecallGen] 题库分片 ${month} 读取失败，跳过对账`, e);
                continue;
            }
            const known = file.months[month] ?? [];
            const same = keys.length === known.length && keys.every((id) => known.includes(id));
            if (!same) repaired[month] = keys;
        }

        const count = Object.keys(repaired).length;
        if (count === 0) return 0;

        await this.index.edit((current) => {
            const next = { ...current.months };
            for (const [month, ids] of Object.entries(repaired)) next[month] = ids;
            return { ...current, months: next };
        });
        this.invalidateList();
        return count;
    }

    /** 卸载插件时删除题库数据 */
    async purgeAll(): Promise<void> {
        const file = await this.index.readAll().catch(() => ({ version: INDEX_VERSION, months: {} }));
        for (const month of Object.keys(file.months)) {
            await this.plugin.removeData?.(`${SHARD_PREFIX}${month}.json`).catch(() => undefined);
        }
        await this.plugin.removeData?.(INDEX_NAME).catch(() => undefined);
        this.invalidateList();
    }

    /** 等待索引与全部分片的写入完成 */
    async flush(): Promise<void> {
        await this.index.flush();
        for (const shard of this.shards.values()) {
            await shard.flush();
        }
    }
}

/** 按条目的创建时间分组到月份 */
function groupByMonth(items: BankItem[]): Map<string, BankItem[]> {
    const out = new Map<string, BankItem[]>();
    for (const item of items) {
        const month = monthKey(item.createdAt || item.updatedAt || Date.now());
        const list = out.get(month);
        if (list) list.push(item);
        else out.set(month, [item]);
    }
    return out;
}
