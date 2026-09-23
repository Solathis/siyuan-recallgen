import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setFallback, t } from "./index";

beforeEach(() => {
    initI18n({});
    setFallback({});
});

describe("t", () => {
    it("未命中任何字典时返回 key 本身", () => {
        expect(t("missing.key")).toBe("missing.key");
    });

    it("优先使用当前语言字典", () => {
        initI18n({ k: "当前" });
        setFallback({ k: "回退" });
        expect(t("k")).toBe("当前");
    });

    it("当前字典缺失时回退到 fallback", () => {
        setFallback({ k: "回退" });
        expect(t("k")).toBe("回退");
    });

    it("当前字典为空字符串时不回退（空串是有意为之）", () => {
        initI18n({ k: "" });
        setFallback({ k: "回退" });
        expect(t("k")).toBe("");
    });

    it("替换单个占位符", () => {
        initI18n({ k: "共 {0} 题" });
        expect(t("k", 15)).toBe("共 15 题");
    });

    it("替换多个不同占位符", () => {
        initI18n({ k: "{0}/{1}" });
        expect(t("k", 3, 15)).toBe("3/15");
    });

    it("数字参数自动转字符串", () => {
        initI18n({ k: "{0}" });
        expect(t("k", 0)).toBe("0");
    });

    it("占位符个数多于参数时保留未替换部分", () => {
        initI18n({ k: "{0}-{1}" });
        expect(t("k", "a")).toBe("a-{1}");
    });

    it("未提供参数时原样返回", () => {
        initI18n({ k: "{0}" });
        expect(t("k")).toBe("{0}");
    });

    it("initI18n 传入 undefined 不崩溃", () => {
        initI18n(undefined as never);
        expect(t("k")).toBe("k");
    });

    // ── 已确认缺陷，修复后把 it.fails 改回 it ────────────────────────────
    it.fails("同一占位符重复出现时全部替换（缺陷：String.replace 只替换首个匹配）", () => {
        initI18n({ k: "{0} 与 {0}" });
        expect(t("k", "A")).toBe("A 与 A");
    });
});
