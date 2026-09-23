import type {
    Difficulty,
    GradingResult,
    Question,
    QuestionType,
    ScoreAggregate,
    ScoreIndexEntry,
    ScoreRecord,
    UserAnswer,
} from "@/types/quiz";

/** 判定「算作通过/正确」的分数门槛，与界面上的「正确」口径保持一致 */
export const PASS_SCORE = 60;

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
        byType[type] ??= emptyAggregate();
        accumulate(byType[type], result);

        if (question) {
            byDifficulty[question.difficulty] ??= emptyAggregate();
            accumulate(byDifficulty[question.difficulty], result);
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
        hasAnalysis: !!record.analysis,
    };
}

/** 空字符串答案视为未作答 */
function hasAnswer(answer: UserAnswer | undefined): boolean {
    if (!answer) return false;
    if (typeof answer.value === "string") return answer.value.trim().length > 0;
    if (Array.isArray(answer.value)) return answer.value.length > 0;
    return true;
}

/** 成绩百分比（0-100），maxScore 为 0 时返回 0 */
export function scorePercent(entry: Pick<ScoreIndexEntry, "totalScore" | "maxScore">): number {
    return entry.maxScore > 0 ? (entry.totalScore / entry.maxScore) * 100 : 0;
}

/** 按本地时间取分片键 YYYY-MM */
export function monthKey(timestamp: number): string {
    const d = new Date(timestamp);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
}
