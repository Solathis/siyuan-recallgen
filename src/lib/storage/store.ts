import { t } from "@/lib/i18n";

/** 思源 Plugin 中存储相关方法的最小接口，解耦具体 Plugin 类型 */
export interface StoragePlugin {
    loadData: (name: string) => Promise<any>;
    saveData: (name: string, content: any) => Promise<any>;
    /** 思源 Plugin.removeData；可选，便于测试替身省略 */
    removeData?: (name: string) => Promise<any>;
}

/** 落盘失败后的重试等待 */
const WRITE_RETRY_DELAY_MS = 200;

function sleepMs(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

/** 存储操作失败时抛出的错误 */
export class StorageError extends Error {
    constructor(
        message: string,
        readonly storeName: string,
        readonly reason?: unknown
    ) {
        super(message);
        this.name = "StorageError";
    }
}

/**
 * 异步存储基类。
 * 通过思源 Plugin 的 loadData/saveData 持久化到插件数据文件。
 *
 * 保证：
 * - 读取串行化：并发首次读取只会触发一次 loadData
 * - 写入串行化：所有写操作排到一个 Promise 链上，避免并发写互相覆盖
 * - 读写不互相踩踏：读盘期间发生的写入不会被稍后返回的旧数据覆盖
 * - 写入失败会向上抛出（调用方负责提示），且不阻断后续写入
 *
 * safe for concurrent calls.
 */
export class AsyncStore {
    private writeChain: Promise<void> = Promise.resolve();
    private readChain: Promise<unknown> | null = null;
    private cache: unknown = null;
    private loaded = false;
    /** 每次写入自增，用于识别「读盘期间已被写入更新」的情况 */
    private version = 0;
    private deferredTimer: ReturnType<typeof setTimeout> | null = null;
    private deferredPending: (() => unknown) | null = null;
    private deferredWaiters: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];

    constructor(
        /** protected：子类可能需要直接调用 removeData 等未封装进基类的方法 */
        protected readonly plugin: StoragePlugin,
        private readonly name: string
    ) {}

    /** 数据文件名，错误信息里使用 */
    get storeName(): string {
        return this.name;
    }

    /**
     * 读取并缓存；首次读取后命中缓存直接返回。
     * 注意：缓存值为 null/undefined 同样会被缓存，不会每次都重新读盘。
     */
    protected async read<T>(fallback: T): Promise<T> {
        if (this.loaded) {
            return this.cache as T;
        }
        if (!this.readChain) {
            const versionAtStart = this.version;
            this.readChain = this.loadFromDisk(fallback, versionAtStart).finally(() => {
                this.readChain = null;
            });
        }
        return (await this.readChain) as T;
    }

    private async loadFromDisk<T>(fallback: T, versionAtStart: number): Promise<T> {
        let raw: unknown;
        try {
            raw = await this.plugin.loadData(this.name);
        } catch (e) {
            throw new StorageError(t("storage.readFailed", this.name), this.name, e);
        }

        let value: unknown;
        if (raw === null || raw === undefined || raw === "") {
            // loadData 返回空表示尚无文件
            value = fallback;
        } else if (typeof raw === "string") {
            try {
                value = JSON.parse(raw) as T;
            } catch {
                // 解析失败说明文件损坏。原实现直接回落默认值，
                // 而随后的第一次写入就会把损坏文件覆盖掉——数据就此永久消失。
                // 这里先留一份副本，让损坏内容还有被人工救回的机会。
                await this.preserveCorrupt(raw);
                value = fallback;
            }
        } else {
            // saveData 存对象时 loadData 直接返回对象
            value = raw;
        }

        // 读盘期间若已发生写入，则以更新的内存值为准，避免旧盘数据覆盖新状态
        if (this.version !== versionAtStart) {
            return this.cache as T;
        }
        this.cache = value;
        this.loaded = true;
        return value as T;
    }

    /**
     * 串行化写入：所有写操作按调用顺序排队执行。
     * 返回的 Promise 在本次写入落盘后 resolve；失败时 reject。
     */
    protected write(data: unknown): Promise<void> {
        this.cache = data;
        this.loaded = true;
        this.version++;

        const next = this.writeChain.then(() => this.persist(data));
        // 写失败不阻断后续写链，但错误仍会传给本次调用的等待者
        this.writeChain = next.catch(() => undefined);
        return next;
    }

    /**
     * 原子读改写。
     *
     * 直接「读 → 改 → 写」会丢数据：两次并发调用各自基于同一份旧值计算，
     * 后落盘的会覆盖先落盘的。这里把读取也放进写入链，
     * 于是读改写整体串行，第二次调用一定看到第一次的结果。
     *
     * mutate 返回 null 表示「无需变更」，此时跳过落盘。
     * 返回新对象才视为有变更——不要就地修改入参，否则改动不会被识别。
     *
     * read 由子类提供，因为它通常还要做一次结构规范化（见各 readAll）；
     * 但它必须返回与缓存同形的值，否则写回后缓存形状会与 readAll 的假设不一致。
     */
    protected update<T>(read: () => Promise<T>, mutate: (current: T) => T | null): Promise<void> {
        const next = this.writeChain.then(async () => {
            const current = await read();
            const value = mutate(current);
            if (value === null) return;
            this.cache = value;
            this.loaded = true;
            this.version++;
            await this.persist(value);
        });
        this.writeChain = next.catch(() => undefined);
        return next;
    }

    /**
     * 落盘，失败后重试一次。
     * 单次失败往往是瞬时问题（磁盘忙、内核请求抖动）；直接放弃会让
     * 「分片已写、索引未写」这类半成品状态变成常态，因此给它一次机会。
     */
    private async persist(data: unknown): Promise<void> {
        try {
            await this.plugin.saveData(this.name, data);
        } catch (first) {
            await sleepMs(WRITE_RETRY_DELAY_MS);
            try {
                await this.plugin.saveData(this.name, data);
            } catch (second) {
                throw new StorageError(t("storage.writeFailed", this.name), this.name, second ?? first);
            }
        }
    }

    /** 把损坏的原始内容另存一份，避免被后续写入覆盖掉 */
    private async preserveCorrupt(raw: string): Promise<void> {
        const backup = `${this.name}.corrupt-${Date.now()}`;
        try {
            await this.plugin.saveData(backup, raw);
            console.warn(`[RecallGen] ${this.name} 内容损坏，已留存副本 ${backup}`);
        } catch (e) {
            console.warn(`[RecallGen] ${this.name} 内容损坏，且留存副本失败`, e);
        }
    }

    /**
     * 合并写入：delayMs 内的多次调用只落盘一次，取最后一次的数据。
     * 返回的 Promise 在该次落盘完成后 settle（同一批等待者一起 settle）。
     *
     * 用于高频变更（例如设置面板每次按键都会派发保存），
     * 避免每敲一个字符就重写整个配置文件。
     */
    protected writeDeferred(getData: () => unknown, delayMs: number): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.deferredWaiters.push({ resolve, reject });
            this.deferredPending = getData;
            if (this.deferredTimer) clearTimeout(this.deferredTimer);
            // 定时器路径无人 await，失败由 waiters 承接，这里吞掉避免未捕获拒绝
            this.deferredTimer = setTimeout(() => void this.runDeferred().catch(() => undefined), delayMs);
        });
    }

    /**
     * 立即执行尚未落盘的合并写入。
     * 插件卸载/面板关闭前调用，避免丢失最后一次修改。
     */
    flushDeferred(): Promise<void> {
        if (!this.deferredTimer) return Promise.resolve();
        clearTimeout(this.deferredTimer);
        this.deferredTimer = null;
        return this.runDeferred();
    }

    /** 取出待写数据并落盘，settle 本批全部等待者 */
    private runDeferred(): Promise<void> {
        this.deferredTimer = null;
        const getData = this.deferredPending;
        const waiters = this.deferredWaiters;
        this.deferredPending = null;
        this.deferredWaiters = [];
        if (!getData) return Promise.resolve();

        return this.write(getData()).then(
            () => waiters.forEach((w) => w.resolve()),
            (e) => {
                waiters.forEach((w) => w.reject(e));
                throw e;
            }
        );
    }

    /** 等待所有排队中的写入完成 */
    flush(): Promise<void> {
        return this.writeChain;
    }

    /** 强制下次 read 重新落盘读取。 */
    invalidate(): void {
        this.cache = null;
        this.loaded = false;
        this.readChain = null;
    }
}
