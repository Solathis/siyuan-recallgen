import { describe, expect, it } from "vitest";
import { PAGE_SIZE, limitGroups, nextLimit, type Group } from "./paging";

/** 构造分组：每组 n 条，编号为「组名-序号」 */
function groups(spec: [string, number][]): Group<string>[] {
    return spec.map(([key, count]) => ({
        key,
        items: Array.from({ length: count }, (_, i) => `${key}-${i}`),
    }));
}

describe("limitGroups", () => {
    it("limit 大于总数时原样返回", () => {
        const result = limitGroups(
            groups([
                ["a", 2],
                ["b", 2],
            ]),
            10
        );
        expect(result.shown).toBe(4);
        expect(result.remaining).toBe(0);
        expect(result.groups).toHaveLength(2);
    });

    it("恰好等于总数时不截断", () => {
        const result = limitGroups(
            groups([
                ["a", 3],
                ["b", 2],
            ]),
            5
        );
        expect(result.shown).toBe(5);
        expect(result.remaining).toBe(0);
    });

    it("在组内截断，保留部分条目", () => {
        const result = limitGroups(
            groups([
                ["a", 3],
                ["b", 5],
            ]),
            4
        );
        expect(result.groups).toHaveLength(2);
        expect(result.groups[0].items).toHaveLength(3);
        expect(result.groups[1].items).toHaveLength(1);
        expect(result.shown).toBe(4);
        expect(result.remaining).toBe(4);
    });

    it("整组被截掉时不会出现在结果里", () => {
        const result = limitGroups(
            groups([
                ["a", 2],
                ["b", 10],
                ["c", 10],
            ]),
            3
        );
        expect(result.groups.map((g) => g.key)).toEqual(["a", "b"]);
        expect(result.remaining).toBe(19);
    });

    it("limit 为 0 时不渲染任何条目但报告剩余", () => {
        const result = limitGroups(groups([["a", 3]]), 0);
        expect(result.groups).toEqual([]);
        expect(result.shown).toBe(0);
        expect(result.remaining).toBe(3);
    });

    it("负数 limit 视为不渲染", () => {
        expect(limitGroups(groups([["a", 3]]), -5).shown).toBe(0);
    });

    it("空分组返回零值", () => {
        expect(limitGroups([], 10)).toEqual({ groups: [], shown: 0, remaining: 0 });
    });

    it("空组不会导致计数错乱", () => {
        const result = limitGroups(
            groups([
                ["a", 0],
                ["b", 2],
            ]),
            1
        );
        expect(result.shown).toBe(1);
        expect(result.groups).toEqual([{ key: "b", items: ["b-0"] }]);
    });

    it("不修改入参分组", () => {
        const input = groups([["a", 3]]);
        limitGroups(input, 1);
        expect(input[0].items).toHaveLength(3);
    });

    it("保持分组顺序", () => {
        const result = limitGroups(
            groups([
                ["c", 1],
                ["a", 1],
                ["b", 1],
            ]),
            3
        );
        expect(result.groups.map((g) => g.key)).toEqual(["c", "a", "b"]);
    });
});

describe("nextLimit", () => {
    it("每次增加一个步长", () => {
        expect(nextLimit(60, 500)).toBe(120);
    });

    it("不超过总数", () => {
        expect(nextLimit(60, 100)).toBe(100);
    });

    it("已到总数时保持不变", () => {
        expect(nextLimit(100, 100)).toBe(100);
    });

    it("可自定义步长", () => {
        expect(nextLimit(10, 100, 5)).toBe(15);
    });

    it("默认步长与 PAGE_SIZE 一致", () => {
        expect(nextLimit(0, 1000)).toBe(PAGE_SIZE);
    });
});
