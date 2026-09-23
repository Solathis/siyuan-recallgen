import { describe, expect, it } from "vitest";
import type { StoragePlugin } from "./store";
import type { BankItem } from "@/lib/quiz/bank";
import { applyResult, createBankItem } from "@/lib/quiz/bank";
import type { Question } from "@/types/quiz";
import { BankStore, BANK_MASTERED_AT, BANK_PRUNE_AFTER_MS } from "./bank";

const DAY = 86_400_000;
const NOW = new Date(2026, 8, 23, 12, 0, 0).getTime();

const question = (text: string): Question =>
    ({ id: "q-1", type: "true_false", difficulty: "easy", question: text, answer: true }) as Question;

const item = (text: string, now = NOW): BankItem =>
    createBankItem(question(text), { sourceDocId: "doc-1", sourceTitle: "笔记" }, now);

function memoryPlugin(initial: unknown = null) {
    let stored: unknown = initial;
    const removed: string[] = [];
    const plugin: StoragePlugin = {
        loadData: async () => stored,
        saveData: async (_name, content) => {
            stored = content;
        },
        removeData: async (name) => {
            stored = null;
            removed.push(name);
        },
    };
    return { plugin, removed, getStored: () => stored as Record<string, BankItem> | null };
}

describe("BankStore 基本读写", () => {
    it("空题库返回空数组与 0 条", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        expect(await store.list()).toEqual([]);
        expect(await store.count()).toBe(0);
    });

    it("upsert 后可读回", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const entry = item("题干 A");
        await store.upsert(entry);
        expect(await store.get(entry.id)).toMatchObject({ id: entry.id });
        expect(await store.count()).toBe(1);
    });

    it("同 id 重复 upsert 不会产生重复条目", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const entry = item("题干 A");
        await store.upsert(entry);
        await store.upsert({ ...entry, timesSeen: 5 });
        expect(await store.count()).toBe(1);
        expect((await store.get(entry.id))?.timesSeen).toBe(5);
    });

    it("upsertMany 批量写入", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        await store.upsertMany([item("A"), item("B"), item("C")]);
        expect(await store.count()).toBe(3);
    });

    it("upsertMany 空数组不写盘", async () => {
        const { plugin, getStored } = memoryPlugin();
        await new BankStore(plugin).upsertMany([]);
        expect(getStored()).toBeNull();
    });

    it("findMany 只返回命中的条目", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const a = item("A");
        const b = item("B");
        await store.upsertMany([a, b]);
        const found = await store.findMany([a.id, "不存在的指纹"]);
        expect([...found.keys()]).toEqual([a.id]);
    });

    it("remove 删除指定条目", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const a = item("A");
        const b = item("B");
        await store.upsertMany([a, b]);
        await store.remove(a.id);
        expect((await store.list()).map((i) => i.id)).toEqual([b.id]);
    });

    it("remove 不存在的 id 不抛错", async () => {
        const { plugin } = memoryPlugin();
        await expect(new BankStore(plugin).remove("missing")).resolves.toBeUndefined();
    });

    it("clear 清空题库", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        await store.upsertMany([item("A"), item("B")]);
        await store.clear();
        expect(await store.count()).toBe(0);
    });

    it("summary 汇总总数、到期数与题型分布", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const due = { ...item("已到期"), card: { ...item("已到期").card, due: NOW - DAY } };
        const later = { ...item("未到期"), card: { ...item("未到期").card, due: NOW + DAY } };
        await store.upsertMany([due, later]);
        const summary = await store.summary(NOW);
        expect(summary.total).toBe(2);
        expect(summary.due).toBe(1);
        expect(summary.byType.true_false).toBe(2);
    });
});

