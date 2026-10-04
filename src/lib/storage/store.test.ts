import { describe, expect, it, vi } from "vitest";
import { AsyncStore, StorageError, type StoragePlugin } from "./store";

class TestStore extends AsyncStore {
    constructor(plugin: StoragePlugin) {
        super(plugin, "test.json");
    }
    readData<T>(fallback: T): Promise<T> {
        return this.read<T>(fallback);
    }
    writeData(data: unknown): Promise<void> {
        return this.write(data);
    }
    writeLater(getData: () => unknown, delayMs: number): Promise<void> {
        return this.writeDeferred(getData, delayMs);
    }
    updateData<T>(read: () => Promise<T>, mutate: (current: T) => T | null): Promise<void> {
        return this.update(read, mutate);
    }
    flushNow(): Promise<void> {
        return this.flushDeferred();
    }
    flushAll(): Promise<void> {
        return this.flush();
    }
}

function fakePlugin(initial: unknown = null) {
    const saveData = vi.fn(async (_name: string, _content: unknown) => undefined);
    let stored = initial;
    const loadData = vi.fn(async (_name: string) => stored);
    const plugin: StoragePlugin = {
        loadData,
        saveData: async (name, content) => {
            stored = content;
            return saveData(name, content);
        },
    };
    return { plugin, loadData, saveData, getStored: () => stored };
}

describe("AsyncStore.read", () => {
    it("无数据时返回 fallback", async () => {
        const { plugin } = fakePlugin(null);
        expect(await new TestStore(plugin).readData({ d: 1 })).toEqual({ d: 1 });
    });

    it("空字符串视为无数据", async () => {
        const { plugin } = fakePlugin("");
        expect(await new TestStore(plugin).readData([])).toEqual([]);
    });

    it("直接返回对象数据", async () => {
        const { plugin } = fakePlugin({ a: 1 });
        expect(await new TestStore(plugin).readData(null)).toEqual({ a: 1 });
    });

    it("字符串数据按 JSON 解析", async () => {
        const { plugin } = fakePlugin('{"a":1}');
        expect(await new TestStore(plugin).readData(null)).toEqual({ a: 1 });
    });

    it("字符串数据非法 JSON 时返回 fallback", async () => {
        const { plugin } = fakePlugin("{不是 json");
        expect(await new TestStore(plugin).readData("fallback")).toBe("fallback");
    });

    it("命中缓存时不再读取磁盘", async () => {
        const { plugin, loadData } = fakePlugin({ a: 1 });
        const store = new TestStore(plugin);
        await store.readData(null);
        await store.readData(null);
        expect(loadData).toHaveBeenCalledTimes(1);
    });

    it("invalidate 后重新读取磁盘", async () => {
        const { plugin, loadData } = fakePlugin({ a: 1 });
        const store = new TestStore(plugin);
        await store.readData(null);
        store.invalidate();
        await store.readData(null);
        expect(loadData).toHaveBeenCalledTimes(2);
    });

    it("fallback 为 null 时也会被缓存，不再重复读盘（回归：原判定 cache !== null 导致每次读盘）", async () => {
        const { plugin, loadData } = fakePlugin(null);
        const store = new TestStore(plugin);
        await store.readData(null);
        await store.readData(null);
        expect(loadData).toHaveBeenCalledTimes(1);
    });

    it("并发首次读取只触发一次 loadData（回归：原先无读串行化）", async () => {
        const { plugin, loadData } = fakePlugin({ a: 1 });
        const store = new TestStore(plugin);
        const results = await Promise.all([store.readData(null), store.readData(null), store.readData(null)]);
        expect(loadData).toHaveBeenCalledTimes(1);
        expect(results).toEqual([{ a: 1 }, { a: 1 }, { a: 1 }]);
    });

    it("读盘期间发生写入时，以内存中的新值为准（回归：旧盘数据会覆盖新状态）", async () => {
        // 用持有对象而不是 let 变量：赋值发生在 Promise 执行器里，
        // TS 会认为外层变量仍是初始值 null
        const deferred: { release?: () => void } = {};
        const plugin: StoragePlugin = {
            loadData: async () =>
                new Promise((resolve) => {
                    deferred.release = () => resolve({ a: "磁盘旧值" });
                }),
            saveData: async () => undefined,
        };
        const store = new TestStore(plugin);
        const reading = store.readData(null);
        // 读盘尚未返回时写入新值
        const writing = store.writeData({ a: "内存新值" });
        deferred.release?.();
        await Promise.all([reading, writing]);
        expect(await store.readData(null)).toEqual({ a: "内存新值" });
    });

    it("文件损坏时先留存副本再回落默认值（回归：随后的写入会把损坏内容覆盖掉）", async () => {
        const writes: Array<{ name: string; content: unknown }> = [];
        const plugin: StoragePlugin = {
            loadData: async () => "{这不是合法 json",
            saveData: async (name, content) => {
                writes.push({ name, content });
            },
        };
        const store = new TestStore(plugin);
        expect(await store.readData({ fallback: true })).toEqual({ fallback: true });
        // 副本写在校前，且内容就是原始损坏文本
        expect(writes[0].name).toMatch(/^test\.json\.corrupt-\d+$/);
        expect(writes[0].content).toBe("{这不是合法 json");

        // 之后的正常写入仍能进行（不会被「保留副本」拖住）
        await store.writeData({ a: 1 });
        expect(writes[1]).toEqual({ name: "test.json", content: { a: 1 } });
    });

    it("读取失败抛出 StorageError 并带上文件名", async () => {
        const plugin: StoragePlugin = {
            loadData: async () => {
                throw new Error("磁盘错误");
            },
            saveData: async () => undefined,
        };
        const store = new TestStore(plugin);
        await expect(store.readData(null)).rejects.toBeInstanceOf(StorageError);
        await expect(store.readData(null)).rejects.toThrow(/test\.json/);
    });
});

