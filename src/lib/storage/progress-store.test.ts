import { describe, expect, it } from "vitest";
import type { StoragePlugin } from "./store";
import type { QuizSession } from "@/types/quiz";
import { ProgressStore, PROGRESS_TTL_MS } from "./progress";

function fakePlugin(initial: unknown = null) {
    let stored = initial;
    const plugin: StoragePlugin = {
        loadData: async () => stored,
        saveData: async (_name, content) => {
            stored = content;
        },
    };
    return { plugin, getStored: () => stored as Record<string, QuizSession> };
}

const session = (id: string, createdAt: number, sourceDocId = "doc-1"): QuizSession => ({
    id,
    sourceDocId,
    sourceTitle: "标题",
    questions: [],
    createdAt,
    answers: {},
});

describe("ProgressStore", () => {
    it("保存后可读取", async () => {
        const { plugin } = fakePlugin(null);
        const store = new ProgressStore(plugin);
        await store.save(session("a", 1000));
        expect(await store.load("a")).toMatchObject({ id: "a" });
    });

    it("读取不存在的进度返回 null", async () => {
        const { plugin } = fakePlugin(null);
        expect(await new ProgressStore(plugin).load("missing")).toBeNull();
    });

    it("按 sourceDocId 返回最近一次进度", async () => {
        const { plugin } = fakePlugin(null);
        const store = new ProgressStore(plugin);
        await store.save(session("old", 1000, "doc-x"));
        await store.save(session("new", 2000, "doc-x"));
        await store.save(session("other", 5000, "doc-y"));
        expect(await store.findBySourceDocId("doc-x")).toMatchObject({ id: "new" });
        expect(await store.findBySourceDocId("doc-y")).toMatchObject({ id: "other" });
    });

    it("按 sourceDocId 查不到时返回 null", async () => {
        const { plugin } = fakePlugin(null);
        expect(await new ProgressStore(plugin).findBySourceDocId("nope")).toBeNull();
    });

    it("listIds 返回全部待恢复的会话", async () => {
        const { plugin } = fakePlugin(null);
        const store = new ProgressStore(plugin);
        await store.save(session("a", 1000));
        await store.save(session("b", 2000));
        expect((await store.listIds()).sort()).toEqual(["a", "b"]);
    });

    it("clear 只删除指定会话", async () => {
        const { plugin } = fakePlugin(null);
        const store = new ProgressStore(plugin);
        await store.save(session("a", 1000));
        await store.save(session("b", 2000));
        await store.clear("a");
        expect(await store.load("a")).toBeNull();
        expect(await store.load("b")).not.toBeNull();
    });

    it("clearAll 清空全部", async () => {
        const { plugin } = fakePlugin(null);
        const store = new ProgressStore(plugin);
        await store.save(session("a", 1000));
        await store.clearAll();
        expect(await store.listIds()).toEqual([]);
    });

    it("保存不会污染调用方传入的映射（readMap 返回副本）", async () => {
        const { plugin, getStored } = fakePlugin({ a: session("a", 1000) });
        const store = new ProgressStore(plugin);
        await store.save(session("b", 2000));
        expect(Object.keys(getStored()).sort()).toEqual(["a", "b"]);
    });

    it("并发保存不同会话不会互相覆盖（回归：读改写丢数据）", async () => {
        const { plugin, getStored } = fakePlugin(null);
        const store = new ProgressStore(plugin);
        await Promise.all([
            store.save(session("a", 1000)),
            store.save(session("b", 2000)),
            store.save(session("c", 3000)),
        ]);
        expect(Object.keys(getStored()).sort()).toEqual(["a", "b", "c"]);
    });

    it("保存与清理并发时不会弄丢刚写入的会话", async () => {
        const now = Date.now();
        const { plugin } = fakePlugin({ old: session("old", now - PROGRESS_TTL_MS - 1) });
        const store = new ProgressStore(plugin);
        await Promise.all([store.pruneExpired(now), store.save(session("fresh", now))]);
        expect(await store.listIds()).toEqual(["fresh"]);
    });
});

describe("ProgressStore.pruneExpired", () => {
    const now = Date.now();

    it("清理超过 TTL 的废弃进度并返回条数", async () => {
        const { plugin } = fakePlugin({
            fresh: session("fresh", now - 1000),
            old: session("old", now - PROGRESS_TTL_MS - 1),
        });
        const store = new ProgressStore(plugin);
        expect(await store.pruneExpired(now)).toBe(1);
        expect(await store.listIds()).toEqual(["fresh"]);
    });

    it("没有过期项时不写盘", async () => {
        let writes = 0;
        const plugin: StoragePlugin = {
            loadData: async () => ({ fresh: session("fresh", now - 1000) }),
            saveData: async () => {
                writes++;
            },
        };
        expect(await new ProgressStore(plugin).pruneExpired(now)).toBe(0);
        expect(writes).toBe(0);
    });

    it("恰好等于 TTL 的进度保留（不误删边界）", async () => {
        const { plugin } = fakePlugin({ edge: session("edge", now - PROGRESS_TTL_MS) });
        const store = new ProgressStore(plugin);
        expect(await store.pruneExpired(now)).toBe(0);
        expect(await store.listIds()).toEqual(["edge"]);
    });

    it("缺少 createdAt 的脏数据会被清理", async () => {
        const { plugin } = fakePlugin({ broken: { id: "broken", answers: {} } as unknown as QuizSession });
        const store = new ProgressStore(plugin);
        expect(await store.pruneExpired(now)).toBe(1);
    });

    it("可自定义 TTL", async () => {
        const { plugin } = fakePlugin({ a: session("a", now - 500) });
        const store = new ProgressStore(plugin);
        expect(await store.pruneExpired(now, 100)).toBe(1);
    });
});
