import type { BankItem } from "../quiz/bank";
import type { GradingResult } from "../../types/quiz";

/** 闪卡自评:卡片 id 是题目指纹,判分结果需按题目 id 对齐 */
export function gradesToResults(items: BankItem[], grades: Array<{ id: string; percent: number }>): GradingResult[] {
    const percentById = new Map(grades.map((g) => [g.id, g.percent]));
    return items
        .filter((item) => percentById.has(item.id))
        .map((item) => {
            const percent = percentById.get(item.id)!;
            return {
                questionId: item.question.id,
                type: item.question.type,
                method: "local",
                correct: percent >= 60,
                score: percent,
                maxScore: 100,
            };
        });
}
