import type { RecallGenConfig } from "@/types/config";
import type {
    GradingResult,
    Question,
    QuizSession,
    ScoreDetail,
    ScoreIndexEntry,
    ScoreRecord,
    UserAnswer,
} from "@/types/quiz";
import type { GenProgressCallback } from "../quiz/generator";

/** QuizPanel 与插件后端交互的接口，由 index.ts 实现 */
export interface QuizService {
    getConfig(): RecallGenConfig;
    /**
     * 订阅配置变化，返回取消订阅函数。
     * 面板打开期间修改设置需要立即生效，而 getConfig() 单独调用无法被响应式追踪。
     */
    subscribeConfig(listener: (config: RecallGenConfig) => void): () => void;
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
    /** 写入薄弱点分析（同时更新索引上的 hasAnalysis 标记） */
    updateScoreAnalysis(id: string, analysis: string): Promise<void>;
    /** 历史列表：只读轻量索引，不加载题目与判分明细 */
    listScores(): Promise<ScoreIndexEntry[]>;
    /** 按需加载单次成绩的明细（题目、判分明细、分析） */
    loadScoreDetail(id: string): Promise<ScoreDetail | null>;
    removeScore(id: string): Promise<void>;
    /** 已打开的笔记本列表，用于设置面板选择存储位置 */
    listNotebooks(): Promise<{ id: string; name: string }[]>;
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

/** 回看历史成绩所需的索引条目 + 明细 */
export interface ReviewPayload {
    entry: ScoreIndexEntry;
    detail: ScoreDetail;
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
    /** review 模式的成绩数据 */
    review?: ReviewPayload;
}

/** 对话轮次 */
export interface ChatTurn {
    role: "user" | "assistant";
    content: string;
}
