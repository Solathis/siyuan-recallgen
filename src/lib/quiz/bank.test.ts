import { describe, expect, it } from "vitest";
import { Rating, State } from "ts-fsrs";
import type { Question } from "@/types/quiz";
import {
    MAX_BANK_HISTORY,
    appendAttempt,
    applyResult,
    cardPhase,
    dueState,
    createBankItem,
    fromCardState,
    gradeToRating,
    hash32,
    isCardDue,
    masteryScore,
    newCardState,
    bankTags,
    normalizeBankItem,
    normalizeText,
    pickDueItems,
    recentAverage,
    questionFingerprint,
    scheduleReview,
    selectReviewItems,
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

describe("复习历史", () => {
    const item = createBankItem(question("历史题"), { sourceDocId: "doc-1", sourceTitle: "笔记" }, NOW);

    it("新条目没有历史记录", () => {
        expect(item.history).toEqual([]);
        expect(recentAverage(item)).toBeNull();
    });

    it("每次作答追加一条记录，含时间与得分率", () => {
        const first = applyResult(item, 80, NOW);
        const second = applyResult(first, 40, NOW + DAY);
        expect(second.history).toEqual([
            { at: NOW, percent: 80 },
            { at: NOW + DAY, percent: 40 },
        ]);
    });

    it("得分率会被收敛到 0-100", () => {
        expect(applyResult(item, 140, NOW).history?.[0].percent).toBe(100);
        expect(applyResult(item, -5, NOW).history?.[0].percent).toBe(0);
    });

    it("超过上限时丢弃最旧的记录", () => {
        let current = item;
        for (let i = 0; i < MAX_BANK_HISTORY + 5; i++) {
            current = applyResult(current, i, NOW + i * DAY);
        }
        expect(current.history).toHaveLength(MAX_BANK_HISTORY);
        // 最早保留下来的应是第 5 次（索引从 0 开始）
        expect(current.history?.[0].percent).toBe(5);
        expect(current.timesSeen).toBe(MAX_BANK_HISTORY + 5);
    });

    it("recentAverage 只取最近 n 次", () => {
        let current = item;
        for (const percent of [10, 20, 30, 90, 100]) current = applyResult(current, percent, NOW);
        expect(recentAverage(current, 2)).toBe(95);
        expect(recentAverage(current, 5)).toBe(50);
    });
});

describe("appendAttempt", () => {
    it("未提供历史时从空数组开始", () => {
        expect(appendAttempt(undefined, { at: 1, percent: 50 })).toEqual([{ at: 1, percent: 50 }]);
    });
});

describe("normalizeBankItem", () => {
    const raw = createBankItem(question("旧数据"), { sourceDocId: "d", sourceTitle: "t" }, NOW);

    it("补齐早期数据缺失的 history 字段", () => {
        const legacy = { ...raw } as Partial<typeof raw>;
        delete legacy.history;
        expect(normalizeBankItem(legacy as typeof raw).history).toEqual([]);
    });

    it("剔除结构不合法的历史项", () => {
        const messy = {
            ...raw,
            history: [
                { at: NOW, percent: 70 },
                { at: "yesterday", percent: 10 },
                { at: NOW + 1, percent: Number.NaN },
                null,
                { percent: 50 },
            ],
        } as unknown as typeof raw;
        expect(normalizeBankItem(messy).history).toEqual([{ at: NOW, percent: 70 }]);
    });

    it("历史项里的越界得分率也会被收敛", () => {
        const messy = { ...raw, history: [{ at: NOW, percent: 300 }] } as unknown as typeof raw;
        expect(normalizeBankItem(messy).history).toEqual([{ at: NOW, percent: 100 }]);
    });

    it("缺失的统计字段按历史长度补齐", () => {
        const legacy = { ...raw, history: [{ at: NOW, percent: 70 }] } as Partial<typeof raw>;
        delete legacy.timesSeen;
        const fixed = normalizeBankItem(legacy as typeof raw);
        expect(fixed.timesSeen).toBe(1);
        expect(fixed.timesPassed).toBe(0);
    });

    it("规范化后仍保留题目与排程", () => {
        const fixed = normalizeBankItem(raw);
        expect(fixed.question.question).toBe("旧数据");
        expect(fixed.card.due).toBe(raw.card.due);
    });
});

describe("cardPhase", () => {
    const card = createBankItem(question("阶段"), { sourceDocId: "d", sourceTitle: "t" }, NOW).card;

    it("映射 FSRS 阶段", () => {
        expect(cardPhase({ ...card, state: State.New })).toBe("new");
        expect(cardPhase({ ...card, state: State.Learning })).toBe("learning");
        expect(cardPhase({ ...card, state: State.Review })).toBe("review");
        expect(cardPhase({ ...card, state: State.Relearning })).toBe("relearning");
    });

    it("未知阶段按复习中处理，不抛异常", () => {
        expect(cardPhase({ ...card, state: 99 as State })).toBe("review");
    });
});

describe("selectReviewItems", () => {
    /** 造一道已到期的题：可指定来源文档与知识点标签 */
    const make = (text: string, doc: string, tags: string[] = []): BankItem => {
        const base = createBankItem(question(text), { sourceDocId: doc, sourceTitle: doc }, NOW);
        return {
            ...base,
            question: { ...base.question, tags },
            card: { ...base.card, due: NOW - DAY },
        };
    };

    const bank: BankItem[] = [
        make("甲", "doc-1", ["代数", "函数"]),
        make("乙", "doc-1", ["代数"]),
        make("丙", "doc-2", ["几何"]),
        make("丁", "doc-2"),
    ];

    it("默认返回全部到期题目", () => {
        expect(selectReviewItems(bank, { now: NOW })).toHaveLength(4);
    });

    it("按知识点标签筛选", () => {
        expect(selectReviewItems(bank, { now: NOW, tag: "代数" }).map((i) => i.question.question)).toEqual([
            "甲",
            "乙",
        ]);
    });

    it("按来源文档与标签同时限定", () => {
        expect(selectReviewItems(bank, { now: NOW, tag: "代数", sourceDocId: "doc-1" })).toHaveLength(2);
        expect(selectReviewItems(bank, { now: NOW, tag: "几何", sourceDocId: "doc-1" })).toHaveLength(0);
    });

    it("没有标签的题目不会匹配任何标签筛选", () => {
        const ids = selectReviewItems(bank, { now: NOW, tag: "几何" }).map((i) => i.question.question);
        expect(ids).toEqual(["丙"]);
    });

    it("未到期的不返回", () => {
        const future = [{ ...bank[0], card: { ...bank[0].card, due: NOW + DAY } }];
        expect(selectReviewItems(future, { now: NOW })).toHaveLength(0);
    });

    it("limit 限制数量且保持到期时间升序", () => {
        const out = selectReviewItems(bank, { now: NOW, tag: "代数", limit: 1 });
        expect(out).toHaveLength(1);
    });
});

describe("bankTags", () => {
    /** 只关心标签，其余字段用最简结构 */
    const tagged = (text: string, tags: string[] = []): BankItem => {
        const base = createBankItem(question(text), { sourceDocId: "d", sourceTitle: "t" }, NOW);
        return { ...base, question: { ...base.question, tags } };
    };

    it("统计标签题数并按题数倒序", () => {
        const items: BankItem[] = [tagged("甲", ["代数", "函数"]), tagged("乙", ["代数"]), tagged("丙")];
        expect(bankTags(items)).toEqual([
            { tag: "代数", count: 2 },
            { tag: "函数", count: 1 },
        ]);
    });

    it("同一道题的重复标签只计一次", () => {
        expect(bankTags([tagged("甲", ["代数", "代数"])])).toEqual([{ tag: "代数", count: 1 }]);
    });

    it("没有标签时返回空数组", () => {
        expect(bankTags([tagged("甲")])).toEqual([]);
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

describe("dueState", () => {
    const card = (due: number) => ({ ...newCardState(NOW), due });

    it("到期时间已过为 overdue", () => {
        expect(dueState(card(NOW - 1), NOW)).toBe("overdue");
        expect(dueState(card(NOW), NOW)).toBe("overdue");
    });

    it("今天稍后到期为 today", () => {
        const later = new Date(NOW);
        later.setHours(23, 0, 0, 0);
        expect(dueState(card(later.getTime()), NOW)).toBe("today");
    });

    it("明天到期在 7 天内为 soon", () => {
        expect(dueState(card(NOW + DAY), NOW)).toBe("soon");
    });

    it("边界以「当前时刻起 7 天」为准", () => {
        expect(dueState(card(NOW + 7 * DAY), NOW)).toBe("soon");
        expect(dueState(card(NOW + 7 * DAY + 1), NOW)).toBe("later");
    });

    it("超过 7 天为 later", () => {
        expect(dueState(card(NOW + 30 * DAY), NOW)).toBe("later");
    });
});
