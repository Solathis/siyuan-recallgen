// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, legacyCopy } from "./clipboard";

/** 按需伪造 navigator.clipboard（jsdom 默认没有） */
function stubClipboard(writeText: ((text: string) => Promise<void>) | null): void {
    Object.defineProperty(navigator, "clipboard", {
        value: writeText ? { writeText } : undefined,
        configurable: true,
    });
}

afterEach(() => {
    stubClipboard(null);
    vi.restoreAllMocks();
});

describe("copyText", () => {
    it("优先走 navigator.clipboard", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        stubClipboard(writeText);
        await expect(copyText("hello")).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith("hello");
    });

    it("clipboard 抛错时回落到 execCommand", async () => {
        stubClipboard(() => Promise.reject(new Error("denied")));
        const exec = vi.fn().mockReturnValue(true);
        document.execCommand = exec;
        await expect(copyText("hello")).resolves.toBe(true);
        expect(exec).toHaveBeenCalledWith("copy");
    });

    it("没有 clipboard 时直接走兜底", async () => {
        stubClipboard(null);
        document.execCommand = vi.fn().mockReturnValue(true);
        await expect(copyText("x")).resolves.toBe(true);
    });
});

describe("legacyCopy", () => {
    it("复制成功后不留下临时节点", () => {
        document.execCommand = vi.fn().mockReturnValue(true);
        expect(legacyCopy("abc")).toBe(true);
        expect(document.querySelectorAll("textarea")).toHaveLength(0);
    });

    it("环境不支持时返回 false 并清理节点", () => {
        document.execCommand = vi.fn(() => {
            throw new Error("not supported");
        });
        expect(legacyCopy("abc")).toBe(false);
        expect(document.querySelectorAll("textarea")).toHaveLength(0);
    });
});
