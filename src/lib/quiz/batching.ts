import type { DifficultyDistribution, Question } from "@/types/quiz";
import { questionFingerprint } from "./bank";

/**
 * 出题分批。
 *
 * 一次请求 50 道题会让输出很长，模型容易中途截断、超时或返回不完整的 JSON；
 * 因此把题量与难度分布拆成若干批，逐批请求后合并。
 */

/** 单次请求的题目数量上限 */
export const MAX_QUESTIONS_PER_CALL = 12;

const DIFFICULTIES = ["easy", "medium", "hard"] as const;

/**
 * 按难度分布规划分批。
 *
 * 每档难度独立均分到各批，余数分给前几批，因此各批的难度比例接近原始分布，
 * 且所有批次合并后与原始分布完全一致。
 * 题量为 0 或不超过上限时返回单个批次。
 */
export function planBatches(
    difficulty: DifficultyDistribution,
    maxPerBatch = MAX_QUESTIONS_PER_CALL
): DifficultyDistribution[] {
    const total = Math.max(0, Math.round(difficulty.total));
    if (total === 0) return [];

    const limit = Math.max(1, Math.floor(maxPerBatch));
    const batchCount = Math.max(1, Math.ceil(total / limit));
    if (batchCount === 1) {
        return [
            {
                total,
                easy: Math.max(0, Math.round(difficulty.easy)),
                medium: Math.max(0, Math.round(difficulty.medium)),
                hard: Math.max(0, Math.round(difficulty.hard)),
            },
        ];
    }

    const remaining: Record<(typeof DIFFICULTIES)[number], number> = {
        easy: Math.max(0, Math.round(difficulty.easy)),
        medium: Math.max(0, Math.round(difficulty.medium)),
        hard: Math.max(0, Math.round(difficulty.hard)),
    };
    // 各档之和为 0 但 total 不为 0（配置不一致）时，全部按中级处理，避免整批被吞掉
    if (remaining.easy + remaining.medium + remaining.hard === 0) {
        remaining.medium = total;
    }

    const batches: DifficultyDistribution[] = Array.from({ length: batchCount }, () => ({
        total: 0,
        easy: 0,
        medium: 0,
        hard: 0,
    }));

    /*
     * 逐题填充：每轮取「剩余最多」的难度，放进「当前题数最少」的批次。
     *
     * 不能按难度各自均分——那样在分布倾斜时会撑破单批上限
     * （例如 28 简单 + 2 中级分 3 批，简单档会得到 10/9/9，加上中级后首批变 11）。
     * 贪心填充既保证每批不超过上限，又让各批的难度比例接近原始分布。
     */
    let left = remaining.easy + remaining.medium + remaining.hard;
    while (left > 0) {
        let level: (typeof DIFFICULTIES)[number] = DIFFICULTIES[0];
        for (const candidate of DIFFICULTIES) {
            if (remaining[candidate] > remaining[level]) level = candidate;
        }
        if (remaining[level] === 0) break;

        const target = batches.reduce(
            (best, batch) => (batch.total < best.total && batch.total < limit ? batch : best),
            batches[0]
        );
        if (target.total >= limit) break;

        target[level] += 1;
        target.total += 1;
        remaining[level] -= 1;
        left -= 1;
    }

    // 各档都为 0 的批次没有意义，去掉后不影响总题量
    return batches.filter((batch) => batch.total > 0);
}

/**
 * 去掉题目集合中的重复项（按题干指纹）。
 * 同一批内或跨批都可能出现重复题，保留首次出现的一道。
 */
export function dedupeQuestions(questions: Question[]): Question[] {
    const seen = new Set<string>();
    const out: Question[] = [];
    for (const question of questions) {
        const fingerprint = questionFingerprint(question);
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        out.push(question);
    }
    return out;
}

/** 按 1..n 连续重新编号，保证合并多批之后题号不重复、不留空洞 */
export function renumberQuestions(questions: Question[]): Question[] {
    return questions.map((question, index) => ({ ...question, id: `q-${index + 1}` }));
}
