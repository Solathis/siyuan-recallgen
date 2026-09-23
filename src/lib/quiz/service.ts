import type { RecallGenConfig } from "@/types/config";
import type { BankItem, BankSummary } from "./bank";
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
        onProgress: (done: number, total: number) => void,
        /** 每题的作答耗时（秒），会写入对应的判分结果 */
        secondsByQuestion?: Record<string, number>
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
    /** 导出全部成绩（索引 + 明细）用于完整备份 */
    exportAllScores(): Promise<{ entries: ScoreIndexEntry[]; details: Record<string, ScoreDetail> }>;
    /** 导入成绩备份；返回新增与跳过的条数 */
    importScores(
        items: { entry: ScoreIndexEntry; detail: ScoreDetail | null }[]
    ): Promise<{ added: number; skipped: number }>;
    /** 已打开的笔记本列表，用于设置面板选择存储位置 */
    listNotebooks(): Promise<{ id: string; name: string }[]>;

    // ── 题库与间隔重复 ──────────────────────────────────────────
    /**
     * 按 FSRS 排程取出到期的题目，用于「复习到期题目」。
     * 传入 sourceDocId 时只取来自该文档的题目，便于「只复习这篇笔记」。
     */
    dueBankQuestions(limit?: number, sourceDocId?: string): Promise<Question[]>;
    /** 题库规模概览 */
    bankSummary(): Promise<BankSummary>;
    /** 题库全部条目，用于题库浏览界面 */
    listBank(): Promise<BankItem[]>;
    /** 导出题库全部条目（含排程与复习历史）用于备份 */
    exportBank(): Promise<BankItem[]>;
    /** 导入题库备份；只新增不覆盖，返回新增与跳过的条数 */
    importBank(items: BankItem[]): Promise<{ added: number; skipped: number }>;
    /** 从题库中删除单条题目 */
    removeBankItem(id: string): Promise<void>;
    /**
     * 交卷后把作答结果写回题库：新题目入库，已有题目推进排程并累计统计。
     * 返回新增与复用（已存在）的题数。
     */
    recordBankOutcomes(
        questions: Question[],
        source: { sourceDocId: string; sourceTitle: string },
        results: GradingResult[]
    ): Promise<{ added: number; reused: number }>;
    clearBank(): Promise<void>;
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
    mode: "generate" | "resume" | "dateGenerate" | "review" | "reviewDue";
    content?: string;
    quizId?: string;
    sourceDocId: string;
    sourceTitle: string;
    dateRange?: "today" | "beforeToday";
    notebookId?: string;
    /** reviewDue 模式下限定来源文档，只复习该文档的到期题目 */
    dueSourceDocId?: string;
    /** review 模式的成绩数据 */
    review?: ReviewPayload;
}

/** 对话轮次 */
export interface ChatTurn {
    role: "user" | "assistant";
    content: string;
}
