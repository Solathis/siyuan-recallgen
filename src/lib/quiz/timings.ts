/**
 * 会话的逐题耗时汇总。
 *
 * 存在的原因：一次练习的「用时」有两个可能的口径，
 * 而结果页与统计页曾经各用了一个——结果页用「现在 − 会话创建时间」，
 * 统计页用逐题实测的平均值。恢复一个几小时前创建、中间关过标签页的会话时，
 * 结果页会显示「用时 3:00:44 / 每题平均耗时 22:35」这种与本次作答无关的数字，
 * 而统计页对同一次练习给出的是另一个数。
 *
 * 以逐题实测为准：它由 QuizPanel 在切题与交卷时结算，每段有 5 分钟上限
 * （MAX_TIMING_STEP_SECONDS），因此既不会把中途离开算进来，
 * 也不会因为发呆而无限膨胀。判分时传给 grader 的就是这份数据，
 * 于是「用时」与「每题平均耗时」天然自洽（用时 ≈ 单题均值 × 题数）。
 */

/** 合法的单题耗时：有限正数（NaN / Infinity / 负数会污染求和） */
function isValid(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** 逐题实测耗时之和（秒）。没有可用数据时返回 0，由调用方决定是否回退 */
export function sumTimings(timings: Record<string, number> | undefined): number {
    if (!timings) return 0;
    let total = 0;
    for (const value of Object.values(timings)) {
        if (isValid(value)) total += value;
    }
    return Math.round(total);
}
