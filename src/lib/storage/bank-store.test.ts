import { describe, expect, it } from "vitest";
import type { StoragePlugin } from "./store";
import type { BankItem } from "@/lib/quiz/bank";
import { applyResult, createBankItem, MAX_BANK_HISTORY } from "@/lib/quiz/bank";
import { monthKey } from "@/lib/quiz/stats";
import type { Question } from "@/types/quiz";
import { BankStore, BANK_MASTERED_AT, BANK_PRUNE_AFTER_MS } from "./bank";

const DAY = 86_400_000;
const NOW = new Date(2026, 8, 23, 12, 0, 0).getTime();
/** 另一个月份的基准时间，用于验证分片 */
const EARLIER = new Date(2026, 6, 10, 12, 0, 0).getTime();

const question = (text: string): Question =>
    ({ id: "q-1", type: "true_false", difficulty: "easy", question: text, answer: true }) as Question;

const item = (text: string, now = NOW): BankItem =>
    createBankItem(question(text), { sourceDocId: "doc-1", sourceTitle: "笔记" }, now);

/**
 * 按文件名存取的假存储，贴合思源 saveData/loadData 的按名读写语义。
 * 分片之后必须按名区分，否则索引与各分片会互相覆盖。
 */
function memoryPlugin(initial: Record<string, unknown> = {}) {
    const disk: Record<string, unknown> = { ...initial };
    const writes: string[] = [];
    const removed: string[] = [];
    const plugin: StoragePlugin = {
        loadData: async (name) => (name in disk ? disk[name] : null),
        saveData: async (name, content) => {
            disk[name] = content;
            writes.push(name);
        },
        removeData: async (name) => {
            delete disk[name];
            removed.push(name);
        },
    };
    return { plugin, disk, writes, removed };
}

const INDEX = "recallgen-bank-index.json";
const shardOf = (timestamp: number) => `recallgen-bank-${monthKey(timestamp)}.json`;

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
        const { plugin, writes } = memoryPlugin();
        await new BankStore(plugin).upsertMany([]);
        expect(writes).toEqual([]);
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

describe("BankStore 分片", () => {
    it("不同月份写入不同分片", async () => {
        const { plugin, disk } = memoryPlugin();
        const store = new BankStore(plugin);
        await store.upsertMany([item("本月", NOW), item("上上个月", EARLIER)]);
        expect(disk[shardOf(NOW)]).toBeDefined();
        expect(disk[shardOf(EARLIER)]).toBeDefined();
        expect(await store.count()).toBe(2);
    });

    it("索引只记录月份与指纹，不含题目本体", async () => {
        const { plugin, disk } = memoryPlugin();
        const store = new BankStore(plugin);
        const entry = item("题干 A");
        await store.upsert(entry);
        const index = JSON.stringify(disk[INDEX]);
        expect(index).toContain(entry.id);
        expect(index).not.toContain("题干 A");
    });

    it("再次入库只重写涉及的月份分片（分片的意义所在）", async () => {
        const { plugin, writes } = memoryPlugin();
        const store = new BankStore(plugin);
        await store.upsertMany([item("上月", EARLIER)]);
        writes.length = 0;
        await store.upsertMany([item("本月", NOW)]);
        expect(writes).toContain(shardOf(NOW));
        expect(writes).not.toContain(shardOf(EARLIER));
    });

    it("findMany 能找到另一月份的条目", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const older = item("上月", EARLIER);
        await store.upsertMany([older, item("本月", NOW)]);
        // 重新构造 store，确保统计的是本次真实读盘而非缓存
        const found = await new BankStore(plugin).findMany([older.id]);
        expect([...found.keys()]).toEqual([older.id]);
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
        const reviewed = applyResult(applyResult(original, 100, NOW), 100, NOW + DAY);
        await store.upsert(reviewed);

        const regenerated = { ...item("题干相同"), updatedAt: NOW + 10 * DAY };
        expect(await store.mergeQuestions([regenerated])).toEqual({ added: 0, updated: 1 });

        const merged = await store.get(original.id);
        expect(merged?.timesSeen).toBe(2);
        expect(merged?.timesPassed).toBe(2);
        expect(merged?.card.reps).toBe(reviewed.card.reps);
        expect(merged?.updatedAt).toBe(NOW + 10 * DAY);
        // 复习历史同样不能被重新生成的动作清掉
        expect(merged?.history).toEqual([
            { at: NOW, percent: 100 },
            { at: NOW + DAY, percent: 100 },
        ]);
    });

    it("混合新增与更新", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        await store.upsert(item("已有"));
        expect(await store.mergeQuestions([item("已有"), item("全新")])).toEqual({ added: 1, updated: 1 });
    });

    it("空数组不做任何写入", async () => {
        const { plugin, writes } = memoryPlugin();
        expect(await new BankStore(plugin).mergeQuestions([])).toEqual({ added: 0, updated: 0 });
        expect(writes).toEqual([]);
    });
});

