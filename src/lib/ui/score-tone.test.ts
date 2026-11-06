import { describe, expect, it } from "vitest";
import { scoreBar, scoreText } from "./score-tone";

/**
 * 四个页面原先各写一份 80/60/30 配色；收成一份之后，这里钉住「外观不变」：
 * 每一档给出的类名与原先各处手写的字面量逐字相同。
 */
describe("分数配色", () => {
    it("分数文字：优秀绿、达标主题色、偏弱黄、很差红", () => {
        expect([95, 80, 70, 60, 45, 30, 10].map(scoreText)).toEqual([
            "text-success",
            "text-success",
            "text-primary",
            "text-primary",
            "text-warning",
            "text-warning",
            "text-destructive",
        ]);
    });

    it("分数条覆盖 Progress 指示条的底色，档位与文字一致", () => {
        expect([80, 60, 30, 0].map(scoreBar)).toEqual([
            "[&>[data-slot=progress-indicator]]:bg-success",
            "[&>[data-slot=progress-indicator]]:bg-primary",
            "[&>[data-slot=progress-indicator]]:bg-warning",
            "[&>[data-slot=progress-indicator]]:bg-destructive",
        ]);
    });
});