describe("AsyncStore.write", () => {
    it("写入后 read 直接返回新值", async () => {
        const { plugin } = fakePlugin(null);
        const store = new TestStore(plugin);
        await store.writeData({ a: 2 });
        expect(await store.readData(null)).toEqual({ a: 2 });
    });

    it("并发写入按调用顺序串行落盘", async () => {
        const order: number[] = [];
        const plugin: StoragePlugin = {
            loadData: async () => null,
            saveData: async (_name, content) => {
                const id = (content as { id: number }).id;
                // 模拟写盘耗时，制造乱序机会
                await new Promise((r) => setTimeout(r, id === 1 ? 20 : 1));
                order.push(id);
            },
        };
        const store = new TestStore(plugin);
        const writes = [store.writeData({ id: 1 }), store.writeData({ id: 2 }), store.writeData({ id: 3 })];
        await Promise.all(writes);
        expect(order).toEqual([1, 2, 3]);
    });

    it("写入失败会向上抛出 StorageError，但不阻断后续写入", async () => {
        let calls = 0;
        const plugin: StoragePlugin = {
            loadData: async () => null,
            saveData: async () => {
                calls++;
                // 前两次（首次 + 重试）都失败，之后恢复
                if (calls <= 2) throw new Error("磁盘满了");
            },
        };
        const store = new TestStore(plugin);
        await expect(store.writeData({ a: 1 })).rejects.toBeInstanceOf(StorageError);
        await expect(store.writeData({ a: 2 })).resolves.toBeUndefined();
        expect(calls).toBe(3);
    });

    it("单次落盘失败会重试一次，成功则不外抛（回归：瞬时失败直接丢一次写入）", async () => {
        let calls = 0;
        const plugin: StoragePlugin = {
            loadData: async () => null,
            saveData: async () => {
                calls++;
                if (calls === 1) throw new Error("磁盘忙");
            },
        };
        const store = new TestStore(plugin);
        await expect(store.writeData({ a: 1 })).resolves.toBeUndefined();
        expect(calls).toBe(2);
        expect(await store.readData(null)).toEqual({ a: 1 });
    });

    it("flush 等待排队中的写入完成", async () => {
        let done = false;
        const plugin: StoragePlugin = {
            loadData: async () => null,
            saveData: async () => {
                await new Promise((r) => setTimeout(r, 10));
                done = true;
            },
        };
        const store = new TestStore(plugin);
        void store.writeData({ a: 1 });
        await store.flushAll();
        expect(done).toBe(true);
    });
});

