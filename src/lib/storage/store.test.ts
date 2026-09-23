import { describe, expect, it, vi } from "vitest";
import type { StoragePlugin } from "./store";
import { AsyncStore } from "./store";

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
    return {
        plugin,
        loadData,
        saveData,
        getStored: () => stored,
    };
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

    it("fallback 为 null 时不会缓存 null（每次都重新读盘）", async () => {
        // 记录现有行为：cache!==null 的判定使 null 无法被缓存
        const { plugin, loadData } = fakePlugin(null);
        const store = new TestStore(plugin);
        await store.readData(null);
        await store.readData(null);
        expect(loadData).toHaveBeenCalledTimes(2);
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
        let n = 0;
        const plugin: StoragePlugin = {
            loadData: async () => null,
            saveData: async (_name, content) => {
                const id = (content as { id: number }).id;
                // 模拟写盘耗时，制造乱序机会
                await new Promise((r) => setTimeout(r, id === 1 ? 20 : 1));
                order.push(id);
                n++;
            },
        };
        const store = new TestStore(plugin);
        // 故意不 await，模拟并发写
        const p1 = store.writeData({ id: 1 });
        const p2 = store.writeData({ id: 2 });
        const p3 = store.writeData({ id: 3 });
        await Promise.all([p1, p2, p3]);
        expect(order).toEqual([1, 2, 3]);
        expect(n).toBe(3);
    });

    it("写入失败会向上抛出，但不阻断后续写入", async () => {
        let calls = 0;
        const plugin: StoragePlugin = {
            loadData: async () => null,
            saveData: async () => {
                calls++;
                if (calls === 1) throw new Error("磁盘满了");
            },
        };
        const store = new TestStore(plugin);
        await expect(store.writeData({ a: 1 })).rejects.toThrow("磁盘满了");
        await expect(store.writeData({ a: 2 })).resolves.toBeUndefined();
        expect(calls).toBe(2);
    });
});
