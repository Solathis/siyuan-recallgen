/**
 * 预览台用的假服务层。
 *
 * 实现完整的 QuizService 契约，让面板在浏览器里能真正走完
 * 出题 → 答题 → 交卷 → 判分 → 结果这条链路，而不是只渲染一个静态骨架。
 *
 * 三个可调开关是为了让「平时滚不到的分支」也能被看到：
 * - latency：把生成/判分的耗时拉长，否则「生成中」这一屏一闪而过；
 * - failGenerate：走截断类错误，用于预览失败诊断与原始返回折叠区；
 * - emptyGenerate：走「模型返回 0 题」的空态。
 */

import { AIError } from "@/lib/ai/client";
import {
    selectReviewItems,
    summarizeBank,
    toReviewQuestions,
    type BankItem,
    type BankSummary,
    type ReviewScope,
} from "@/lib/quiz/bank";
import type { DateRangeNotes } from "@/lib/quiz/dateRange";
import type { DateGenConfig, QuizService } from "@/lib/quiz/service";
import type { RecallGenConfig } from "@/types/config";
import type { GradingResult, Question, QuizSession, ScoreDetail, ScoreIndexEntry, ScoreRecord } from "@/types/quiz";
import { t } from "@/lib/i18n";

import {
    PREVIEW_DOC_ID,
    PREVIEW_DOC_TITLE,
    previewAnalysis,
    previewBankItems,
    previewChatReply,
    previewConfig,
    previewEmptySession,
    previewNotebooks,
    previewQuestions,
    previewResults,
    previewScoreIndex,
    previewScoreRecords,
    previewSession,
    previewTruncatedError,
} from "./fixtures";

export interface MockControls {
    /** 模拟网络耗时（毫秒） */
    latency: number;
    /** 出题改为抛出「输出被截断」错误 */
    failGenerate: boolean;
    /** 出题返回 0 题 */
    emptyGenerate: boolean;
    /** 连接测试失败 */
    failConnection: boolean;
    /**
     * 让 findProgressBySourceDocId 命中已保存的进度。
     * 默认关闭：真实场景里「出题」这一步多数时候没有存档，
     * 打开的话 QuizPanel 会直接恢复会话、跳过整个生成过程。
     */
    resumeProgress: boolean;
}

