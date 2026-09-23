import { describe, expect, it } from "vitest";
import { Rating, State } from "ts-fsrs";
import type { Question } from "@/types/quiz";
import {
    applyResult,
    createBankItem,
    fromCardState,
    gradeToRating,
    hash32,
    isCardDue,
    masteryScore,
    newCardState,
    normalizeText,
    pickDueItems,
    questionFingerprint,
    scheduleReview,
    summarizeBank,
    toCardState,
    type BankItem,
} from "./bank";

const DAY = 86_400_000;
const NOW = new Date(2026, 8, 23, 12, 0, 0).getTime();

const question = (text: string, type: Question["type"] = "true_false"): Question =>
    ({ id: "q-1", type, difficulty: "easy", question: text, answer: true }) as Question;

describe("normalizeText", () => {
    it("去除空白与标点，统一大小写", () => {
        expect(normalizeText("  Hello, World!  ")).toBe("helloworld");
    });

    it("中英文标点都被去除", () => {
        expect(normalizeText("1+1=2？")).toBe("112");
        expect(normalizeText("（甲）、乙")).toBe("甲乙");
    });

    it("保留中文与字母数字", () => {
        expect(normalizeText("变量 x1 的值")).toBe("变量x1的值");
    });

    it("空串返回空串", () => {
        expect(normalizeText("")).toBe("");
    });
});

describe("hash32", () => {
    it("同输入同输出", () => {
        expect(hash32("abc")).toBe(hash32("abc"));
    });

    it("不同输入一般不同", () => {
        expect(hash32("abc")).not.toBe(hash32("abd"));
    });

    it("固定 8 位十六进制", () => {
        expect(hash32("")).toMatch(/^[0-9a-f]{8}$/);
        expect(hash32("很长的输入".repeat(50))).toMatch(/^[0-9a-f]{8}$/);
    });
});

describe("questionFingerprint", () => {
    it("标点与空白差异不影响指纹", () => {
        expect(questionFingerprint(question("1+1=?"))).toBe(questionFingerprint(question("1 + 1 = ？")));
    });

    it("大小写差异不影响指纹", () => {
        expect(questionFingerprint(question("What is HTTP?"))).toBe(questionFingerprint(question("what is http")));
    });

    it("题型不同则指纹不同", () => {
        expect(questionFingerprint(question("同样的题干", "true_false"))).not.toBe(
            questionFingerprint(question("同样的题干", "subjective"))
        );
    });

    it("题干不同则指纹不同", () => {
        expect(questionFingerprint(question("甲"))).not.toBe(questionFingerprint(question("乙")));
    });

    it("指纹带题型前缀，便于排查", () => {
        expect(questionFingerprint(question("x", "fill_blank"))).toMatch(/^fill_blank:/);
    });
});

describe("gradeToRating", () => {
    it("按得分率分档", () => {
        expect(gradeToRating(100)).toBe(Rating.Easy);
        expect(gradeToRating(90)).toBe(Rating.Easy);
        expect(gradeToRating(89)).toBe(Rating.Good);
        expect(gradeToRating(75)).toBe(Rating.Good);
        expect(gradeToRating(74)).toBe(Rating.Hard);
        expect(gradeToRating(60)).toBe(Rating.Hard);
        expect(gradeToRating(59)).toBe(Rating.Again);
        expect(gradeToRating(0)).toBe(Rating.Again);
    });
});

describe("卡片状态序列化", () => {
    it("新建卡片状态可往返 JSON", () => {
        const state = newCardState(NOW);
        const roundTripped = JSON.parse(JSON.stringify(state));
        expect(roundTripped).toEqual(state);
    });

    it("toCardState / fromCardState 往返保持时间戳", () => {
        const state = newCardState(NOW);
        const card = fromCardState(state);
        expect(card.due.getTime()).toBe(state.due);
        expect(toCardState(card).due).toBe(state.due);
    });

    it("last_review 为 undefined 时不写入字段", () => {
        const state = newCardState(NOW);
        expect(state.last_review).toBeUndefined();
    });

    it("新卡片的 due 不晚于当前时间", () => {
        expect(newCardState(NOW).due).toBeLessThanOrEqual(NOW);
    });
});

describe("scheduleReview", () => {
    it("答对后到期时间被推后", () => {
        const state = newCardState(NOW);
        const next = scheduleReview(state, 95, NOW);
        expect(next.due).toBeGreaterThan(NOW);
    });

    it("答错时到期时间不会推得很远", () => {
        const state = newCardState(NOW);
        const failed = scheduleReview(state, 20, NOW);
        const passed = scheduleReview(state, 95, NOW);
        expect(failed.due).toBeLessThan(passed.due);
    });

    it("高分比低分获得更长的间隔", () => {
        const base = newCardState(NOW);
        expect(scheduleReview(base, 100, NOW).due).toBeGreaterThanOrEqual(scheduleReview(base, 65, NOW).due);
    });

    it("reps 随每次复习递增", () => {
        let state = newCardState(NOW);
        state = scheduleReview(state, 90, NOW);
        const once = state.reps;
        state = scheduleReview(state, 90, NOW + DAY);
        expect(state.reps).toBeGreaterThan(once);
    });

    it("答错计入 lapses", () => {
        let state = newCardState(NOW);
        state = scheduleReview(state, 90, NOW);
        const before = state.lapses;
        state = scheduleReview(state, 10, NOW + DAY);
        expect(state.lapses).toBeGreaterThan(before);
    });
});

