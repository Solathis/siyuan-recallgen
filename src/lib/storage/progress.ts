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
        return asMap(await this.read<Record<string, QuizSession>>({}));
    }

    async save(session: QuizSession): Promise<void> {
        await this.update(
            () => this.readMap(),
            (map) => ({ ...map, [session.id]: session })
        );
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
        await this.update(
            () => this.readMap(),
            (map) => {
                if (!(quizId in map)) return null;
                const next = { ...map };
                delete next[quizId];
                return next;
            }
        );
    }

    async clearAll(): Promise<void> {
        await this.write({});
    }

    /**
     * 清理超过 TTL 的废弃进度，返回清理条数。
     * 由 index.ts 在插件加载时调用一次。
     */
    async pruneExpired(now = Date.now(), ttlMs = PROGRESS_TTL_MS): Promise<number> {
        let removed = 0;
        await this.update(
            () => this.readMap(),
            (map) => {
                const kept: Record<string, QuizSession> = {};
                let dropped = 0;
                for (const [id, session] of Object.entries(map)) {
                    // createdAt 缺失/非法的脏数据无法用于恢复，同样清理
                    const createdAt = typeof session?.createdAt === "number" ? session.createdAt : 0;
                    if (now - createdAt > ttlMs) {
                        dropped++;
                        continue;
                    }
                    kept[id] = session;
                }
                removed = dropped;
                return dropped > 0 ? kept : null;
            }
        );
        return removed;
    }
}

/** 读取结果的形状兜底：非对象或数组都当作空表 */
function asMap(value: unknown): Record<string, QuizSession> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? { ...(value as Record<string, QuizSession>) }
        : {};
}
