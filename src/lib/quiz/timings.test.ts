import { describe, expect, it } from "vitest";
import { sumTimings } from "./timings";

describe("sumTimings", () => {
    it("逐题耗时求和（用于结果页的「用时」）", () => {
        expect(sumTimings({ a: 30, b: 90, c: 12 })).toBe(132);
    });

    it("无数据时返回 0，由调用方决定是否回退到墙钟", () => {
        expect(sumTimings(undefined)).toBe(0);
        expect(sumTimings({})).toBe(0);
    });

    it("忽略非法值：NaN / Infinity / 负数会污染求和", () => {
        // JSON 往返、旧版本数据、异常中断都可能留下这些值
        expect(sumTimings({ a: 30, b: Number.NaN, c: Number.POSITIVE_INFINITY, d: -5 })).toBe(30);
        expect(sumTimings({ a: Number.NaN })).toBe(0);
    });

    it("四舍五入到整秒：逐段累计会产生小数", () => {
        expect(sumTimings({ a: 1.4, b: 1.4 })).toBe(3);
    });
});
