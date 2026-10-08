import type { GenPhase, GenStats } from "./generator";

/**
 * 出题进度模型。
 *
 * 原实现是 `phase === "generating" ? null : round * 30`：
 * 生成阶段永远显示不确定进度条，之后每审题一轮跳 30%。审题最多 3 轮，
 * 于是进度条只在 30/60/90 三个位置跳，与实际工作量无关——用户看到的是
 * 「一直卡在生成阶段不动，然后忽然蹦到 90%」，也看不出还剩多少。
 *
 * 这里按阶段分配权重，并在生成阶段用「已收集 / 目标题数」真实推进：
 *
 *   生成题目   0 → 70   按收集到的题数线性推进
 *   审题       70 → 90  按轮次步进
 *   重做不合格题 90 → 100 按轮次步进
 *
 * 拿不到实时数据时返回 null，交回不确定进度条——不确定就不要假装确定。
 */

const SPAN: Record<GenPhase, { from: number; to: number }> = {
    generating: { from: 0, to: 70 },
    reviewing: { from: 70, to: 90 },
    regenerating: { from: 90, to: 100 },
};

/** 审题与重做最多几轮，与 generator 的审题循环上限保持一致 */
export const MAX_GEN_ROUNDS = 3;

/** 阶段顺序，同时用于流程步骤条 */
export const GEN_STEPS: GenPhase[] = ["generating", "reviewing", "regenerating"];

/**
 * 计算当前进度（0-100）。
 * @param phase 当前阶段
 * @param round 当前轮次（1-based）
 * @param stats 生成阶段的实时快照；缺目标题数时无法计算
 */
export function genProgress(phase: GenPhase, round: number, stats?: GenStats): number | null {
    const span = SPAN[phase];

    if (phase === "generating") {
        const target = stats?.target ?? 0;
        const collected = stats?.collected ?? 0;
        if (target <= 0) return null;
        // 补题可能让收集数超过目标，夹住上限，否则进度条会冲出当前阶段区间
        const ratio = Math.min(1, Math.max(0, collected / target));
        return span.from + ratio * (span.to - span.from);
    }

    // 轮次越界时按边界处理：进度条不该因为一次异常轮次而倒退或超过 100
    const step = Math.min(MAX_GEN_ROUNDS, Math.max(1, round)) / MAX_GEN_ROUNDS;
    return span.from + step * (span.to - span.from);
}

export type StepState = "done" | "active" | "pending";

/** 流程步骤条上每一步的状态 */
export function stepStates(phase: GenPhase): Record<GenPhase, StepState> {
    const current = GEN_STEPS.indexOf(phase);
    return {
        generating: current > 0 ? "done" : "active",
        reviewing: current > 1 ? "done" : current === 1 ? "active" : "pending",
        regenerating: current === 2 ? "active" : "pending",
    };
}