describe("BankStore.mergeQuestions", () => {
    it("新题目计入 added", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        expect(await store.mergeQuestions([item("A"), item("B")])).toEqual({ added: 2, updated: 0 });
    });

    it("已存在的题目只更新内容，保留排程与作答统计", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const original = item("题干相同");
        // 模拟已经复习过若干次
        const reviewed = applyResult(applyResult(original, 100, NOW), 100, NOW + DAY);
        await store.upsert(reviewed);

        const regenerated = { ...item("题干相同"), updatedAt: NOW + 10 * DAY };
        const result = await store.mergeQuestions([regenerated]);

        expect(result).toEqual({ added: 0, updated: 1 });
        const merged = await store.get(original.id);
        expect(merged?.timesSeen).toBe(2);
        expect(merged?.timesPassed).toBe(2);
        expect(merged?.card.reps).toBe(reviewed.card.reps);
        expect(merged?.updatedAt).toBe(NOW + 10 * DAY);
    });

    it("混合新增与更新", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        await store.upsert(item("已有"));
        expect(await store.mergeQuestions([item("已有"), item("全新")])).toEqual({ added: 1, updated: 1 });
    });

    it("空数组不做任何写入", async () => {
        const { plugin, getStored } = memoryPlugin();
        expect(await new BankStore(plugin).mergeQuestions([])).toEqual({ added: 0, updated: 0 });
        expect(getStored()).toBeNull();
    });
});

describe("BankStore.prune", () => {
    /** 构造一个「已掌握且长期未考」的条目：多次满分 + 时间久远 */
    function masteredItem(text: string, updatedAt: number): BankItem {
        let entry = item(text, updatedAt);
        for (let i = 0; i < 6; i++) {
            entry = applyResult(entry, 100, updatedAt + i * DAY);
        }
        return { ...entry, updatedAt };
    }

    it("清理长期未考且已掌握的题目", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const stale = masteredItem("老题", NOW - BANK_PRUNE_AFTER_MS - DAY);
        const fresh = item("新题", NOW);
        await store.upsertMany([stale, fresh]);

        expect(await store.prune(NOW)).toBe(1);
        expect((await store.list()).map((i) => i.question.question)).toEqual(["新题"]);
    });

    it("未掌握的题目即使很久没考也保留", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const weak = { ...item("薄弱题", NOW - BANK_PRUNE_AFTER_MS - DAY), updatedAt: NOW - BANK_PRUNE_AFTER_MS - DAY };
        await store.upsert(weak);
        expect(await store.prune(NOW)).toBe(0);
        expect(await store.count()).toBe(1);
    });

    it("已掌握但最近考过的题目保留", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const recent = masteredItem("最近考的", NOW - DAY);
        await store.upsert(recent);
        expect(await store.prune(NOW)).toBe(0);
    });

    it("无内容可清理时不写盘", async () => {
        let writes = 0;
        const plugin: StoragePlugin = {
            loadData: async () => ({ x: item("新题", NOW) }),
            saveData: async () => {
                writes++;
            },
        };
        expect(await new BankStore(plugin).prune(NOW)).toBe(0);
        expect(writes).toBe(0);
    });

    it("阈值可注入", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const stale = masteredItem("老题", NOW - 10 * DAY);
        await store.upsert(stale);
        expect(await store.prune(NOW, { olderThanMs: DAY })).toBe(1);
    });

    it("掌握度阈值可调低以更激进地清理", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const once = {
            ...applyResult(item("只考过一次", NOW - 40 * DAY), 60, NOW - 40 * DAY),
            updatedAt: NOW - 40 * DAY,
        };
        await store.upsert(once);
        expect(await store.prune(NOW, { olderThanMs: DAY, masteredAt: BANK_MASTERED_AT })).toBe(0);
        expect(await store.prune(NOW, { olderThanMs: DAY, masteredAt: 0 })).toBe(1);
    });
});

describe("BankStore.purgeAll", () => {
    it("删除题库数据文件", async () => {
        const { plugin, removed } = memoryPlugin({ x: item("A") });
        await new BankStore(plugin).purgeAll();
        expect(removed).toContain("recallgen-bank.json");
    });
});
