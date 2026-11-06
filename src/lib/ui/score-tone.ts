import { scoreTier, type ScoreTier } from "../quiz/stats";

/**
 * 分数档位 → 主题语义色。
 *
 * 档位的分界在 stats.ts 的 scoreTier 里只有一份；这里只负责「哪一档用什么颜色」。
 * 类名必须写成完整的字面量：Tailwind 靠扫描源码生成工具类，拼出来的类名不会被生成。
 */
const TEXT: Record<ScoreTier, string> = {
    high: "text-success",
    pass: "text-primary",
    weak: "text-warning",
    low: "text-destructive",
};

/** 覆盖 shadcn Progress 内部指示条的底色（不改 CLI 生成的组件本体） */
const BAR: Record<ScoreTier, string> = {
    high: "[&>[data-slot=progress-indicator]]:bg-success",
    pass: "[&>[data-slot=progress-indicator]]:bg-primary",
    weak: "[&>[data-slot=progress-indicator]]:bg-warning",
    low: "[&>[data-slot=progress-indicator]]:bg-destructive",
};

/** 分数文字的颜色 */
export function scoreText(percent: number): string {
    return TEXT[scoreTier(percent)];
}

/** 分数条的颜色 */
export function scoreBar(percent: number): string {
    return BAR[scoreTier(percent)];
}
