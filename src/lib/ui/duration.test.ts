import { describe, expect, it } from "vitest";
import { formatClock } from "./duration";

describe("formatClock", () => {
    it("按 mm:ss 显示", () => {
        expect(formatClock(0)).toBe("0:00");
        expect(formatClock(9)).toBe("0:09");
        expect(formatClock(65)).toBe("1:05");
        expect(formatClock(600)).toBe("10:00");
        expect(formatClock(3599)).toBe("59:59");
    });

    it("超过一小时带上小时位（原先会显示成 75:00 这种）", () => {
        expect(formatClock(3600)).toBe("1:00:00");
        expect(formatClock(4500)).toBe("1:15:00");
        expect(formatClock(3661)).toBe("1:01:01");
        expect(formatClock(86400)).toBe("24:00:00");
    });

    it("负数与小数不会产生异常文本", () => {
        expect(formatClock(-5)).toBe("0:00");
        expect(formatClock(59.7)).toBe("0:59");
    });
});
