// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadText, exportStamp } from "./download";

describe("exportStamp", () => {
    it("按本地时区输出 YYYY-MM-DD", () => {
        expect(exportStamp(new Date(2026, 8, 23, 23, 30))).toBe("2026-09-23");
        expect(exportStamp(new Date(2026, 0, 5, 0, 5))).toBe("2026-01-05");
    });

    it("不会因时区偏移把日期算到前一天", () => {
        // 本地时间当天最后一刻，用 toISOString 会跳到次日
        expect(exportStamp(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
    });
});

describe("downloadText", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("创建下载链接并延后释放 object URL（回归：同步 revoke 会打断下载）", () => {
        vi.useFakeTimers();
        const created: string[] = [];
        const revoked: string[] = [];
        const clicks: string[] = [];
        let downloadName = "";

        vi.stubGlobal("URL", {
            createObjectURL: () => {
                created.push("blob:1");
                return "blob:1";
            },
            revokeObjectURL: (url: string) => revoked.push(url),
        });
        const originalCreate = document.createElement.bind(document);
        vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
            const el = originalCreate(tag) as HTMLAnchorElement;
            if (tag === "a") {
                el.click = () => clicks.push(el.download);
                Object.defineProperty(el, "download", {
                    set(value: string) {
                        downloadName = value;
                    },
                    get: () => downloadName,
                });
            }
            return el;
        });

        downloadText("report.csv", "a,b", "text/csv");

        expect(clicks).toEqual(["report.csv"]);
        // 关键：点击时还没有释放
        expect(revoked).toEqual([]);
        vi.advanceTimersByTime(1000);
        expect(revoked).toEqual(["blob:1"]);

        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });
});
