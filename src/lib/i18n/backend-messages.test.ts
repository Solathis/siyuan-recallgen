import { beforeEach, describe, expect, it } from "vitest";
import en from "@/../public/i18n/en.json";
import { initI18n, setFallback } from "@/lib/i18n";
import { parseBankBackup } from "@/lib/quiz/bank-backup";
import { isRunSupported, runCodingTests } from "@/lib/quiz/code-runner";
import { parseConfigExport } from "@/lib/quiz/config-io";
import { parseScoreBackup } from "@/lib/quiz/export";

/**
 * 英文界面下，后端模块抛出的错误与提示也必须是英文。
 *
 * 这些文案此前硬编码为中文，英文界面里导入失败会看到中英混排的提示。
 * 全局 setup 注入的是中文字典（便于断言可读文案），因此这里显式换成英文字典。
 */
beforeEach(() => {
    initI18n(en as Record<string, string>);
    setFallback(en as Record<string, string>);
});

describe("英文界面下的后端文案", () => {
    it("题库备份的解析错误是英文", () => {
        expect(() => parseBankBackup("{不是 json")).toThrow(/Not valid JSON/);
        expect(() => parseBankBackup('"只是一个字符串"')).toThrow(/not an object/);
        expect(() => parseBankBackup('{"app":"other","kind":"bank"}')).toThrow(/Not a RecallGen question-bank backup/);
        expect(() => parseBankBackup('{"app":"recallgen","kind":"bank","version":99}')).toThrow(
            /newer than the supported/
        );
        expect(() => parseBankBackup('{"app":"recallgen","kind":"bank"}')).toThrow(/no items array/);
    });

    it("题库备份的跳过提示是英文并带数量", () => {
        const text = JSON.stringify({
            app: "recallgen",
            kind: "bank",
            version: 1,
            items: [null, { id: "x" }],
        });
        const result = parseBankBackup(text);
        expect(result.warnings.join(" ")).toMatch(/2 record\(s\) were incomplete/);
    });

    it("成绩备份的解析错误是英文", () => {
        expect(() => parseScoreBackup('{"app":"other","kind":"scores"}')).toThrow(/Not a RecallGen score backup/);
        expect(() => parseScoreBackup('{"app":"recallgen","kind":"scores"}')).toThrow(/no entries array/);
    });

    it("配置文件的解析错误是英文", () => {
        expect(() => parseConfigExport('{"app":"other","config":{}}')).toThrow(/Not a RecallGen config file/);
        expect(() => parseConfigExport('{"app":"recallgen"}')).toThrow(/no config field/);
    });

    it("编程题无法运行的原因也是英文", async () => {
        const outcome = await runCodingTests({
            language: "python",
            code: "print(1)",
            entryPoint: "solve",
            cases: [{ args: [], expected: "1" }],
        });
        // 用显式类型守卫收窄：strict 关闭时对 boolean 字面量的判别式联合无法自动收窄
        expect(isRunSupported(outcome)).toBe(false);
        if (!isRunSupported(outcome)) expect(outcome.reason).toMatch(/Only JavaScript can be executed/);
    });

    it("没有测试用例的原因同样是英文", async () => {
        const outcome = await runCodingTests({ language: "javascript", code: "f(){}", entryPoint: "f", cases: [] });
        expect(isRunSupported(outcome)).toBe(false);
        if (!isRunSupported(outcome)) expect(outcome.reason).toMatch(/no test cases/);
    });
});

describe("英文界面下导出的 Markdown 表头", () => {
    const entry = {
        id: "s-1",
        timestamp: new Date(2026, 8, 23, 14, 5).getTime(),
        title: "第三章",
        totalScore: 80,
        maxScore: 100,
        questionCount: 5,
        passedCount: 4,
        unanswered: 1,
        byType: {},
    } as unknown as import("@/types/quiz").ScoreIndexEntry;

    it("表头与内容都用英文，不再出现中文表头", async () => {
        const { buildMarkdownExport } = await import("@/lib/quiz/export");
        const md = buildMarkdownExport([entry], "RecallGen");
        expect(md).toContain("| Time | Title | Source |");
        expect(md).toContain("| Correct |");
        expect(md).not.toMatch(/[时间标题来源得分]/);
    });

    it("中文界面下仍是中文表头", async () => {
        const zh = (await import("@/../public/i18n/zh-CN.json")).default as Record<string, string>;
        const { initI18n, setFallback } = await import("@/lib/i18n");
        initI18n(zh);
        setFallback(zh);
        const { buildMarkdownExport } = await import("@/lib/quiz/export");
        const md = buildMarkdownExport([entry], "RecallGen");
        expect(md).toContain("| 时间 | 标题 | 来源 |");
    });
});

describe("默认值的语言", () => {
    it("英文界面下默认端点名与测试提示词是英文", async () => {
        const { getDefaultConfig } = await import("@/types/config");
        const config = getDefaultConfig();
        expect(config.ai.endpoints[0].name).toBe("Default endpoint");
        expect(config.ai.testPrompt).toBe("Introduce yourself in one sentence");
    });

    it("中文界面下保持中文，且绝不会把 i18n key 当文案", async () => {
        const zh = (await import("@/../public/i18n/zh-CN.json")).default as Record<string, string>;
        const { initI18n, setFallback } = await import("@/lib/i18n");
        initI18n(zh);
        setFallback(zh);
        const { getDefaultConfig } = await import("@/types/config");
        const config = getDefaultConfig();
        expect(config.ai.endpoints[0].name).toBe("默认端点");
        expect(config.ai.testPrompt).toBe("请用一句话简要介绍你自己");
    });

    it("字典未注入时回落到中性英文，而不是 key（回归：默认端点会被命名成 key 并落盘）", async () => {
        const { initI18n, setFallback } = await import("@/lib/i18n");
        initI18n({});
        setFallback({});
        const { getDefaultConfig } = await import("@/types/config");
        const config = getDefaultConfig();
        expect(config.ai.endpoints[0].name).toBe("Default");
        expect(config.ai.endpoints[0].name).not.toContain("config.");
        expect(config.ai.testPrompt).not.toContain("config.");
    });
});
