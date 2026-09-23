import { describe, expect, it } from "vitest";
import { donutArcs, lineGeometry, linearScale, polar, ticks, timeTicks } from "./chart-geometry";

describe("linearScale", () => {
    it("端点映射到目标区间端点", () => {
        const scale = linearScale(0, 100, 0, 200);
        expect(scale(0)).toBe(0);
        expect(scale(100)).toBe(200);
    });

    it("中间值按比例映射", () => {
        expect(linearScale(0, 100, 0, 200)(25)).toBe(50);
    });

    it("支持反向区间（如屏幕坐标 y 轴向下）", () => {
        const scale = linearScale(0, 100, 150, 10);
        expect(scale(0)).toBe(150);
        expect(scale(100)).toBe(10);
        expect(scale(50)).toBe(80);
    });

    it("定义域为单点时不产生 NaN", () => {
        const scale = linearScale(5, 5, 0, 100);
        expect(scale(5)).toBe(0);
        expect(Number.isFinite(scale(999))).toBe(true);
    });
});

describe("ticks", () => {
    it("生成含首尾的等分刻度", () => {
        expect(ticks(100, 4)).toEqual([0, 25, 50, 75, 100]);
    });

    it("默认 4 段", () => {
        expect(ticks(40)).toEqual([0, 10, 20, 30, 40]);
    });

    it("max 为 0 或负数时只返回 [0]", () => {
        expect(ticks(0)).toEqual([0]);
        expect(ticks(-5)).toEqual([0]);
    });

    it("max 非有限数时只返回 [0]，不产生 NaN 刻度", () => {
        expect(ticks(Number.NaN)).toEqual([0]);
        expect(ticks(Number.POSITIVE_INFINITY)).toEqual([0]);
    });
});

describe("lineGeometry", () => {
    const padding = { top: 10, right: 10, bottom: 20, left: 30 };

    it("空数据返回空路径", () => {
        expect(lineGeometry([], 100, 100, padding)).toEqual({ points: [], line: "", area: "" });
    });

    it("单点放在水平中间，且不生成面积路径", () => {
        const geo = lineGeometry([50], 100, 100, padding);
        expect(geo.points).toHaveLength(1);
        // 内宽 = 100-30-10 = 60，中点 = 30 + 30 = 60
        expect(geo.points[0].x).toBe(60);
        expect(geo.area).toBe("");
    });

    it("y 轴把 0 映射到底部、100 映射到顶部", () => {
        const geo = lineGeometry([0, 100], 100, 100, padding);
        // 内高 = 100 - 上 10 - 下 20 = 70，故 0 落在 y=80、100 落在 y=10
        expect(geo.points[0].y).toBe(80);
        expect(geo.points[1].y).toBe(10);
    });

    it("路径以 M 开头、后续用 L", () => {
        const geo = lineGeometry([10, 20, 30], 100, 100, padding);
        expect(geo.line.startsWith("M")).toBe(true);
        expect(geo.line.match(/L/g)).toHaveLength(2);
    });

    it("面积路径闭合到基线", () => {
        const geo = lineGeometry([10, 20], 100, 100, padding);
        expect(geo.area.endsWith("Z")).toBe(true);
        expect(geo.area).toContain("L");
    });

    it("超出 0-100 的值被夹紧，不画到画布外", () => {
        const geo = lineGeometry([-50, 150], 100, 100, padding);
        expect(geo.points[0].y).toBe(80);
        expect(geo.points[1].y).toBe(10);
    });

    it("NaN 值按 0 处理，不产生非法坐标", () => {
        const geo = lineGeometry([Number.NaN], 100, 100, padding);
        expect(Number.isFinite(geo.points[0].y)).toBe(true);
    });

    it("多点在水平方向均匀分布", () => {
        const geo = lineGeometry([1, 2, 3], 100, 100, padding);
        expect(geo.points.map((p) => p.x)).toEqual([30, 60, 90]);
    });

    it("画布小于内边距时不产生负坐标", () => {
        const geo = lineGeometry([50], 20, 20, padding);
        expect(Number.isFinite(geo.points[0].x)).toBe(true);
    });
});

