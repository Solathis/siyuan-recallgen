import { describe, expect, it } from "vitest";
import type { StoragePlugin } from "./store";
import type { GradingResult, Question, ScoreIndexEntry, ScoreRecord } from "@/types/quiz";
import { ScoreStore } from "./scores";
import { monthKey } from "@/lib/quiz/stats";

/** 内存文件系统，模拟思源 saveData/loadData/removeData */
function memoryPlugin(files: Record<string, unknown> = {}) {
    const disk: Record<string, unknown> = { ...files };
    const saves: string[] = [];
    const removed: string[] = [];
    const plugin: StoragePlugin = {
        loadData: async (name) => (name in disk ? disk[name] : null),
        saveData: async (name, content) => {
            disk[name] = content;
            saves.push(name);
        },
        removeData: async (name) => {
            delete disk[name];
            removed.push(name);
        },
    };
    return { plugin, disk, saves, removed };
}

const question = (id: string, type: Question["type"]): Question =>
    ({ id, type, difficulty: "medium", question: "题干" }) as Question;

const result = (questionId: string, type: Question["type"], score: number): GradingResult =>
    ({
        questionId,
        type,
        method: "local",
        correct: score >= 60,
        score,
        maxScore: 100,
        userAnswer: { type: "true_false", value: true },
    }) as GradingResult;

const record = (id: string, timestamp: number, score = 80, analysis = ""): ScoreRecord => ({
    id,
    quizId: `quiz-${id}`,
    title: `记录 ${id}`,
    timestamp,
    totalScore: score,
    maxScore: 100,
    questionCount: 1,
    detail: [result("q-1", "true_false", score)],
    questions: [question("q-1", "true_false")],
    analysis,
    duration: 60,
    sourceDocId: "doc-1",
    sourceTitle: "来源",
});

/** 构造索引条目（不带明细），用于导入用例 */
const indexEntry = (id: string, timestamp: number): ScoreIndexEntry => ({
    id,
    quizId: `quiz-${id}`,
    title: `记录 ${id}`,
    timestamp,
    totalScore: 100,
    maxScore: 100,
    questionCount: 1,
    passedCount: 1,
    unanswered: 0,
    byType: {},
    byDifficulty: {},
    byTag: {},
    hasAnalysis: false,
});

const MARCH = new Date(2026, 2, 10, 9, 0, 0).getTime();
const APRIL = new Date(2026, 3, 2, 9, 0, 0).getTime();

describe("ScoreStore.add / listIndex / loadDetail", () => {
    it("写入索引条目与所在月份的明细分片", async () => {
        const { plugin, disk } = memoryPlugin();
        const store = new ScoreStore(plugin);
        await store.add(record("s-1", MARCH));

        expect(disk["recallgen-scores-index.json"]).toBeDefined();
        expect(disk[`recallgen-scores-${monthKey(MARCH)}.json`]).toBeDefined();

        const index = await store.listIndex();
        expect(index).toHaveLength(1);
        expect(index[0]).toMatchObject({ id: "s-1", title: "记录 s-1" });
    });

    it("不同月份写入不同分片", async () => {
        const { plugin, disk } = memoryPlugin();
        const store = new ScoreStore(plugin);
        await store.add(record("s-1", MARCH));
        await store.add(record("s-2", APRIL));

        expect(disk[`recallgen-scores-${monthKey(MARCH)}.json`]).toBeDefined();
        expect(disk[`recallgen-scores-${monthKey(APRIL)}.json`]).toBeDefined();
        expect(await store.listIndex()).toHaveLength(2);
    });

    it("同月多次写入合并进同一分片", async () => {
        const { plugin } = memoryPlugin();
        const store = new ScoreStore(plugin);
        await store.add(record("s-1", MARCH));
        await store.add(record("s-2", MARCH + 1000));
        const shard = (await store.loadDetail("s-1"), await store.loadDetail("s-2"));
        expect(shard).not.toBeNull();
    });

    it("listIndex 按时间倒序", async () => {
        const { plugin } = memoryPlugin();
        const store = new ScoreStore(plugin);
        await store.add(record("old", MARCH));
        await store.add(record("new", APRIL));
        expect((await store.listIndex()).map((e) => e.id)).toEqual(["new", "old"]);
    });

    it("索引不含题目与判分明细", async () => {
        const { plugin, disk } = memoryPlugin();
        const store = new ScoreStore(plugin);
        await store.add(record("s-1", MARCH));
        const indexFile = JSON.stringify(disk["recallgen-scores-index.json"]);
        expect(indexFile).not.toContain("判分明细");
        expect(indexFile).not.toContain("questionId");
    });

    it("明细包含判分结果、题目与分析", async () => {
        const { plugin } = memoryPlugin();
        const store = new ScoreStore(plugin);
        await store.add(record("s-1", MARCH, 80, "分析文本"));
        const detail = await store.loadDetail("s-1");
        expect(detail).toMatchObject({ id: "s-1", analysis: "分析文本" });
        expect(detail?.detail).toHaveLength(1);
        expect(detail?.questions).toHaveLength(1);
    });

    it("明细不存在时返回 null", async () => {
        const { plugin } = memoryPlugin();
        expect(await new ScoreStore(plugin).loadDetail("missing")).toBeNull();
    });

    it("同 id 重复写入不会产生重复条目", async () => {
        const { plugin } = memoryPlugin();
        const store = new ScoreStore(plugin);
        await store.add(record("s-1", MARCH));
        await store.add(record("s-1", MARCH, 90));
        const index = await store.listIndex();
        expect(index).toHaveLength(1);
        expect(index[0].totalScore).toBe(90);
    });
});

