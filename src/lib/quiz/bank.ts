import { createEmptyCard, fsrs, Rating, State, type Card } from "ts-fsrs";
import { PASS_SCORE } from "@/types/quiz";
import type { Question, QuestionType } from "@/types/quiz";

/**
 * 题库与间隔重复。
 *
 * 设计要点：
 * - 「同一道题」用题干指纹识别，避免同一篇笔记反复生成几乎相同的题目
 * - 排程使用成熟的 FSRS 实现（ts-fsrs），本模块只负责把得分率映射成 FSRS 评分，
 *   以及把 Card 转成可 JSON 持久化的结构（Card 里含 Date，直接存会退化成字符串）
 * - 本模块全部为纯函数，不接触存储与 UI，便于单测
 */

/** 题目指纹：归一化题干 + 题型，用于去重 */
export function questionFingerprint(question: Question): string {
    const normalized = normalizeText(question.question);
    // 把题型与长度一起纳入，降低哈希碰撞概率
    return `${question.type}:${normalized.length}:${hash32(`${question.type}|${normalized}`)}`;
}

/**
 * 归一化题干：
 * 统一大小写、去掉所有空白与常见标点，只保留字母数字与中日韩文字。
 * 这样「1 + 1 = ?」与「1+1=?」会被识别为同一题。
 */
