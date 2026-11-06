import { hasAnswer, PASS_SCORE } from "@/types/quiz";
import type {
    Difficulty,
    GradingResult,
    Question,
    QuestionType,
    ScoreAggregate,
    ScoreIndexEntry,
    ScoreRecord,
} from "@/types/quiz";

export { PASS_SCORE } from "@/types/quiz";

/** 成绩索引与统计共用的空聚合 */
function emptyAggregate(): ScoreAggregate {
    return { count: 0, passed: 0, score: 0, maxScore: 0 };
}

function accumulate(target: ScoreAggregate, result: GradingResult): void {
    target.count++;
    if (result.score >= PASS_SCORE) target.passed++;
    target.score += result.score;
    target.maxScore += result.maxScore;
}

/**
 * 按题型与难度聚合判分结果。
 * 题目缺失时（例如历史记录未保存题目）该题只计入总分，不进入分组统计；
 * detail 缺失（v1 旧数据或损坏数据）时返回空聚合而不是抛错。
 */
export function aggregateResults(
    results: GradingResult[] | undefined,
    questions: Question[] | undefined
): {
    byType: Partial<Record<QuestionType, ScoreAggregate>>;
    byDifficulty: Partial<Record<Difficulty, ScoreAggregate>>;
    byTag: Record<string, ScoreAggregate>;
} {
    const byId = new Map((questions ?? []).map((q) => [q.id, q]));
    const byType: Partial<Record<QuestionType, ScoreAggregate>> = {};
    const byDifficulty: Partial<Record<Difficulty, ScoreAggregate>> = {};
    const byTag: Record<string, ScoreAggregate> = {};
    const list = Array.isArray(results) ? results : [];

    for (const result of list) {
        const question = byId.get(result.questionId);
        // 判分结果自带 type，因此即使没有题目也能统计题型
        const type = (question?.type ?? result.type) as QuestionType;
        // 先落到局部变量：TS 不会因为 ??= 收窄带索引访问的表达式
        const typeAggregate = (byType[type] ??= emptyAggregate());
        accumulate(typeAggregate, result);

        if (question) {
            const difficultyAggregate = (byDifficulty[question.difficulty] ??= emptyAggregate());
            accumulate(difficultyAggregate, result);
        }

        // 同一道题可计入多个知识点标签
        for (const tag of question?.tags ?? []) {
            byTag[tag] ??= emptyAggregate();
            accumulate(byTag[tag], result);
        }
    }

    return { byType, byDifficulty, byTag };
}

/**
 * 由完整成绩记录派生索引条目。
 * 索引条目不含题目与判分明细，因此历史列表与统计图表无需加载明细。
 */
export function buildIndexEntry(record: ScoreRecord): ScoreIndexEntry {
    const results = Array.isArray(record.detail) ? record.detail : [];
    const { byType, byDifficulty, byTag } = aggregateResults(results, record.questions);
    return {
        id: record.id,
        quizId: record.quizId,
        title: record.title,
        timestamp: record.timestamp,
        totalScore: record.totalScore,
        maxScore: record.maxScore,
        questionCount: record.questionCount,
        passedCount: results.filter((r) => r.score >= PASS_SCORE).length,
        unanswered: results.filter((r) => !hasAnswer(r.userAnswer)).length,
        duration: record.duration,
        sourceDocId: record.sourceDocId,
        sourceTitle: record.sourceTitle,
        byType,
        byDifficulty,
        byTag,
        avgQuestionSeconds: averageQuestionSeconds(results),
        slowestQuestionSeconds: slowestQuestionSeconds(results),
        hasAnalysis: !!record.analysis,
    };
}

/** 实测的单题平均耗时；没有单题数据时返回 undefined */
function averageQuestionSeconds(results: GradingResult[]): number | undefined {
    const measured = results.map((r) => r.seconds).filter(isPositiveSeconds);
    if (measured.length === 0) return undefined;
    return Math.round(measured.reduce((a, b) => a + b, 0) / measured.length);
}

/** 最耗时的一题；没有单题数据时返回 undefined */
function slowestQuestionSeconds(results: GradingResult[]): number | undefined {
    const measured = results.map((r) => r.seconds).filter(isPositiveSeconds);
    return measured.length > 0 ? Math.max(...measured) : undefined;
}

/** 合法的单题耗时：有限正数（Infinity/NaN 会污染平均值与最大值） */
function isPositiveSeconds(value: number | undefined): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 成绩百分比（0-100）。
 * maxScore 非有限正数时返回 0：导入的脏数据可能是 0/负数/NaN，
 * 直接相除会把 NaN 或负数百分比带进统计与图表。
 */
export function scorePercent(entry: Pick<ScoreIndexEntry, "totalScore" | "maxScore">): number {
    if (!Number.isFinite(entry.maxScore) || entry.maxScore <= 0) return 0;
    const percent = (entry.totalScore / entry.maxScore) * 100;
    return Number.isFinite(percent) ? percent : 0;
}

/**
 * 分数档位：优秀 / 达标 / 偏弱 / 很差。
 *
 * 80/60/30 这条阶梯原先在答题记录、结果页、统计页、题库页各写了一遍配色，
 * 筛选器又自己写了一遍 60/80；任何一处改了分界，同一个分数在两个页面就是两种颜色。
 * 「达标」那一档的下沿就是 PASS_SCORE，不另起数字。
 */
export type ScoreTier = "high" | "pass" | "weak" | "low";

/** 「优秀」档的下沿 */
export const HIGH_SCORE = 80;
/** 「很差」档的上沿（不含） */
export const LOW_SCORE = 30;

export function scoreTier(percent: number): ScoreTier {
    if (percent >= HIGH_SCORE) return "high";
    if (percent >= PASS_SCORE) return "pass";
    if (percent >= LOW_SCORE) return "weak";
    return "low";
}

/**
 * 题目层面的达标率（0-100）：Σ达标题数 / Σ题数。
 * 与结果页顶部「达标率」同一口径；没有题目时返回 null，而不是显示 0%。
 */
export function passRate(entries: Pick<ScoreIndexEntry, "passedCount" | "questionCount">[]): number | null {
    let passed = 0;
    let total = 0;
    for (const entry of entries) {
        passed += Math.max(0, entry.passedCount);
        total += Math.max(0, entry.questionCount);
    }
    return total > 0 ? (passed / total) * 100 : null;
}

/** 按本地时间取分片键 YYYY-MM */
export function monthKey(timestamp: number): string {
    const d = new Date(timestamp);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
}
