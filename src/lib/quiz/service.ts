import type { RecallGenConfig } from "@/types/config";
import type {
    GradingResult,
    Question,
    QuizSession,
    ScoreRecord,
    UserAnswer,
} from "@/types/quiz";

/** QuizPanel 与插件后端交互的接口，由 index.ts 实现 */
export interface QuizService {
    getConfig(): RecallGenConfig;
    generate(content: string): Promise<Question[]>;
    grade(
        questions: Question[],
        answers: Record<string, UserAnswer>,
        onProgress: (done: number, total: number) => void,
    ): Promise<GradingResult[]>;
    analyze(results: GradingResult[], questions: Question[]): Promise<string>;
    saveProgress(session: QuizSession): Promise<void>;
    loadProgress(id: string): Promise<QuizSession | null>;
    clearProgress(id: string): Promise<void>;
    saveScore(record: ScoreRecord): Promise<void>;
}

/** Tab 初始数据 */
export interface QuizTabData {
    mode: "generate" | "resume";
    content?: string;
    quizId?: string;
    sourceDocId: string;
    sourceTitle: string;
}