describe("AsyncStore.update", () => {
    it("并发读改写不会互相覆盖（回归：read + write 丢数据）", async () => {
        const { plugin, getStored } = fakePlugin(null);
        const store = new TestStore(plugin);
        const read = () => store.readData<Record<string, number>>({});

        // 三路并发：每路都基于「读到的当前值」追加自己的键。
        // 若读取不在写入链内串行，后写的会覆盖先写的。
        await Promise.all([
            store.updateData(read, (cur) => ({ ...cur, a: 1 })),
            store.updateData(read, (cur) => ({ ...cur, b: 2 })),
            store.updateData(read, (cur) => ({ ...cur, c: 3 })),
        ]);

        expect(getStored()).toEqual({ a: 1, b: 2, c: 3 });
    });

    it("每次 mutate 都能看到上一次的结果", async () => {
        const { plugin } = fakePlugin({ n: 0 });
        const store = new TestStore(plugin);
        const seen: number[] = [];
        const read = () => store.readData<{ n: number }>({ n: 0 });

        await Promise.all(
            [1, 2, 3].map(() =>
                store.updateData(read, (cur) => {
                    seen.push(cur.n);
                    return { n: cur.n + 1 };
                })
            )
        );

        expect(seen).toEqual([0, 1, 2]);
        expect(await read()).toEqual({ n: 3 });
    });

    it("mutate 返回 null 时跳过落盘", async () => {
        const { plugin, saveData } = fakePlugin({ n: 1 });
        const store = new TestStore(plugin);
        await store.updateData(
            () => store.readData<{ n: number }>({ n: 0 }),
            () => null
        );
        expect(saveData).not.toHaveBeenCalled();
    });

    it("update 与 write 交错时最终值取最后入队的写入", async () => {
        const { plugin, getStored } = fakePlugin(null);
        const store = new TestStore(plugin);
        const read = () => store.readData<Record<string, number>>({});

        await Promise.all([store.writeData({ x: 9 }), store.updateData(read, (cur) => ({ ...cur, y: 1 }))]);
        expect(getStored()).toEqual({ x: 9, y: 1 });
    });

    it("update 的写入失败会向上抛出 StorageError", async () => {
        const plugin: StoragePlugin = {
            loadData: async () => ({ n: 0 }),
            saveData: async () => {
                throw new Error("磁盘满了");
            },
        };
        const store = new TestStore(plugin);
        await expect(
            store.updateData(
                () => store.readData<{ n: number }>({ n: 0 }),
                (cur) => ({ n: cur.n + 1 })
            )
        ).rejects.toBeInstanceOf(StorageError);
    });
});

describe("AsyncStore.writeDeferred", () => {
    it("合并窗口内的多次写入只落盘一次，且写入最后一份数据", async () => {
        const { plugin, saveData, getStored } = fakePlugin(null);
        const store = new TestStore(plugin);
        vi.useFakeTimers();
        try {
            const p1 = store.writeLater(() => ({ v: 1 }), 100);
            const p2 = store.writeLater(() => ({ v: 2 }), 100);
            const p3 = store.writeLater(() => ({ v: 3 }), 100);
            await vi.advanceTimersByTimeAsync(100);
            await Promise.all([p1, p2, p3]);
            expect(saveData).toHaveBeenCalledTimes(1);
            expect(getStored()).toEqual({ v: 3 });
        } finally {
            vi.useRealTimers();
        }
    });

    it("合并窗口过期后再次写入会重新落盘", async () => {
        const { plugin, saveData } = fakePlugin(null);
        const store = new TestStore(plugin);
        vi.useFakeTimers();
        try {
            const p1 = store.writeLater(() => ({ v: 1 }), 100);
            await vi.advanceTimersByTimeAsync(100);
            await p1;
            const p2 = store.writeLater(() => ({ v: 2 }), 100);
            await vi.advanceTimersByTimeAsync(100);
            await p2;
            expect(saveData).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("flushDeferred 立即落盘且不丢数据", async () => {
        const { plugin, saveData, getStored } = fakePlugin(null);
        const store = new TestStore(plugin);
        vi.useFakeTimers();
        try {
            const pending = store.writeLater(() => ({ v: "最后一次修改" }), 10_000);
            await store.flushNow();
            await pending;
            expect(saveData).toHaveBeenCalledTimes(1);
            expect(getStored()).toEqual({ v: "最后一次修改" });
        } finally {
            vi.useRealTimers();
        }
    });

    it("没有待写数据时 flushDeferred 直接完成", async () => {
        const { plugin, saveData } = fakePlugin(null);
        await expect(new TestStore(plugin).flushNow()).resolves.toBeUndefined();
        expect(saveData).not.toHaveBeenCalled();
    });

    it("合并写入失败时该批等待者全部收到拒绝", async () => {
        const plugin: StoragePlugin = {
            loadData: async () => null,
            saveData: async () => {
                throw new Error("磁盘满了");
            },
        };
        const store = new TestStore(plugin);
        vi.useFakeTimers();
        try {
            const p1 = store.writeLater(() => ({ v: 1 }), 100);
            const p2 = store.writeLater(() => ({ v: 2 }), 100);
            p1.catch(() => undefined);
            p2.catch(() => undefined);
            // 推进到合并窗口 + 一次重试等待之后
            await vi.advanceTimersByTimeAsync(1000);
            await expect(p1).rejects.toBeInstanceOf(StorageError);
            await expect(p2).rejects.toBeInstanceOf(StorageError);
        } finally {
            vi.useRealTimers();
        }
    });
});
