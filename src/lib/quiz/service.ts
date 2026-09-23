import type { RecallGenConfig } from "@/types/config";
import type { GradingResult, Question, QuizSession, ScoreRecord, UserAnswer } from "@/types/quiz";
import type { GenProgressCallback } from "../quiz/generator";

/** QuizPanel 与插件后端交互的接口，由 index.ts 实现 */
export interface QuizService {
    getConfig(): RecallGenConfig;
    generate(content: string, onProgress?: GenProgressCallback): Promise<Question[]>;
    /** 加载日期范围内的笔记内容 */
    loadDateRangeContent(
        cfg: DateGenConfig,
        range: "today" | "beforeToday",
        notebookId?: string
    ): Promise<{ content: string; title: string }>;
    grade(
        questions: Question[],
        answers: Record<string, UserAnswer>,
        onProgress: (done: number, total: number) => void
    ): Promise<GradingResult[]>;
    analyze(results: GradingResult[], questions: Question[]): Promise<string>;
    /** AI 对话：针对单道题目回答用户追问 */
    chat(
        question: Question,
        result: GradingResult,
        analysis: string,
        history: ChatTurn[],
        userMessage: string
    ): Promise<string>;
    /** 全局 AI 答疑：针对整套试卷回答用户追问 */
    chatGlobal(
        questions: Question[],
        results: GradingResult[],
        analysis: string,
        history: ChatTurn[],
        userMessage: string
    ): Promise<string>;
    saveResultToDoc(
        session: QuizSession,
        analysis: string,
        results: GradingResult[],
        wrongOnly?: boolean
    ): Promise<string>;
    saveProgress(session: QuizSession): Promise<void>;
    loadProgress(id: string): Promise<QuizSession | null>;
    findProgressBySourceDocId(sourceDocId: string): Promise<QuizSession | null>;
    clearProgress(id: string): Promise<void>;
    saveScore(record: ScoreRecord): Promise<void>;
    updateScore(id: string, patch: Partial<ScoreRecord>): Promise<void>;
    listScores(): Promise<ScoreRecord[]>;
    testConnection: () => Promise<string>;
    clearScores(): Promise<void>;
    clearAllProgress(): Promise<void>;
}

/** 日期生成配置 */
export interface DateGenConfig {
    days: number;
    baseHour: number;
    baseMinute: number;
}

/** Tab 初始数据 */
export interface QuizTabData {
    mode: "generate" | "resume" | "dateGenerate" | "review";
    content?: string;
    quizId?: string;
    sourceDocId: string;
    sourceTitle: string;
    dateRange?: "today" | "beforeToday";
    notebookId?: string;
    /** review 模式的完整记录 */
    reviewRecord?: ScoreRecord;
}

/** 对话轮次 */
export interface ChatTurn {
    role: "user" | "assistant";
    content: string;
}
