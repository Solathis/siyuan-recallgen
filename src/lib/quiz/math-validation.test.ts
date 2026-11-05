import { expect, it } from "vitest";
import { coerceQuestion } from "./generator";

it("rejects JSON escape corruption but preserves valid TeX", () => {
    const q = { type: "subjective", question: String.raw`$\tau+\frac{1}{2}$`, reference_answer: "ok" };
    expect(coerceQuestion(q, "q1", ["subjective"]).ok).toBe(true);
    for (const question of ["\tau", "\frac{1}{2}", "\beta", "\rho"]) {
        expect(coerceQuestion({ ...q, question }, "q1", ["subjective"]).ok).toBe(false);
    }
});