describe("BankStore 复习历史", () => {
    it("交卷后的作答记录随条目一起持久化", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const original = item("历史题");
        await store.upsert(applyResult(applyResult(original, 70, NOW), 95, NOW + DAY));

        const loaded = await store.get(original.id);
        expect(loaded?.history).toEqual([
            { at: NOW, percent: 70 },
            { at: NOW + DAY, percent: 95 },
        ]);
    });

    it("读取旧分片时补齐缺失的 history 字段", async () => {
        const original = item("旧结构");
        const legacy = { ...original, timesSeen: 3, timesPassed: 2 } as Partial<BankItem>;
        delete legacy.history;
        const { plugin } = memoryPlugin({
            [INDEX]: { version: 1, months: { [monthKey(NOW)]: [original.id] } },
            [shardOf(NOW)]: { [original.id]: legacy },
        });

        const loaded = await new BankStore(plugin).get(original.id);
        expect(loaded?.history).toEqual([]);
        expect(loaded?.timesSeen).toBe(3);
        expect(loaded?.timesPassed).toBe(2);
    });

    it("历史条数超过上限时只保留最近若干次", async () => {
        const original = item("长历史");
        const history = Array.from({ length: MAX_BANK_HISTORY + 3 }, (_, i) => ({ at: NOW + i, percent: 60 }));
        const { plugin } = memoryPlugin({
            [INDEX]: { version: 1, months: { [monthKey(NOW)]: [original.id] } },
            [shardOf(NOW)]: { [original.id]: { ...original, history } },
        });

        const loaded = await new BankStore(plugin).get(original.id);
        expect(loaded?.history).toHaveLength(MAX_BANK_HISTORY);
    });

    it("分片里混入非法条目时跳过而不报错", async () => {
        const original = item("正常条目");
        const { plugin } = memoryPlugin({
            [INDEX]: { version: 1, months: { [monthKey(NOW)]: [original.id] } },
            [shardOf(NOW)]: { [original.id]: original, "bad-id": null },
        });

        const list = await new BankStore(plugin).list();
        expect(list.map((entry) => entry.id)).toEqual([original.id]);
    });
});

describe("BankStore.prune", () => {
    /** 已掌握且长期未考的条目：连续满分若干次 */
    function masteredItem(text: string, createdAt: number, updatedAt: number): BankItem {
        let entry = item(text, createdAt);
        for (let i = 0; i < 6; i++) {
            entry = applyResult(entry, 100, createdAt + i * DAY);
        }
        return { ...entry, updatedAt };
    }

    it("清理长期未考且已掌握的题目", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const staleAt = NOW - BANK_PRUNE_AFTER_MS - DAY;
        await store.upsertMany([masteredItem("老题", staleAt, staleAt), item("新题", NOW)]);
        expect(await store.prune(NOW)).toBe(1);
        expect((await store.list()).map((i) => i.question.question)).toEqual(["新题"]);
    });

    it("未掌握的题目即使很久没考也保留", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        const staleAt = NOW - BANK_PRUNE_AFTER_MS - DAY;
        await store.upsert({ ...item("薄弱题", staleAt), updatedAt: staleAt });
        expect(await store.prune(NOW)).toBe(0);
        expect(await store.count()).toBe(1);
    });

    it("已掌握但最近考过的题目保留", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        await store.upsert(masteredItem("最近考的", NOW - DAY, NOW - DAY));
        expect(await store.prune(NOW)).toBe(0);
    });

    it("无内容可清理时不写盘", async () => {
        const { plugin, writes } = memoryPlugin();
        const store = new BankStore(plugin);
        await store.upsert(item("新题", NOW));
        writes.length = 0;
        expect(await store.prune(NOW)).toBe(0);
        expect(writes).toEqual([]);
    });

    it("只重写有内容被删掉的分片", async () => {
        const { plugin, writes } = memoryPlugin();
        const store = new BankStore(plugin);
        const staleAt = NOW - BANK_PRUNE_AFTER_MS - DAY;
        await store.upsertMany([masteredItem("老题", staleAt, staleAt), item("新题", NOW)]);
        writes.length = 0;

        expect(await store.prune(NOW)).toBe(1);
        expect(writes).toEqual([shardOf(staleAt), INDEX]);
    });

    it("阈值可注入", async () => {
        const { plugin } = memoryPlugin();
        const store = new BankStore(plugin);
        await store.upsert(masteredItem("老题", NOW - 10 * DAY, NOW - 10 * DAY));
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
    it("删除索引与全部分片", async () => {
        const { plugin, removed } = memoryPlugin();
        const store = new BankStore(plugin);
        await store.upsertMany([item("本月", NOW), item("上上个月", EARLIER)]);
        await store.purgeAll();
        expect(removed).toContain(INDEX);
        expect(removed).toContain(shardOf(NOW));
        expect(removed).toContain(shardOf(EARLIER));
    });

    it("空题库时只删除索引，不抛错", async () => {
        const { plugin, removed } = memoryPlugin();
        await expect(new BankStore(plugin).purgeAll()).resolves.toBeUndefined();
        expect(removed).toEqual([INDEX]);
    });
});
