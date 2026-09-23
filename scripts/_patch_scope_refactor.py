import io

# ── bank.ts：selectReviewItems 支持「没有到期题目时按掌握度补题」 ─────
p = 'src/lib/quiz/bank.ts'
s = io.open(p, encoding='utf-8').read()
o = s

OLD = '''/**
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
}'''

NEW = '''/** 复习选题的范围限定 */
export interface ReviewScope {
    now?: number;
    /** 0 表示不限题数 */
    limit?: number;
    tag?: string;
    sourceDocId?: string;
    /**
     * 没有到期题目时是否按掌握度从低到高补题（提前复习）。
     * 用于「复习某个知识点」：用户想练这个点，而不是想被排程挡住；
     * 提前作答 FSRS 本身能够正确处理，只是不会像到期复习那样拉长间隔。
     */
    ahead?: boolean;
}

/**
 * 复习选题：先按来源文档与知识点标签限定范围，再取到期题目（到期时间升序）。
 * 抽成纯函数便于单测，也让 index.ts 的实现保持一行。
 */
export function selectReviewItems(items: BankItem[], scope: ReviewScope = {}): BankItem[] {
    const { now = Date.now(), limit = 0, tag, sourceDocId, ahead = false } = scope;
    const scoped = items.filter((item) => {
        if (sourceDocId && item.sourceDocId !== sourceDocId) return false;
        if (tag && !(item.question.tags ?? []).includes(tag)) return false;
        return true;
    });

    const due = pickDueItems(scoped, now, limit);
    if (due.length > 0 || !ahead) return due;
    const weakest = [...scoped].sort(
        (a, b) => masteryScore(a) - masteryScore(b) || a.card.due - b.card.due
    );
    return limit > 0 ? weakest.slice(0, limit) : weakest;
}'''
assert s.count(OLD) == 1
s = s.replace(OLD, NEW, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('bank.ts:', s != o)

# ── service.ts：dueBankQuestions 改为 scope 对象 ────────────────────
p = 'src/lib/quiz/service.ts'
s = io.open(p, encoding='utf-8').read()
o = s
OLD = '''    dueBankQuestions(limit?: number, sourceDocId?: string, tag?: string): Promise<Question[]>;'''
NEW = '''    dueBankQuestions(scope?: import("./bank").ReviewScope): Promise<Question[]>;'''
assert s.count(OLD) == 1
s = s.replace(OLD, NEW, 1)
OLD = '''    /**
     * 按 FSRS 排程取出到期的题目，用于「复习到期题目」。
     * 传入 sourceDocId 时只取来自该文档的题目，便于「只复习这篇笔记」。
     */'''
NEW = '''    /**
     * 按 FSRS 排程取出到期的题目，用于「复习到期题目」。
     * 传入 sourceDocId 时只取来自该文档的题目（「只复习这篇笔记」），
     * 传入 tag 时只取该知识点的题目；ahead 允许在没有到期题目时按掌握度补题。
     */'''
assert s.count(OLD) == 1
s = s.replace(OLD, NEW, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('service.ts:', s != o)

# ── index.ts：实现改用 scope ────────────────────────────────────────
p = 'src/index.ts'
s = io.open(p, encoding='utf-8').read()
o = s
OLD = '''            dueBankQuestions: async (limit = 0, sourceDocId, tag) => {
                const items = await this.bankStore.list();
                return selectReviewItems(items, { limit, sourceDocId, tag }).map((item) => item.question);
            },'''
NEW = '''            dueBankQuestions: async (scope = {}) => {
                const items = await this.bankStore.list();
                return selectReviewItems(items, scope).map((item) => item.question);
            },'''
assert s.count(OLD) == 1
s = s.replace(OLD, NEW, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('index.ts:', s != o)

# ── QuizPanel：构造 scope，并区分「无到期」与「题库没有该知识点」 ────
p = 'src/lib/ui/QuizPanel.svelte'
s = io.open(p, encoding='utf-8').read()
o = s
OLD = '''            const due = await service.dueBankQuestions(0, tabData.dueSourceDocId);
            if (cancelled) return;
            if (due.length === 0) {
                error = {
                    title: t("bank.noDueTitle"),
                    hint: tabData.dueTag ? t("bank.noDueTagHint", tabData.dueTag) : t("bank.noDueHint"),
                    detail: t("bank.noDueDetail"),
                };
                panelState = "answering";
                return;
            }'''
NEW = '''            // 按知识点复习时允许提前复习：用户是想练这个点，不该被排程挡住
            const due = await service.dueBankQuestions({
                limit: 0,
                sourceDocId: tabData.dueSourceDocId,
                tag: tabData.dueTag,
                ahead: Boolean(tabData.dueTag),
            });
            if (cancelled) return;
            if (due.length === 0) {
                const tag = tabData.dueTag;
                error = {
                    title: t("bank.noDueTitle"),
                    hint: tag
                        ? due.length === 0 && (await service.bankHasTag(tag))
                            ? t("bank.noDueTagHint", tag)
                            : t("bank.noTagQuestions", tag)
                        : t("bank.noDueHint"),
                    detail: t("bank.noDueDetail"),
                };
                panelState = "answering";
                return;
            }'''
assert s.count(OLD) == 1, 'quizpanel due'
s = s.replace(OLD, NEW, 1)
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('QuizPanel:', s != o)
