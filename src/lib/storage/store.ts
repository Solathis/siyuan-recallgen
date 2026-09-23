/** 思源 Plugin 中存储相关方法的最小接口，解耦具体 Plugin 类型 */
export interface StoragePlugin {
    loadData: (name: string) => Promise<any>;
    saveData: (name: string, content: any) => Promise<any>;
    /** 思源 Plugin.removeData；可选，便于测试替身省略 */
    removeData?: (name: string) => Promise<any>;
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
            throw new StorageError(`读取 ${this.name} 失败`, this.name, e);
        }

        let value: unknown;
        if (raw === null || raw === undefined || raw === "") {
            // loadData 返回空表示尚无文件
            value = fallback;
        } else if (typeof raw === "string") {
            try {
                value = JSON.parse(raw) as T;
            } catch {
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

        const next = this.writeChain.then(() =>
            this.plugin
                .saveData(this.name, data)
                .then(() => undefined)
                .catch((e) => {
                    throw new StorageError(`写入 ${this.name} 失败`, this.name, e);
                })
        );
        // 写失败不阻断后续写链，但错误仍会传给本次调用的等待者
        this.writeChain = next.catch(() => undefined);
        return next;
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