describe("ScoreStore.updateAnalysis", () => {
    it("写入明细并翻转索引上的 hasAnalysis", async () => {
        const { plugin } = memoryPlugin();
        const store = new ScoreStore(plugin);
        await store.add(record("s-1", MARCH));
        expect((await store.listIndex())[0].hasAnalysis).toBe(false);

        await store.updateAnalysis("s-1", "新的薄弱点分析");
        expect((await store.listIndex())[0].hasAnalysis).toBe(true);
        expect((await store.loadDetail("s-1"))?.analysis).toBe("新的薄弱点分析");
    });

    it("id 不存在时静默返回（不抛错）", async () => {
        const { plugin } = memoryPlugin();
        await expect(new ScoreStore(plugin).updateAnalysis("missing", "x")).resolves.toBeUndefined();
    });
});

describe("ScoreStore.remove / clear", () => {
    it("删除同时移除索引条目与明细", async () => {
        const { plugin } = memoryPlugin();
        const store = new ScoreStore(plugin);
        await store.add(record("s-1", MARCH));
        await store.add(record("s-2", MARCH + 1000));

        await store.remove("s-1");
        expect((await store.listIndex()).map((e) => e.id)).toEqual(["s-2"]);
        expect(await store.loadDetail("s-1")).toBeNull();
        expect(await store.loadDetail("s-2")).not.toBeNull();
    });

    it("删除不存在的 id 不抛错", async () => {
        const { plugin } = memoryPlugin();
        await expect(new ScoreStore(plugin).remove("missing")).resolves.toBeUndefined();
    });

    it("clear 清空索引与所有已知分片", async () => {
        const { plugin } = memoryPlugin();
        const store = new ScoreStore(plugin);
        await store.add(record("s-1", MARCH));
        await store.add(record("s-2", APRIL));

        await store.clear();
        expect(await store.listIndex()).toEqual([]);
        expect(await store.loadDetail("s-1")).toBeNull();
        expect(await store.loadDetail("s-2")).toBeNull();
    });
});

describe("ScoreStore.migrateIfNeeded", () => {
    it("把 v1 单文件迁移为索引 + 分片，并写出备份", async () => {
        const legacy = [record("s-1", MARCH, 70, "旧分析"), record("s-2", APRIL, 90)];
        const { plugin, disk, removed } = memoryPlugin({ "recallgen-scores.json": legacy });
        const store = new ScoreStore(plugin);

        const { migrated } = await store.migrateIfNeeded();
        expect(migrated).toBe(2);
        expect(disk["recallgen-scores.v1-backup.json"]).toEqual(legacy);
        expect(removed).toContain("recallgen-scores.json");

        const index = await store.listIndex();
        expect(index.map((e) => e.id).sort()).toEqual(["s-1", "s-2"]);
        expect((await store.loadDetail("s-1"))?.analysis).toBe("旧分析");
        expect((await store.loadDetail("s-2"))?.questions).toHaveLength(1);
    });

    it("v1 内容为 JSON 字符串时同样可迁移", async () => {
        const { plugin } = memoryPlugin({ "recallgen-scores.json": JSON.stringify([record("s-1", MARCH)]) });
        const store = new ScoreStore(plugin);
        expect((await store.migrateIfNeeded()).migrated).toBe(1);
        expect(await store.listIndex()).toHaveLength(1);
    });

    it("索引已有数据时跳过迁移", async () => {
        const { plugin } = memoryPlugin({ "recallgen-scores.json": [record("s-1", MARCH)] });
        const store = new ScoreStore(plugin);
        await store.add(record("s-new", APRIL));
        expect((await store.migrateIfNeeded()).migrated).toBe(0);
        expect((await store.listIndex()).map((e) => e.id)).toEqual(["s-new"]);
    });

    it("没有 v1 文件时不做任何事", async () => {
        const { plugin, saves } = memoryPlugin();
        expect((await new ScoreStore(plugin).migrateIfNeeded()).migrated).toBe(0);
        expect(saves).toEqual([]);
    });

    it("v1 内容损坏时安全跳过", async () => {
        const { plugin } = memoryPlugin({ "recallgen-scores.json": "{不是数组" });
        const store = new ScoreStore(plugin);
        expect((await store.migrateIfNeeded()).migrated).toBe(0);
        expect(await store.listIndex()).toEqual([]);
    });

    it("v1 记录缺少 detail 时也能迁移（detail 兜底为空数组）", async () => {
        const broken = { ...record("s-1", MARCH), detail: undefined } as unknown as ScoreRecord;
        const { plugin } = memoryPlugin({ "recallgen-scores.json": [broken] });
        const store = new ScoreStore(plugin);
        expect((await store.migrateIfNeeded()).migrated).toBe(1);
        expect((await store.loadDetail("s-1"))?.detail).toEqual([]);
    });
});

