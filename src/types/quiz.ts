/**
 * RecallGen 核心类型定义。
 * 除少量共享常量与纯谓词外只有类型，无运行时副作用，并发安全。
 */

/**
 * 判定「算作通过」的分数线。
 * 统计口径、历史列表着色、错题筛选、弱项分析共用这一个来源，
 * 避免多处各写 60 导致口径漂移。
 */
export const PASS_SCORE = 60;

/**
 * 作答是否算「真的答了」。
 * 判分与统计必须用同一口径：空串、纯空白、空数组都视为未作答，
 * 否则会出现「统计里算未作答、判分时却送去让 AI 打分」这种自相矛盾的行为。
 */
/**
 * 热力图区间颜色是否安全。
 *
 * 颜色来自可导入/可分享的配置，而它会被直接写进内联 style：
 * 不做限制时 `red;background-image:url(...)` 之类的字符串能注入任意 CSS 声明。
 * 只接受明确的颜色写法与思源主题变量。
 */
export function isSafeCssColor(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const color = value.trim();
    if (color.length === 0 || color.length > 64) return false;
    return /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.,%\s/]+\)|hsla?\(\s*[\d.,%\s/deg]+\)|var\(--[a-z0-9-]+\))$/i.test(color);
}

export function hasAnswer(answer: UserAnswer | undefined): boolean {
    if (!answer) return false;
    if (typeof answer.value === "string") return answer.value.trim().length > 0;
    if (Array.isArray(answer.value)) return answer.value.length > 0;
    return true;
}

/** 难度等级 */
export type Difficulty = "easy" | "medium" | "hard";

/** 题型枚举 */
export type QuestionType = "single_choice" | "multiple_choice" | "fill_blank" | "true_false" | "subjective" | "coding";

/** 难度分布配置：各难度题数，总和须 ≤ total */
export interface DifficultyDistribution {
    total: number;
    easy: number;
    medium: number;
    hard: number;
}

/** 编程题测试用例 */
export interface TestCase {
    /** 人类可读的输入描述，用于展示 */
    input?: string;
    /** 实际调用入口函数时传入的参数（JSON 可表达的值） */
    args?: unknown[];
    expected: string;
    description?: string;
}

/** 题目公共字段 */
export interface QuestionBase {
    /** 题号，生成时赋值，答题/判分/落盘均据此定位 */
    id: string;
    type: QuestionType;
    difficulty: Difficulty;
    question: string;
    explanation?: string;
    /** 知识点标签（1-3 个），用于按知识点维度统计薄弱环节 */
    tags?: string[];
}

export interface SingleChoiceQuestion extends QuestionBase {
    type: "single_choice";
    options: string[];
    /** 正确选项索引（0-based） */
    answer: number;
}

export interface MultipleChoiceQuestion extends QuestionBase {
    type: "multiple_choice";
    options: string[];
    /** 正确选项索引数组，无序 */
    answer: number[];
}

export interface FillBlankQuestion extends QuestionBase {
    type: "fill_blank";
    /** 每个空的可接受答案集合，按空顺序；单空即长度 1 */
    answer: string[][];
}

export interface TrueFalseQuestion extends QuestionBase {
    type: "true_false";
    answer: boolean;
}

export interface SubjectiveQuestion extends QuestionBase {
    type: "subjective";
    /** 参考答案要点，供 AI 判分对照 */
    reference_answer: string;
}

export interface CodingQuestion extends QuestionBase {
    type: "coding";
    language: string;
    /** 入口函数名，用于执行测试用例时调用 */
    entry_point?: string;
    starter_code?: string;
    test_cases?: TestCase[];
    /** 参考答案代码 */
    answer: string;
    reference_answer?: string;
}

export type Question =
    | SingleChoiceQuestion
    | MultipleChoiceQuestion
    | FillBlankQuestion
    | TrueFalseQuestion
    | SubjectiveQuestion
    | CodingQuestion;

