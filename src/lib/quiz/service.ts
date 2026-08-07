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
    /** AI 对话：基于答题结果回答用户追问 */
    chat(
        questions: Question[],
        results: GradingResult[],
        analysis: string,
        history: ChatTurn[],
        userMessage: string,
    ): Promise<string>;
    saveResultToDoc(session: QuizSession, analysis: string): Promise<string>;
    saveProgress(session: QuizSession): Promise<void>;
    loadProgress(id: string): Promise<QuizSession | null>;
    clearProgress(id: string): Promise<void>;
    saveScore(record: ScoreRecord): Promise<void>;
    testConnection(): Promise<boolean>;
    clearScores(): Promise<void>;
    clearAllProgress(): Promise<void>;
}

/** Tab 初始数据 */
export interface QuizTabData {
    mode: "generate" | "resume";
    content?: string;
    quizId?: string;
    sourceDocId: string;
    sourceTitle: string;
}

/** 对话轮次 */
export interface ChatTurn {
    role: "user" | "assistant";
    content: string;
}
