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