/** 用户作答值，按题型区分 */
export type UserAnswer =
    | { type: "single_choice"; value: number }
    | { type: "multiple_choice"; value: number[] }
    | { type: "fill_blank"; value: string[] }
    | { type: "true_false"; value: boolean }
    | { type: "subjective"; value: string }
    | { type: "coding"; value: string };

/** 判分方式 */
export type GradingMethod = "local" | "ai";

/** 单题判分结果 */
export interface GradingResult {
    questionId: string;
    type: QuestionType;
    method: GradingMethod;
    /** 客观题为 true/false；AI 判分恒为 null（以 score 为准） */
    correct: boolean | null;
    /** 0-100 */
    score: number;
    maxScore: number;
    comment?: string;
    userAnswer?: UserAnswer;
    /** 本题作答耗时（秒），仅在测得有效值时存在 */
    seconds?: number;
}

/** 一次答题会话 */
export interface QuizSession {
    id: string;
    sourceDocId: string;
    sourceTitle: string;
    questions: Question[];
    createdAt: number;
    /** questionId -> UserAnswer，按题型存值 */
    answers: Record<string, UserAnswer>;
    /** 被用户标记「稍后回看」的题号 */
    flagged?: Record<string, boolean>;
    /** questionId -> 已累计的作答耗时（秒） */
    timings?: Record<string, number>;
}

/** 成绩记录，用于热力图与历史回溯 */
export interface ScoreRecord {
    id: string;
    quizId: string;
    title: string;
    timestamp: number;
    totalScore: number;
    maxScore: number;
    questionCount: number;
    detail: GradingResult[];
    /** 保存题目用于历史回看 */
    questions?: Question[];
    /** 薄弱点分析文本 */
    analysis?: string;
    /** 答题耗时（秒，墙钟时间） */
    duration?: number;
    /** 来源文档/笔记本 ID */
    sourceDocId?: string;
    /** 来源标题 */
    sourceTitle?: string;
}

/** 分组聚合统计（按题型或难度） */
export interface ScoreAggregate {
    /** 该分组题数 */
    count: number;
    /** 其中得分达到通过门槛的题数 */
    passed: number;
    score: number;
    maxScore: number;
}

/**
 * 成绩索引条目。
 * 只保留列表展示与统计图表所需的字段，不含题目与判分明细，
 * 因此历史列表与统计页可以只加载索引，交卷写入也不再重写全部历史。
 */
export interface ScoreIndexEntry {
    id: string;
    quizId: string;
    title: string;
    timestamp: number;
    totalScore: number;
    maxScore: number;
    questionCount: number;
    /** 得分达到通过门槛的题数，界面上的「正确」口径 */
    passedCount: number;
    /** 未作答题数 */
    unanswered: number;
    /** 答题耗时（秒，墙钟时间） */
    duration?: number;
    /** 实测的单题平均耗时（秒）；有单题数据时优先于 duration/questionCount */
    avgQuestionSeconds?: number;
    /** 最耗时的一道题（秒） */
    slowestQuestionSeconds?: number;
    sourceDocId?: string;
    sourceTitle?: string;
    byType: Partial<Record<QuestionType, ScoreAggregate>>;
    byDifficulty: Partial<Record<Difficulty, ScoreAggregate>>;
    /** 按知识点标签聚合；同一道题可计入多个标签 */
    byTag: Record<string, ScoreAggregate>;
    /** 是否已生成薄弱点分析 */
    hasAnalysis: boolean;
}

/** 单次成绩的明细，按月分片存储，按需加载 */
export interface ScoreDetail {
    id: string;
    detail: GradingResult[];
    questions?: Question[];
    analysis?: string;
}

/** 热力图分数区间颜色映射 */
export interface ScoreRange {
    min: number;
    max: number;
    color: string;
}

/** 热力图配置 */
export interface HeatmapConfig {
    enabled: boolean;
    metric: "max" | "avg";
    ranges: ScoreRange[];
}

/** 答题面板状态机 */
export type PanelState =
    /** 粘贴材料出题：先收集内容，再进 loading_generating */
    "composing" | "configuring" | "loading_generating" | "answering" | "loading_grading" | "result";
