import { describe, expect, it } from "vitest";
import { BANK_BACKUP_VERSION, buildBankBackup, parseBankBackup } from "./bank-backup";
import { applyResult, createBankItem, type BankItem } from "./bank";
import type { Question } from "@/types/quiz";

const NOW = new Date(2026, 8, 23, 12, 0, 0).getTime();
const DAY = 86_400_000;

const question = (text: string): Question =>
    ({ id: "q-1", type: "true_false", difficulty: "easy", question: text, answer: true }) as Question;

const item = (text: string): BankItem =>
    createBankItem(question(text), { sourceDocId: "doc-1", sourceTitle: "笔记" }, NOW);

describe("buildBankBackup", () => {
    it("生成带版本与类型的备份文件", () => {
        const parsed = JSON.parse(buildBankBackup([item("A")])) as Record<string, unknown>;
        expect(parsed.app).toBe("recallgen");
        expect(parsed.kind).toBe("bank");
        expect(parsed.version).toBe(BANK_BACKUP_VERSION);
        expect(parsed.items).toHaveLength(1);
    });

    it("保留排程与复习历史", () => {
        const reviewed = applyResult(applyResult(item("A"), 70, NOW), 95, NOW + DAY);
        const round = parseBankBackup(buildBankBackup([reviewed]));
        expect(round.file.items[0].card.due).toBe(reviewed.card.due);
        expect(round.file.items[0].history).toEqual([
            { at: NOW, percent: 70 },
            { at: NOW + DAY, percent: 95 },
        ]);
    });

    it("空题库也能生成合法备份", () => {
        expect(parseBankBackup(buildBankBackup([])).file.items).toEqual([]);
    });
});

describe("parseBankBackup 校验", () => {
    it("非 JSON 抛可读错误", () => {
        expect(() => parseBankBackup("not json")).toThrow(/不是合法 JSON/);
    });

    it("拒绝其他插件的备份", () => {
        expect(() => parseBankBackup(JSON.stringify({ app: "other", kind: "bank", items: [] }))).toThrow(
            /不是 RecallGen/
        );
    });

    it("拒绝成绩备份误导入题库", () => {
        expect(() => parseBankBackup(JSON.stringify({ app: "recallgen", kind: "scores", entries: [] }))).toThrow(
            /不是 RecallGen 的题库备份文件/
        );
    });

    it("拒绝更高的版本号", () => {
        const text = JSON.stringify({ app: "recallgen", kind: "bank", version: 99, items: [] });
        expect(() => parseBankBackup(text)).toThrow(/高于当前支持/);
    });

    it("缺少 items 数组时抛错", () => {
        expect(() => parseBankBackup(JSON.stringify({ app: "recallgen", kind: "bank" }))).toThrow(/缺少 items/);
    });

    it("丢弃结构不完整的条目并给出提示", () => {
        const text = JSON.stringify({
            app: "recallgen",
            kind: "bank",
            items: [item("正常"), null, { id: "x" }, { id: "y", question: { question: "" } }],
        });
        const result = parseBankBackup(text);
        expect(result.file.items.map((i) => i.question.question)).toEqual(["正常"]);
        expect(result.warnings.join()).toContain("结构不完整");
    });

    it("缺失排程字段的历史条目会被补齐，而不是被丢弃", () => {
        const legacy = { ...item("旧结构") } as Partial<BankItem>;
        delete legacy.history;
        delete legacy.card;
        const result = parseBankBackup(JSON.stringify({ app: "recallgen", kind: "bank", items: [legacy] }));
        expect(result.file.items).toHaveLength(1);
        expect(result.file.items[0].history).toEqual([]);
    });

    it("按题干重算指纹并提示修正", () => {
        const broken = { ...item("题干"), id: "deadbeef" };
        const result = parseBankBackup(JSON.stringify({ app: "recallgen", kind: "bank", items: [broken] }));
        expect(result.file.items[0].id).not.toBe("deadbeef");
        expect(result.warnings.join()).toContain("重新计算");
    });

    it("备份内的重复题目合并为一条", () => {
        const one = item("重复题干");
        const result = parseBankBackup(JSON.stringify({ app: "recallgen", kind: "bank", items: [one, { ...one }] }));
        expect(result.file.items).toHaveLength(1);
        expect(result.warnings.join()).toContain("重复题目");
    });

    it("没有问题时 warnings 为空", () => {
        expect(parseBankBackup(buildBankBackup([item("干净")])).warnings).toEqual([]);
    });
});
