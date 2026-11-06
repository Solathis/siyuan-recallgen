import { describe, expect, it } from "vitest";
import { isOpenableDocId, sourceGroupKey } from "./history-view";

describe("来源分组的键", () => {
    it("同一篇文档改过名也归为一组", () => {
        const a = sourceGroupKey({ sourceDocId: "20261008120000-abcdefg", sourceTitle: "旧标题", title: "旧标题" });
        const b = sourceGroupKey({ sourceDocId: "20261008120000-abcdefg", sourceTitle: "新标题", title: "新标题" });
        expect(a).toBe(b);
    });

    it("标题前缀相同的两篇文档不会并成一组（回归：原先按「·」之前的部分分组）", () => {
        const a = sourceGroupKey({ sourceDocId: "20261008120000-aaaaaaa", sourceTitle: "第三章 · 上", title: "x" });
        const b = sourceGroupKey({ sourceDocId: "20261008120000-bbbbbbb", sourceTitle: "第三章 · 下", title: "x" });
        expect(a).not.toBe(b);
    });

    it("没有 sourceDocId 的旧记录按来源标题分组，且不会与文档 id 撞键", () => {
        expect(sourceGroupKey({ sourceTitle: " 第三章 ", title: "t" })).toBe("title:第三章");
        expect(sourceGroupKey({ sourceTitle: "", title: "" })).toBe("none");
        expect(sourceGroupKey({ sourceDocId: "x", title: "" })).not.toBe(
            sourceGroupKey({ sourceTitle: "x", title: "" })
        );
    });
});

describe("能不能跳回原笔记", () => {
    it("思源块 id 可以", () => {
        expect(isOpenableDocId("20261008120000-abc1234")).toBe(true);
    });

    it("粘贴材料、按日期出题、到期复习的占位 id 不可以", () => {
        for (const id of [
            "manual-1730000000000",
            "date-before",
            "date-today",
            "nb-20261008120000-abc1234-today",
            "bank-due",
            "",
            undefined,
        ]) {
            expect(isOpenableDocId(id), String(id)).toBe(false);
        }
    });
});