describe("polar", () => {
    it("0 度指向 12 点方向", () => {
        expect(polar(50, 50, 10, 0)).toEqual({ x: 50, y: 40 });
    });

    it("90 度指向 3 点方向", () => {
        expect(polar(50, 50, 10, 90)).toEqual({ x: 60, y: 50 });
    });

    it("180 度指向 6 点方向", () => {
        expect(polar(50, 50, 10, 180)).toEqual({ x: 50, y: 60 });
    });

    it("270 度指向 9 点方向", () => {
        expect(polar(50, 50, 10, 270)).toEqual({ x: 40, y: 50 });
    });
});

describe("donutArcs", () => {
    const opts = { cx: 50, cy: 50, inner: 20, outer: 40 };

    it("全为 0 时返回空数组", () => {
        expect(donutArcs([0, 0], opts)).toEqual([]);
    });

    it("空数组返回空", () => {
        expect(donutArcs([], opts)).toEqual([]);
    });

    it("按比例划分角度", () => {
        const arcs = donutArcs([1, 3], opts);
        expect(arcs).toHaveLength(2);
        expect(arcs[0].ratio).toBeCloseTo(0.25);
        expect(arcs[0].endAngle).toBeCloseTo(90);
        expect(arcs[1].startAngle).toBeCloseTo(90);
        expect(arcs[1].endAngle).toBeCloseTo(360);
    });

    it("跳过 0 值项", () => {
        expect(donutArcs([1, 0, 1], opts)).toHaveLength(2);
    });

    it("负值与 NaN 不计入总数", () => {
        const arcs = donutArcs([1, -5, Number.NaN], opts);
        expect(arcs).toHaveLength(1);
        expect(arcs[0].ratio).toBe(1);
    });

    it("单项占满整圈时仍生成合法路径（单段 360 度弧会退化为空）", () => {
        const arcs = donutArcs([10], opts);
        expect(arcs).toHaveLength(1);
        expect(arcs[0].path).toContain("A");
        // 整圈用两段半圆表达
        expect(arcs[0].path.match(/A/g)!.length).toBeGreaterThanOrEqual(4);
    });

    it("每个扇区路径都以 M 开头、以 Z 闭合", () => {
        for (const arc of donutArcs([1, 2, 3], opts)) {
            expect(arc.path.startsWith("M")).toBe(true);
            expect(arc.path.endsWith("Z")).toBe(true);
        }
    });

    it("小扇区不超过半圈时不使用大弧标志", () => {
        const arcs = donutArcs([1, 9], opts);
        expect(arcs[0].path).toContain("A40,40 0 0 1");
    });

    it("超过半圈的扇区使用大弧标志", () => {
        const arcs = donutArcs([7, 3], opts);
        expect(arcs[0].path).toContain("A40,40 0 1 1");
    });

    it("扇区角度连续无缝隙", () => {
        const arcs = donutArcs([1, 1, 1, 1], opts);
        for (let i = 1; i < arcs.length; i++) {
            expect(arcs[i].startAngle).toBeCloseTo(arcs[i - 1].endAngle);
        }
    });
});

describe("timeTicks", () => {
    it("空数组返回空", () => {
        expect(timeTicks([])).toEqual([]);
    });

    it("数据只有单个时间点时返回该点", () => {
        expect(timeTicks([1000])).toEqual([1000]);
    });

    it("所有时间相同也返回单点，不做等分", () => {
        expect(timeTicks([500, 500, 500], 3)).toEqual([500]);
    });

    it("等分首末时间戳", () => {
        expect(timeTicks([0, 300], 3)).toEqual([0, 100, 200, 300]);
    });

    it("顺序打乱也能正确取到首末", () => {
        expect(timeTicks([200, 0, 100], 2)).toEqual([0, 100, 200]);
    });

    it("返回整数时间戳", () => {
        for (const t of timeTicks([0, 10], 3)) expect(Number.isInteger(t)).toBe(true);
    });
});
