import type { StoragePlugin } from "./store";
import type { QuizSession } from "@/types/quiz";
import { AsyncStore } from "./store";

const PROGRESS_NAME = "recallgen-progress.json";

/**
 * 答题进度暂存。按 quizId 索引 QuizSession 快照，关面板后可恢复。
 * safe for concurrent calls.
 */
export class ProgressStore extends AsyncStore {
    constructor(plugin: StoragePlugin) {
        super(plugin, PROGRESS_NAME);
    }

    private async readMap(): Promise<Record<string, QuizSession>> {
        const data = await this.read<Record<string, QuizSession>>({});
        return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    }

    async save(session: QuizSession): Promise<void> {
        const map = await this.readMap();
        map[session.id] = session;
        await this.write({ ...map });
    }

    async load(quizId: string): Promise<QuizSession | null> {
        const map = await this.readMap();
        return map[quizId] ?? null;
    }

    async listIds(): Promise<string[]> {
        const map = await this.readMap();
        return Object.keys(map);
    }

    async clear(quizId: string): Promise<void> {
        const map = await this.readMap();
        const next = { ...map };
        delete next[quizId];
        await this.write(next);
    }

    async clearAll(): Promise<void> {
        await this.write({});
    }
}
