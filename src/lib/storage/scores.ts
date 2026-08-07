import type { StoragePlugin } from "./store";
import type { ScoreRecord } from "@/types/quiz";
import { AsyncStore } from "./store";

const SCORES_NAME = "recallgen-scores.json";

/**
 * 成绩历史存储。以数组形式持久化全部 ScoreRecord。
 * 不可变更新：每次写入生成新数组，避免缓存引用被外部误改。
 * safe for concurrent calls.
 */
export class ScoreStore extends AsyncStore {
    constructor(plugin: StoragePlugin) {
        super(plugin, SCORES_NAME);
    }

    async list(): Promise<ScoreRecord[]> {
        const data = await this.read<ScoreRecord[]>([]);
        return Array.isArray(data) ? data : [];
    }

    async add(rec: ScoreRecord): Promise<void> {
        const next = [...(await this.list()), rec];
        await this.write(next);
    }

    async listByDateRange(start: number, end: number): Promise<ScoreRecord[]> {
        const all = await this.list();
        return all.filter((r) => r.timestamp >= start && r.timestamp <= end);
    }

    async clear(): Promise<void> {
        await this.write([]);
    }
}
