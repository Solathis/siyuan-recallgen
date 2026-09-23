import type { StoragePlugin } from "./store";
import type { QuizSession } from "@/types/quiz";
import { AsyncStore } from "./store";

const PROGRESS_NAME = "recallgen-progress.json";

/** 未交卷的进度超过该时长即视为废弃，读取时自动清理 */
export const PROGRESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 答题进度暂存。按 quizId 索引 QuizSession 快照，关面板后可恢复。
 *
 * 每次读取都会顺带清理过期进度，避免长期使用后废弃会话无限堆积
 * （原实现只增不删，进度文件会一直变大）。
 */
export class ProgressStore extends AsyncStore {
    constructor(plugin: StoragePlugin) {
        super(plugin, PROGRESS_NAME);
    }

    private async readMap(): Promise<Record<string, QuizSession>> {
        const data = await this.read<Record<string, QuizSession>>({});
        return data && typeof data === "object" && !Array.isArray(data) ? { ...data } : {};
    }

    async save(session: QuizSession): Promise<void> {
        const map = await this.readMap();
        map[session.id] = session;
        await this.write(map);
    }

    async load(quizId: string): Promise<QuizSession | null> {
        const map = await this.readMap();
        return map[quizId] ?? null;
    }

    async listIds(): Promise<string[]> {
        return Object.keys(await this.readMap());
    }

    /** 按 sourceDocId 查找最近的进度（用于 SiYuan 重启后恢复 tab） */
    async findBySourceDocId(sourceDocId: string): Promise<QuizSession | null> {
        const sessions = Object.values(await this.readMap())
            .filter((s) => s.sourceDocId === sourceDocId)
            .sort((a, b) => b.createdAt - a.createdAt);
        return sessions[0] ?? null;
    }

    async clear(quizId: string): Promise<void> {
        const map = await this.readMap();
        delete map[quizId];
        await this.write(map);
    }

    async clearAll(): Promise<void> {
        await this.write({});
    }

    /**
     * 清理超过 TTL 的废弃进度，返回清理条数。
     * 由 index.ts 在插件加载时调用一次。
     */
    async pruneExpired(now = Date.now(), ttlMs = PROGRESS_TTL_MS): Promise<number> {
        const map = await this.readMap();
        const kept: Record<string, QuizSession> = {};
        let removed = 0;
        for (const [id, session] of Object.entries(map)) {
            // createdAt 缺失/非法的脏数据无法用于恢复，同样清理
            const createdAt = typeof session?.createdAt === "number" ? session.createdAt : 0;
            if (now - createdAt > ttlMs) {
                removed++;
                continue;
            }
            kept[id] = session;
        }
        if (removed > 0) {
            await this.write(kept);
        }
        return removed;
    }
}