describe("isCardDue / pickDueItems", () => {
    const item = (id: string, dueOffset: number): BankItem => ({
        ...createBankItem(question(id), { sourceDocId: "doc", sourceTitle: "来源" }, NOW),
        id,
        card: { ...newCardState(NOW), due: NOW + dueOffset },
    });

    it("到期时间已过即需要复习", () => {
        expect(isCardDue(item("a", -1).card, NOW)).toBe(true);
        expect(isCardDue(item("b", DAY).card, NOW)).toBe(false);
    });

    it("恰好等于当前时间视为到期", () => {
        expect(isCardDue(item("c", 0).card, NOW)).toBe(true);
    });

    it("只挑出到期项并按到期时间升序", () => {
        const items = [item("later", 5 * DAY), item("sooner", -3 * DAY), item("middle", -DAY)];
        expect(pickDueItems(items, NOW).map((i) => i.id)).toEqual(["sooner", "middle"]);
    });

    it("limit 限制返回条数", () => {
        const items = [item("a", -DAY), item("b", -2 * DAY), item("c", -3 * DAY)];
        expect(pickDueItems(items, NOW, 2)).toHaveLength(2);
    });

    it("limit 为 0 表示不限", () => {
        const items = [item("a", -DAY), item("b", -2 * DAY)];
        expect(pickDueItems(items, NOW, 0)).toHaveLength(2);
    });

    it("没有到期项时返回空数组", () => {
        expect(pickDueItems([item("a", DAY)], NOW)).toEqual([]);
    });
});

describe("createBankItem / applyResult", () => {
    const item = createBankItem(question("题干内容"), { sourceDocId: "doc-1", sourceTitle: "笔记" }, NOW);

    it("条目带指纹 id 与来源信息", () => {
        expect(item.id).toBe(questionFingerprint(question("题干内容")));
        expect(item).toMatchObject({ sourceDocId: "doc-1", sourceTitle: "笔记", timesSeen: 0, timesPassed: 0 });
    });

    it("答对后计入达标次数并推进排程", () => {
        const next = applyResult(item, 85, NOW);
        expect(next.timesSeen).toBe(1);
        expect(next.timesPassed).toBe(1);
        expect(next.lastPercent).toBe(85);
        expect(next.card.due).toBeGreaterThan(NOW);
    });

    it("答错计入次数但不计入达标", () => {
        const next = applyResult(item, 40, NOW);
        expect(next.timesSeen).toBe(1);
        expect(next.timesPassed).toBe(0);
    });

    it("60 分记为达标（与界面口径一致）", () => {
        expect(applyResult(item, 60, NOW).timesPassed).toBe(1);
    });

    it("不修改原条目", () => {
        applyResult(item, 30, NOW);
        expect(item.timesSeen).toBe(0);
    });

    it("连续两次作答累加统计", () => {
        const first = applyResult(item, 30, NOW);
        const second = applyResult(first, 95, NOW + DAY);
        expect(second.timesSeen).toBe(2);
        expect(second.timesPassed).toBe(1);
    });
});

describe("masteryScore", () => {
    it("从未作答时为 0", () => {
        const item = createBankItem(question("x"), { sourceDocId: "d", sourceTitle: "s" }, NOW);
        expect(masteryScore(item)).toBe(0);
    });

    it("多次答对且稳定性高时接近 100", () => {
        let item = createBankItem(question("x"), { sourceDocId: "d", sourceTitle: "s" }, NOW);
        for (let i = 0; i < 6; i++) {
            item = applyResult(item, 100, NOW + i * DAY);
        }
        expect(masteryScore(item)).toBeGreaterThan(80);
    });

    it("总是答错时分数偏低", () => {
        let item = createBankItem(question("x"), { sourceDocId: "d", sourceTitle: "s" }, NOW);
        for (let i = 0; i < 4; i++) {
            item = applyResult(item, 0, NOW + i * DAY);
        }
        expect(masteryScore(item)).toBeLessThan(30);
    });

    it("结果落在 0-100 之间", () => {
        const item = createBankItem(question("x"), { sourceDocId: "d", sourceTitle: "s" }, NOW);
        const score = masteryScore(applyResult(item, 100, NOW));
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
    });
});

describe("summarizeBank", () => {
    const item = (dueOffset: number, createdAt = NOW, type: Question["type"] = "true_false"): BankItem => ({
        ...createBankItem(question(`题干${dueOffset}`, type), { sourceDocId: "d", sourceTitle: "s" }, createdAt),
        id: `id-${dueOffset}-${createdAt}`,
        card: { ...newCardState(NOW), due: NOW + dueOffset },
    });

    it("统计总数与到期数", () => {
        const summary = summarizeBank([item(-DAY), item(DAY), item(-2 * DAY)], NOW);
        expect(summary.total).toBe(3);
        expect(summary.due).toBe(2);
    });

    it("按题型计数", () => {
        const summary = summarizeBank(
            [item(DAY, NOW, "single_choice"), item(DAY, NOW, "single_choice"), item(DAY, NOW, "coding")],
            NOW
        );
        expect(summary.byType.single_choice).toBe(2);
        expect(summary.byType.coding).toBe(1);
    });

    it("统计近 30 天新增", () => {
        const summary = summarizeBank([item(DAY, NOW), item(DAY, NOW - 40 * DAY)], NOW);
        expect(summary.recent).toBe(1);
    });

    it("空题库返回零值", () => {
        expect(summarizeBank([], NOW)).toEqual({ total: 0, due: 0, byType: {}, recent: 0 });
    });
});

describe("FSRS 状态常量可用性", () => {
    it("新卡片处于 New 状态", () => {
        expect(newCardState(NOW).state).toBe(State.New);
    });
});