describe("ScoreStore.purgeAll", () => {
    it("删除索引、全部分片与旧文件", async () => {
        const { plugin, disk, removed } = memoryPlugin({ "recallgen-scores.json": [record("s-1", MARCH)] });
        const store = new ScoreStore(plugin);
        await store.migrateIfNeeded();
        await store.add(record("s-2", APRIL));

        await store.purgeAll();
        expect(disk["recallgen-scores-index.json"]).toBeUndefined();
        expect(disk[`recallgen-scores-${monthKey(MARCH)}.json`]).toBeUndefined();
        expect(disk[`recallgen-scores-${monthKey(APRIL)}.json`]).toBeUndefined();
        expect(removed).toContain("recallgen-scores.v1-backup.json");
    });
});

describe("ScoreStore.exportAll / importMany", () => {
    it("导出包含索引与明细", async () => {
        const { plugin } = memoryPlugin();
        const store = new ScoreStore(plugin);
        await store.add(record("s-1", MARCH, 80, "分析"));
        await store.add(record("s-2", APRIL, 60));

        const backup = await store.exportAll();
        expect(backup.entries).toHaveLength(2);
        expect(Object.keys(backup.details).sort()).toEqual(["s-1", "s-2"]);
        expect(backup.details["s-1"].analysis).toBe("分析");
        expect(backup.details["s-1"].questions).toHaveLength(1);
    });

    it("导入到空库后索引与明细都可读", async () => {
        const source = memoryPlugin();
        const sourceStore = new ScoreStore(source.plugin);
        await sourceStore.add(record("s-1", MARCH, 70, "来自备份"));
        const backup = await sourceStore.exportAll();

        const target = memoryPlugin();
        const targetStore = new ScoreStore(target.plugin);
        await targetStore.importMany(
            backup.entries.map((entry) => ({ entry, detail: backup.details[entry.id] ?? null }))
        );

        expect((await targetStore.listIndex()).map((e) => e.id)).toEqual(["s-1"]);
        expect((await targetStore.loadDetail("s-1"))?.analysis).toBe("来自备份");
    });

    it("导入跨月份的成绩写入对应分片", async () => {
        const { plugin, disk } = memoryPlugin();
        const store = new ScoreStore(plugin);
        await store.importMany([
            {
                entry: { ...indexEntry("s-1", MARCH) },
                detail: { id: "s-1", detail: [result("q-1", "true_false", 100)] },
            },
            {
                entry: { ...indexEntry("s-2", APRIL) },
                detail: { id: "s-2", detail: [result("q-1", "true_false", 100)] },
            },
        ]);
        expect(disk[`recallgen-scores-${monthKey(MARCH)}.json`]).toBeDefined();
        expect(disk[`recallgen-scores-${monthKey(APRIL)}.json`]).toBeDefined();
    });

    it("没有明细的条目也能导入，列表与统计可用但回看为空", async () => {
        const { plugin } = memoryPlugin();
        const store = new ScoreStore(plugin);
        await store.importMany([{ entry: indexEntry("s-1", MARCH), detail: null }]);
        expect((await store.listIndex()).map((e) => e.id)).toEqual(["s-1"]);
        expect(await store.loadDetail("s-1")).toBeNull();
    });

    it("重复导入同一条目不会产生重复记录", async () => {
        const { plugin } = memoryPlugin();
        const store = new ScoreStore(plugin);
        const item = {
            entry: indexEntry("s-1", MARCH),
            detail: { id: "s-1", detail: [result("q-1", "true_false", 100)] },
        };
        await store.importMany([item]);
        await store.importMany([item]);
        expect(await store.listIndex()).toHaveLength(1);
    });

    it("空数组不做任何写入", async () => {
        const { plugin, disk } = memoryPlugin();
        await new ScoreStore(plugin).importMany([]);
        expect(Object.keys(disk)).toEqual([]);
    });
});