export function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .replace(/[\s\u3000]+/g, "")
        .replace(/[!-/:-@[-`{-~\u3001-\u303f\uff01-\uff5e]/g, "");
}

/** djb2 哈希，输出 8 位十六进制。仅用于去重，不用于安全场景 */
export function hash32(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}

/** 可 JSON 持久化的 FSRS 卡片状态 */
export interface BankCardState {
    due: number;
    stability: number;
    difficulty: number;
    elapsed_days: number;
    scheduled_days: number;
    learning_steps: number;
    reps: number;
    lapses: number;
    state: State;
    last_review?: number;
}

/** 一次复习记录 */
export interface BankAttempt {
    /** 作答时间 */
    at: number;
    /** 得分率（0-100） */
    percent: number;
}

/**
 * 每题保留的复习历史条数上限。
 * 只留最近若干次即可满足回看需求，同时避免题库体积随作答次数无限增长
 * （题库分片是整体重写的，单条记录过大也会拖慢每次交卷的写入）。
 */
export const MAX_BANK_HISTORY = 20;

/** 追加一次复习记录，超出上限时丢弃最旧的 */
export function appendAttempt(history: BankAttempt[] | undefined, attempt: BankAttempt): BankAttempt[] {
    const next = [...(history ?? []), attempt];
    return next.length > MAX_BANK_HISTORY ? next.slice(next.length - MAX_BANK_HISTORY) : next;
}

/** 最近 n 次作答的平均得分率；没有记录时返回 null */
export function recentAverage(item: BankItem, window = 5): number | null {
    const history = item.history ?? [];
    if (history.length === 0) return null;
    const slice = history.slice(-window);
    return slice.reduce((sum, a) => sum + a.percent, 0) / slice.length;
}

/**
 * 兼容早期版本：补齐缺失字段并剔除结构不合法的历史项。
 * 题库分片里存的是旧结构时，读取路径统一走这里，界面就不必到处判空。
 */
export function normalizeBankItem(raw: BankItem, now = Date.now()): BankItem {
    const rawHistory = Array.isArray(raw.history) ? raw.history : [];
    const history = rawHistory
        .filter(
            (a): a is BankAttempt => !!a && typeof a === "object" && Number.isFinite(a.at) && Number.isFinite(a.percent)
        )
        .map((a) => ({ at: a.at, percent: clampPercent(a.percent) }));
    return {
        ...raw,
        createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
        updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : (raw.createdAt ?? now),
        timesSeen: Number.isFinite(raw.timesSeen) ? raw.timesSeen : history.length,
        timesPassed: Number.isFinite(raw.timesPassed) ? raw.timesPassed : 0,
        history: history.slice(-MAX_BANK_HISTORY),
    };
}

/** 得分率收敛到 0-100 */
function clampPercent(value: number): number {
    return Math.max(0, Math.min(100, value));
}

/** 题库条目 */
export interface BankItem {
    /** 题干指纹 */
    id: string;
    question: Question;
    sourceDocId: string;
    sourceTitle: string;
    createdAt: number;
    updatedAt: number;
    card: BankCardState;
    /** 被考过的次数 */
    timesSeen: number;
    /** 其中达标的次数 */
    timesPassed: number;
    /** 最近一次得分率（0-100） */
    lastPercent?: number;
    /** 复习历史（最近 MAX_BANK_HISTORY 次），旧数据可能缺省 */
    history?: BankAttempt[];
}

const scheduler = fsrs();

/** 新建卡片的初始状态 */
export function newCardState(now = Date.now()): BankCardState {
    return toCardState(createEmptyCard(new Date(now)));
}

/** Card → 可持久化状态 */
export function toCardState(card: Card): BankCardState {
    return {
        due: card.due.getTime(),
        stability: card.stability,
        difficulty: card.difficulty,
        elapsed_days: card.elapsed_days,
        scheduled_days: card.scheduled_days,
        learning_steps: card.learning_steps,
        reps: card.reps,
        lapses: card.lapses,
        state: card.state,
        last_review: card.last_review ? card.last_review.getTime() : undefined,
    };
}

/** 可持久化状态 → Card */
export function fromCardState(state: BankCardState): Card {
    return {
        due: new Date(state.due),
        stability: state.stability,
        difficulty: state.difficulty,
        elapsed_days: state.elapsed_days,
        scheduled_days: state.scheduled_days,
        learning_steps: state.learning_steps,
        reps: state.reps,
        lapses: state.lapses,
        state: state.state,
        last_review: state.last_review === undefined ? undefined : new Date(state.last_review),
    };
}

/**
 * 得分率映射为 FSRS 评分。
 * 阈值刻意偏严：60 分才算「勉强记住」，85 分以上才认为「轻松」，
 * 这样低分题会更频繁地回到复习队列。
 */
export function gradeToRating(percent: number): Exclude<Rating, Rating.Manual> {
    if (percent >= 90) return Rating.Easy;
    if (percent >= 75) return Rating.Good;
    if (percent >= 60) return Rating.Hard;
    return Rating.Again;
}

/** 依据一次作答的得分率推进排程，返回新的卡片状态 */
export function scheduleReview(state: BankCardState, percent: number, now = Date.now()): BankCardState {
    const card = fromCardState(state);
    const rating = gradeToRating(percent);
    const { card: next } = scheduler.next(card, new Date(now), rating);
    return toCardState(next);
}

/**
 * 卡片是否已到复习时间。
 * 参数名刻意带 card，避免误传整个 BankItem（BankItem 没有顶层 due 字段）。
 */
export function isCardDue(card: BankCardState, now = Date.now()): boolean {
    return card.due <= now;
}

/**
 * 到期状态，用于题库列表的展示与排序文案。
 * - overdue：已过期（到期时间在过去）
 * - today：今天到期
 * - soon：7 天内到期
 * - later：更晚
 */
export type DueState = "overdue" | "today" | "soon" | "later";

export function dueState(card: BankCardState, now = Date.now()): DueState {
    if (card.due <= now) return "overdue";
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    if (card.due <= endOfToday.getTime()) return "today";
    if (card.due - now <= 7 * 86_400_000) return "soon";
    return "later";
}

/** 卡片所处的 FSRS 阶段，用于界面展示 */
export function cardPhase(card: BankCardState): "new" | "learning" | "review" | "relearning" {
    switch (card.state) {
        case State.New:
            return "new";
        case State.Learning:
            return "learning";
        case State.Relearning:
            return "relearning";
        default:
            return "review";
    }
}

/** 掌握度评分（0-100）：由稳定性与正确率共同决定，用于界面展示 */
export function masteryScore(item: BankItem): number {
    const accuracy = item.timesSeen > 0 ? (item.timesPassed / item.timesSeen) * 100 : 0;
    // 稳定性 30 天以上视为完全掌握，与正确率各占一半
    const stabilityScore = Math.min(100, (item.card.stability / 30) * 100);
    return Math.round(accuracy * 0.5 + stabilityScore * 0.5);
}

/** 从题库中挑出到期题目，按到期时间升序；limit 为 0 表示不限 */
export function pickDueItems(items: BankItem[], now = Date.now(), limit = 0): BankItem[] {
    const due = items.filter((item) => isCardDue(item.card, now)).sort((a, b) => a.card.due - b.card.due);
    return limit > 0 ? due.slice(0, limit) : due;
}

/**
 * 复习选题：先按来源文档与知识点标签限定范围，再取到期题目（到期时间升序）。
 * limit 为 0 表示不限。抽成纯函数便于单测，也让 index.ts 的实现保持一行。
 */
export function selectReviewItems(
    items: BankItem[],
    {
        now = Date.now(),
        limit = 0,
        tag,
        sourceDocId,
    }: { now?: number; limit?: number; tag?: string; sourceDocId?: string } = {}
): BankItem[] {
    const scoped = items.filter((item) => {
        if (sourceDocId && item.sourceDocId !== sourceDocId) return false;
        if (tag && !(item.question.tags ?? []).includes(tag)) return false;
        return true;
    });
    return pickDueItems(scoped, now, limit);
}

/** 题库里出现过的知识点标签及题数，按题数倒序；用于题库的标签筛选 */
export function bankTags(items: BankItem[]): { tag: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const item of items) {
        // 同一道题的重复标签只计一次，否则筛选下拉里的题数会虚高
        for (const tag of new Set(item.question.tags ?? [])) {
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** 把一次作答的结果并入题库条目 */
export function applyResult(item: BankItem, percent: number, now = Date.now()): BankItem {
    return {
        ...item,
        updatedAt: now,
        card: scheduleReview(item.card, percent, now),
        timesSeen: item.timesSeen + 1,
        timesPassed: item.timesPassed + (percent >= PASS_SCORE ? 1 : 0),
        lastPercent: percent,
        history: appendAttempt(item.history, { at: now, percent: clampPercent(percent) }),
    };
}

/** 由题目创建题库条目 */
export function createBankItem(
    question: Question,
    source: { sourceDocId: string; sourceTitle: string },
    now = Date.now()
): BankItem {
    return {
        id: questionFingerprint(question),
        question,
        sourceDocId: source.sourceDocId,
        sourceTitle: source.sourceTitle,
        createdAt: now,
        updatedAt: now,
        card: newCardState(now),
        timesSeen: 0,
        timesPassed: 0,
        history: [],
    };
}

/** 题库规模概览 */
export interface BankSummary {
    total: number;
    due: number;
    byType: Partial<Record<QuestionType, number>>;
    /** 最近 30 天内新增 */
    recent: number;
}

export function summarizeBank(items: BankItem[], now = Date.now()): BankSummary {
    const byType: Partial<Record<QuestionType, number>> = {};
    for (const item of items) {
        const type = item.question.type;
        byType[type] = (byType[type] ?? 0) + 1;
    }
    return {
        total: items.length,
        due: items.filter((item) => isCardDue(item.card, now)).length,
        byType,
        recent: items.filter((item) => now - item.createdAt <= 30 * 86_400_000).length,
    };
}