export interface PreviewService {
    service: QuizService;
    controls: MockControls;
    /** 设置面板保存时调用，会通知所有订阅者（验证「改设置立即生效」这类链路） */
    setConfig(next: RecallGenConfig): void;
    /** 题库与成绩回到种子数据 */
    reseed(): void;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        function onAbort() {
            clearTimeout(timer);
            reject(new AIError(t("err.aborted.title"), undefined, "aborted"));
        }
        if (signal?.aborted) {
            onAbort();
            return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export function createPreviewService(): PreviewService {
    const controls: MockControls = {
        latency: 900,
        failGenerate: false,
        emptyGenerate: false,
        failConnection: false,
        resumeProgress: false,
    };

    let config = previewConfig();
    const listeners = new Set<(config: RecallGenConfig) => void>();

    let bank: BankItem[] = previewBankItems();
    let scores: ScoreIndexEntry[] = [...previewScoreIndex];
    const scoreDetails = new Map<string, ScoreDetail>(
        previewScoreRecords.map((record) => [
            record.id,
            { id: record.id, detail: record.detail, questions: record.questions, analysis: record.analysis },
        ])
    );
    saveScoreDetails();

    function saveScoreDetails(): void {
        /* 明细表就是上面的 map，这里只是把读取顺序表达清楚 */
    }

    const service: QuizService = {
        getConfig: () => config,
        subscribeConfig(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        openDoc(docId) {
            // 真实实现会切到思源的文档 tab；预览里没有文档可跳，留个痕迹
            void docId;
        },

        /* ── 出题 ──────────────────────────────────────────────── */

        async generate(content, onProgress, signal) {
            const target = config.general.difficulty.total;
            const batches = Math.max(1, Math.ceil(target / 12));
            void content;

            await sleep(controls.latency, signal);
            if (controls.failGenerate) {
                throw new AIError(previewTruncatedError.detail, undefined, "truncated", previewTruncatedError.raw);
            }

            // 逐批推进，让「已收集 N 题 / 第 i/n 批」真的会动
            for (let batch = 1; batch <= batches; batch++) {
                const collected = Math.min(target, batch * 12);
                onProgress?.("generating", batch, t("gen.phase.generating"), {
                    phase: "generating",
                    target,
                    collected,
                    batch,
                    batches,
                    dropped: batch === 2 ? 1 : 0,
                    note: batch === 2 ? t("gen.dropped", "1") : undefined,
                });
                await sleep(controls.latency, signal);
            }

            if (config.ai.roles.reviewer) {
                onProgress?.("reviewing", 1, t("gen.phase.reviewing"), {
                    phase: "reviewing",
                    target,
                    collected: target,
                    batch: batches,
                    batches,
                    dropped: 1,
                });
                await sleep(controls.latency, signal);
            }

            if (controls.emptyGenerate) return [];
            return previewQuestions.slice(0, Math.min(target, previewQuestions.length));
        },

        async loadDateRangeContent(_cfg: DateGenConfig, _range, _notebookId): Promise<DateRangeNotes> {
            await sleep(controls.latency);
            return {
                content: previewQuestions.map((q) => q.question).join("\n\n"),
                title: t("date.title"),
                capped: false,
                skipped: 0,
                failed: 0,
            };
        },

        /* ── 判分与答疑 ────────────────────────────────────────── */

        async grade(questions, answers, onProgress, _secondsByQuestion, signal) {
            const total = questions.length;
            for (let done = 1; done <= total; done++) {
                await sleep(Math.max(60, controls.latency / 3), signal);
                onProgress(done, total);
            }
            // 只保留本次确实出到的题目，否则结果页会混进种子数据里的其它题
            const present = new Set(questions.map((q) => q.id));
            void answers;
            return previewResults.filter((result) => present.has(result.questionId));
        },

        async analyze(_results: GradingResult[], _questions: Question[]) {
            await sleep(controls.latency * 1.5);
            return previewAnalysis;
        },

        async chat(_question, _result, _analysis, _history, _userMessage) {
            await sleep(controls.latency * 1.5);
            return previewChatReply;
        },

        async chatGlobal(_questions, _results, _analysis, _history, _userMessage) {
            await sleep(controls.latency * 1.5);
            return previewChatReply;
        },

        /* ── 落盘与历史 ────────────────────────────────────────── */

        async saveResultToDoc(_session, _analysis, _results, _wrongOnly) {
            await sleep(controls.latency);
            return "20261008130000-rgsaved";
        },

        async saveProgress(_session: QuizSession) {
            await sleep(120);
        },

        async loadProgress(id) {
            await sleep(120);
            if (id === previewSession().id) return previewSession();
            if (id === previewEmptySession().id) return previewEmptySession();
            return null;
        },

        async findProgressBySourceDocId(sourceDocId) {
            await sleep(120);
            if (!controls.resumeProgress) return null;
            return sourceDocId === PREVIEW_DOC_ID ? previewSession() : null;
        },

        async clearProgress(_id) {
            await sleep(80);
        },

        async saveScore(record: ScoreRecord) {
            await sleep(controls.latency);
            const entry = previewScoreIndex[0];
            if (entry) scores = [{ ...entry, id: record.id, title: record.title }, ...scores];
        },

        async updateScoreAnalysis(id, analysis) {
            await sleep(80);
            scores = scores.map((entry) => (entry.id === id ? { ...entry, hasAnalysis: true, analysis } : entry));
        },

        async listScores() {
            await sleep(controls.latency);
            return [...scores].sort((a, b) => b.timestamp - a.timestamp);
        },

        async loadScoreDetail(id) {
            await sleep(controls.latency);
            return scoreDetails.get(id) ?? null;
        },

        async removeScore(id) {
            await sleep(120);
            scores = scores.filter((entry) => entry.id !== id);
            scoreDetails.delete(id);
        },

        async exportAllScores() {
            await sleep(200);
            return { entries: scores, details: Object.fromEntries(scoreDetails) };
        },

        async importScores(items) {
            await sleep(200);
            let added = 0;
            let skipped = 0;
            for (const item of items) {
                if (scoreDetails.has(item.entry.id)) skipped++;
                else {
                    scores = [...scores, item.entry];
                    if (item.detail) scoreDetails.set(item.entry.id, item.detail);
                    added++;
                }
            }
            return { added, skipped };
        },

        async listNotebooks() {
            await sleep(150);
            return previewNotebooks;
        },

        /* ── 题库与间隔重复 ────────────────────────────────────── */

        async dueBankQuestions(scope?: ReviewScope) {
            await sleep(controls.latency * 1.5);
            return toReviewQuestions(selectReviewItems(bank, scope ?? {}));
        },

        async bankSummary(): Promise<BankSummary> {
            await sleep(150);
            return summarizeBank(bank);
        },

        async renameBankTag(oldTag, newTag) {
            await sleep(150);
            let affected = 0;
            bank = bank.map((item) => {
                const tags = item.question.tags;
                if (!tags?.includes(oldTag)) return item;
                affected++;
                return {
                    ...item,
                    question: { ...item.question, tags: tags.map((tag) => (tag === oldTag ? newTag : tag)) },
                };
            });
            return affected;
        },

        async deleteBankTag(tag) {
            await sleep(150);
            let affected = 0;
            bank = bank.map((item) => {
                const tags = item.question.tags;
                if (!tags?.includes(tag)) return item;
                affected++;
                return { ...item, question: { ...item.question, tags: tags.filter((next) => next !== tag) } };
            });
            return affected;
        },

        async listBank() {
            await sleep(controls.latency);
            return [...bank];
        },

        async exportBank() {
            await sleep(200);
            return [...bank];
        },

        async importBank(items) {
            await sleep(200);
            const existing = new Set(bank.map((item) => item.id));
            const fresh = items.filter((item) => !existing.has(item.id));
            bank = [...bank, ...fresh];
            return { added: fresh.length, skipped: items.length - fresh.length };
        },

        async removeBankItem(id) {
            await sleep(120);
            bank = bank.filter((item) => item.id !== id);
        },

        async recordBankOutcomes(questions, source, results) {
            await sleep(120);
            const existing = new Set(bank.map((item) => item.id));
            let added = 0;
            let reused = 0;
            for (const question of questions) {
                void source;
                void results;
                if (existing.has(questionFingerprintOf(question))) reused++;
                else added++;
            }
            return { added, reused };
        },

        async clearBank() {
            await sleep(200);
            bank = [];
        },

        async testConnection() {
            await sleep(controls.latency * 1.5);
            if (controls.failConnection) {
                throw new AIError("401 Unauthorized", 401, "http");
            }
            // 不引 i18n：这里的返回值只是给预览看的模拟结果，
            // 引一个不存在的 key 会被字典体检用例拦下
            return "连接正常 · 240ms";
        },

        async clearScores() {
            await sleep(200);
            scores = [];
            scoreDetails.clear();
        },

        async clearAllProgress() {
            await sleep(200);
        },
    };

    return {
        service,
        controls,
        setConfig(next) {
            config = next;
            for (const listener of listeners) listener(next);
        },
        reseed() {
            bank = previewBankItems();
            scores = [...previewScoreIndex];
            scoreDetails.clear();
            for (const record of previewScoreRecords) {
                scoreDetails.set(record.id, {
                    id: record.id,
                    detail: record.detail,
                    questions: record.questions,
                    analysis: record.analysis,
                });
            }
        },
    };
}

/** 与 bank.ts 同一套指纹算法；这里只用于统计新增/复用条数 */
function questionFingerprintOf(question: Question): string {
    return `${question.type}:${question.question.trim()}`;
}

/** 供预览台对照：种子会话里的题目数与判分结果数 */
export const PREVIEW_SHAPE = {
    sourceTitle: PREVIEW_DOC_TITLE,
    questions: previewQuestions.length,
    results: previewResults.length,
};
