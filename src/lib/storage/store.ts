/** 思源 Plugin 中存储相关方法的最小接口，解耦具体 Plugin 类型 */
export interface StoragePlugin {
    loadData: (name: string) => Promise<any>;
    saveData: (name: string, content: any) => Promise<any>;
}

/**
 * 异步存储基类。
 * 通过思源 Plugin 的 loadData/saveData 持久化到插件数据文件。
 * 写入串行化：所有写操作排到一个 Promise 链上，避免并发写覆盖。
 * safe for concurrent calls.
 */
export class AsyncStore {
    private writeChain: Promise<void> = Promise.resolve();
    private cache: unknown = null;
    private loaded = false;

    constructor(
        private readonly plugin: StoragePlugin,
        private readonly name: string
    ) {}

    /** 读取并缓存；首次读取后缓存命中直接返回。 */
    protected async read<T>(fallback: T): Promise<T> {
        if (this.loaded && this.cache !== null) {
            return this.cache as T;
        }
        const raw = await this.plugin.loadData(this.name);
        // loadData 返回 null/undefined 表示无文件
        if (raw === null || raw === undefined || raw === "") {
            this.cache = fallback;
        } else if (typeof raw === "string") {
            try {
                this.cache = JSON.parse(raw) as T;
            } catch {
                this.cache = fallback;
            }
        } else {
            // saveData 存对象时 loadData 直接返回对象
            this.cache = raw as T;
        }
        this.loaded = true;
        return this.cache as T;
    }

    /**
     * 串行化写入：所有写操作排队执行，后到的覆盖先到的。
     * 返回的 Promise 在本次写入落盘后 resolve。
     * safe for concurrent calls.
     */
    protected write(data: unknown): Promise<void> {
        this.cache = data;
        this.loaded = true;
        const next = this.writeChain.then(() => this.plugin.saveData(this.name, data).then(() => undefined));
        // 写失败不阻断后续写链，错误由调用方捕获
        this.writeChain = next.catch(() => undefined);
        return next;
    }

    /** 强制下次 read 重新落盘读取。 */
    invalidate(): void {
        this.cache = null;
        this.loaded = false;
    }
}
