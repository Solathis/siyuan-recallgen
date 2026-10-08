import { describe, expect, it } from "vitest";

import type { GenStats } from "./generator";
import { GEN_STEPS, genProgress, stepStates } from "./gen-progress";

function stats(partial: Partial<GenStats>): GenStats {
    return { phase: "generating", target: 8, collected: 0, batch: 1, batches: 1, dropped: 0, ...partial };
}

describe("出题进度模型", () => {
    it("生成阶段按已收集题数在 0-70 之间线性推进", () => {
        expect(genProgress("generating", 1, stats({ collected: 0, target: 8 }))).toBe(0);
        expect(genProgress("generating", 1, stats({ collected: 4, target: 8 }))).toBe(35);
        expect(genProgress("generating", 1, stats({ collected: 8, target: 8 }))).toBe(70);
    });

    it("收集数超过目标时不会冲出阶段区间（补题会超过目标）", () => {
        expect(genProgress("generating", 1, stats({ collected: 12, target: 8 }))).toBe(70);
    });

    it("拿不到目标题数时返回 null，交回不确定进度条", () => {
        expect(genProgress("generating", 1, stats({ collected: 3, target: 0 }))).toBeNull();
        expect(genProgress("generating", 1)).toBeNull();
    });

    it("审题按轮次在 70-90 之间步进，最后一轮正好到 90", () => {
        expect(genProgress("reviewing", 1)).toBeCloseTo(70 + 20 / 3, 5);
        expect(genProgress("reviewing", 2)).toBeCloseTo(70 + 40 / 3, 5);
        expect(genProgress("reviewing", 3)).toBe(90);
    });

    it("重做不合格题推进到 100，且轮次越界不会倒退或超过上限", () => {
        expect(genProgress("regenerating", 3)).toBe(100);
        expect(genProgress("regenerating", 99)).toBe(100);
        expect(genProgress("regenerating", 0)).toBeCloseTo(90 + 10 / 3, 5);
    });

    it("进度只增不减：同一份数据重复计算结果一致", () => {
        const first = genProgress("generating", 1, stats({ collected: 5, target: 10 }));
        const again = genProgress("generating", 1, stats({ collected: 5, target: 10 }));
        expect(first).toBe(again);
        expect(first).toBe(35);
    });
});

describe("流程步骤条", () => {
    it("阶段顺序固定为 生成 → 审题 → 重做", () => {
        expect(GEN_STEPS).toEqual(["generating", "reviewing", "regenerating"]);
    });

    it("当前阶段之前的标记为已完成，之后的为未开始", () => {
        expect(stepStates("generating")).toEqual({
            generating: "active",
            reviewing: "pending",
            regenerating: "pending",
        });
        expect(stepStates("reviewing")).toEqual({
            generating: "done",
            reviewing: "active",
            regenerating: "pending",
        });
        expect(stepStates("regenerating")).toEqual({
            generating: "done",
            reviewing: "done",
            regenerating: "active",
        });
    });

    it("任何阶段都恰好只有一个进行中", () => {
        for (const phase of GEN_STEPS) {
            const states = Object.values(stepStates(phase));
            expect(states.filter((state) => state === "active")).toHaveLength(1);
        }
    });
});
