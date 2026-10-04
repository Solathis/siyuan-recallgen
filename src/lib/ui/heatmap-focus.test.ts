import { describe, expect, it } from "vitest";
import { nextFocusCell, type FocusCell } from "./Heatmap.svelte";

/** 构造一个 3 列 × 7 行的完整网格 */
const dense = (): FocusCell[] => {
    const out: FocusCell[] = [];
    for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 7; row++) out.push({ index: col * 7 + row, col, row });
    }
    return out;
};

/** 首列前 3 行是补位格（窗口从周三开始），末列后 2 行也是补位格 */
const padded = (): FocusCell[] => {
    const out: FocusCell[] = [];
    for (let row = 3; row < 7; row++) out.push({ index: row, col: 0, row });
    for (let row = 0; row < 7; row++) out.push({ index: 7 + row, col: 1, row });
    for (let row = 0; row < 5; row++) out.push({ index: 14 + row, col: 2, row });
    return out;
};

describe("nextFocusCell", () => {
    it("上下左右移动一格格子", () => {
        const cells = dense();
        expect(nextFocusCell(cells, { col: 1, row: 3 }, "ArrowDown")?.index).toBe(1 * 7 + 4);
        expect(nextFocusCell(cells, { col: 1, row: 3 }, "ArrowUp")?.index).toBe(1 * 7 + 2);
        expect(nextFocusCell(cells, { col: 1, row: 3 }, "ArrowLeft")?.index).toBe(0 * 7 + 3);
        expect(nextFocusCell(cells, { col: 1, row: 3 }, "ArrowRight")?.index).toBe(2 * 7 + 3);
    });

    it("到边界时返回 null（调用方不做任何事）", () => {
        const cells = dense();
        expect(nextFocusCell(cells, { col: 0, row: 0 }, "ArrowUp")).toBeNull();
        expect(nextFocusCell(cells, { col: 0, row: 0 }, "ArrowLeft")).toBeNull();
        expect(nextFocusCell(cells, { col: 2, row: 6 }, "ArrowDown")).toBeNull();
        expect(nextFocusCell(cells, { col: 2, row: 6 }, "ArrowRight")).toBeNull();
    });

    it("向上跳过首列的补位格（回归：按几何位置算会落到不可聚焦的格子上）", () => {
        const cells = padded();
        // 首列 row0-2 是补位格，从 row3 往上应当没有目标
        expect(nextFocusCell(cells, { col: 0, row: 3 }, "ArrowUp")).toBeNull();
        // 末列 row5-6 是补位格，从 row4 往下应当没有目标
        expect(nextFocusCell(cells, { col: 2, row: 4 }, "ArrowDown")).toBeNull();
    });

    it("横向移动落在同行同一列上，不越到别的行", () => {
        const cells = padded();
        const hit = nextFocusCell(cells, { col: 0, row: 5 }, "ArrowRight");
        expect(hit).toMatchObject({ col: 1, row: 5 });
    });

    it("Home / End 跳到首尾可聚焦格子", () => {
        const cells = padded();
        expect(nextFocusCell(cells, { col: 1, row: 2 }, "Home")?.index).toBe(cells[0].index);
        expect(nextFocusCell(cells, { col: 1, row: 2 }, "End")?.index).toBe(cells[cells.length - 1].index);
    });

    it("其他按键与空集合都安全", () => {
        expect(nextFocusCell(dense(), { col: 0, row: 0 }, "Enter")).toBeNull();
        expect(nextFocusCell(dense(), { col: 0, row: 0 }, "Tab")).toBeNull();
        expect(nextFocusCell([], { col: 0, row: 0 }, "ArrowDown")).toBeNull();
    });
});
