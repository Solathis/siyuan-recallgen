import { describe, expect, it, vi } from "vitest";
import type { ScoreDetail, ScoreIndexEntry } from "@/types/quiz";
import { resolveReviewDetail } from "./service";

const entry = { id: "s-1", quizId: "q-1", title: "t", timestamp: 1 } as ScoreIndexEntry;
const detail: ScoreDetail = { id: "s-1", detail: [], questions: [], analysis: "" };

describe("回看 Tab 的明细来源", () => {
    it("旧布局里 Tab 数据自带明细：直接用，不再读盘", async () => {
        const load = vi.fn(async () => null);
        expect(await resolveReviewDetail({ entry, detail }, load)).toBe(detail);
        expect(load).not.toHaveBeenCalled();
    });

    it("新的 Tab 数据只带索引条目：按 id 读取明细", async () => {
        const load = vi.fn(async (id: string) => (id === "s-1" ? detail : null));
        expect(await resolveReviewDetail({ entry }, load)).toBe(detail);
        expect(load).toHaveBeenCalledWith("s-1");
    });

    it("成绩已被删除（从布局恢复的旧 Tab）：返回 null，由面板提示而不是显示空结果", async () => {
        expect(await resolveReviewDetail({ entry }, async () => null)).toBeNull();
    });
});
