import { mount, unmount, type Component } from "svelte";
import { Plugin, showMessage, openTab, Setting, Dialog } from "siyuan";
import type { Custom } from "siyuan";
import "./app.css";

import QuizPanel from "@/lib/ui/QuizPanel.svelte";
import HistoryPanel from "@/lib/ui/HistoryPanel.svelte";
import SettingPanel from "@/lib/ui/SettingPanel.svelte";
import { lsNotebooks } from "@/api";
import { BankStore, ConfigStore, ScoreStore, ProgressStore } from "@/lib/storage";
import {
    applyResult,
    createBankItem,
    questionFingerprint,
    selectReviewItems,
    toReviewQuestions,
} from "@/lib/quiz/bank";
import { QuizSelector } from "@/lib/quiz/selector";
import { generateQuestions, type GenProgressCallback } from "@/lib/quiz/generator";
import { gradeAll } from "@/lib/quiz/grader";
import { activePrompts, buildAnalysisMessages, buildChatMessages, buildGlobalChatMessages } from "@/lib/ai/prompts";
import { callLLM, resolveAI, testConnection as aiTestConnection, type ChatMessage } from "@/lib/ai/client";
import { saveAsNewDoc, appendAnalysis } from "@/lib/quiz/docWriter";
import type { QuizService, QuizTabData } from "@/lib/quiz/service";
import { loadDateRangeNotes } from "@/lib/quiz/dateRange";
import { initI18n, localeText, setFallback, t } from "@/lib/i18n";
import enFallback from "@/../public/i18n/en.json";
import type { RecallGenConfig } from "@/types/config";
import type { GradingResult, Question, QuestionType, QuizSession, ScoreIndexEntry } from "@/types/quiz";
import { getDefaultConfig } from "@/types/config";

const ICON = `<symbol id="iconRecallGen" viewBox="0 0 1024 1024"><path d="M689.810286 290.194286c-7.899429-11.666286-14.994286-21.321143-11.300572-37.266286 13.824-59.099429-2.048-110.921143-43.300571-154.587429a33.974857 33.974857 0 0 1-10.093714-28.269714 31.524571 31.524571 0 1 0-49.078858-27.428571c-10.678857 8.192-24.685714 10.605714-37.522285 6.582857a139.446857 139.446857 0 0 0-52.516572 0.658286c-13.750857 2.596571-27.172571 5.997714-40.301714-6.436572a28.16 28.16 0 0 0-35.730286-0.950857 24.502857 24.502857 0 0 0-8.813714 31.378286c5.741714 13.641143-2.56 19.382857-9.654857 27.318857A165.376 165.376 0 0 0 350.025143 248.685714a35.876571 35.876571 0 0 1-7.899429 31.707429C256.950857 389.595429 224.658286 516.242286 219.428571 652.982857c2.596571 75.885714 10.678857 151.771429 54.747429 218.587429 23.698286 35.84 43.446857 44.617143 81.846857 28.598857 21.028571-8.777143 27.501714-1.170286 38.253714 14.116571 29.696 42.532571 66.742857 73.874286 123.136 73.142857 55.332571-0.731429 90.806857-32.256 119.954286-73.691428 9.691429-13.641143 15.798857-19.419429 34.377143-12.836572 39.497143 14.006857 55.296 6.4 78.994286-29.001142a230.034286 230.034286 0 0 0 32.621714-69.010286c48.091429-185.344 13.348571-355.766857-93.549714-512.731429z m-167.314286-185.782857c59.318857 2.816 104.521143 53.833143 101.046857 116.772571-72.301714-47.177143-144.969143-48.420571-218.770286-2.779429 1.645714-70.436571 51.675429-117.284571 117.723429-114.029714z m76.873143 763.209142c-18.505143 34.304-44.726857 61.074286-84.48 66.304-27.721143 3.730286-74.020571-38.765714-86.272-72.045714a25.234286 25.234286 0 0 1 3.876571-26.989714 656.822857 656.822857 0 0 0 79.250286-144.347429c25.746286 57.344 50.541714 108.251429 86.418286 152.502857 5.924571 6.948571 6.4 17.078857 1.206857 24.576z"/></symbol>`;

const QUIZ_TAB = "quiz";
const HISTORY_TAB = "history";

export default class RecallGenPlugin extends Plugin {
    private config: RecallGenConfig = getDefaultConfig();
    private configStore!: ConfigStore;
    private scoreStore!: ScoreStore;
    private progressStore!: ProgressStore;
    private bankStore!: BankStore;
    private selector: QuizSelector | null = null;
    /** 配置变化订阅者（答题面板等），保存配置后统一通知 */
    private readonly configListeners = new Set<(config: RecallGenConfig) => void>();
    /**
     * 当前已挂载的组件，按宿主元素索引。
     * mount() 返回的是组件的导出成员（含 beforeDestroy 等），不是组件实例。
     * 同一类型的 tab / 对话框可以同时打开多个，所以必须逐个记录，
     * 否则后开的会覆盖引用，先关的那个既不会 unmount 也不会清理自己的监听。
     */
    private readonly mounted = new Map<HTMLElement, Record<string, unknown>>();

    async onload() {
        this.addIcons(ICON);
        initI18n(this.i18n);
        setFallback(enFallback as Record<string, string>);

        this.configStore = new ConfigStore(this);
        this.scoreStore = new ScoreStore(this);
        this.progressStore = new ProgressStore(this);
        this.bankStore = new BankStore(this);
        const loaded = await this.configStore.load();
        this.config = loaded ?? this.config;

        // 首次启动时把 v1 单一成绩文件迁移为「索引 + 按月分片」
        void this.scoreStore
            .migrateIfNeeded()
            .then(({ migrated }) => {
                if (migrated > 0) console.info(`[RecallGen] 已迁移 ${migrated} 条成绩记录到新存储结构`);
            })
            .catch((e) => console.warn("[RecallGen] 成绩存储迁移失败", e));

        // 按保留策略裁剪题库：只删除「长期未考且已掌握」的题目
        void this.bankStore
            .prune()
            .then((removed) => {
                if (removed > 0) console.info(`[RecallGen] 题库已清理 ${removed} 道已掌握且长期未考的题目`);
            })
            .catch((e) => console.warn("[RecallGen] 题库清理失败", e));

        // 间隔重复的提醒：有到期题目时在启动后提示一次，否则用户不会知道该复习了
        void this.bankStore
            .summary()
            .then((summary) => {
                if (summary.due > 0) showMessage(t("bank.dueNotice", String(summary.due)), 8000);
            })
            .catch((e) => console.warn("[RecallGen] 读取题库概览失败", e));

        // 清理长期未交卷的废弃进度，避免进度文件无限增长
        void this.progressStore
            .pruneExpired()
            .then((removed) => {
                if (removed > 0) console.info(`[RecallGen] 已清理 ${removed} 条过期答题进度`);
            })
            .catch((e) => console.warn("[RecallGen] 清理过期进度失败", e));

        const self = this;
        this.addTab({
            type: QUIZ_TAB,
            init: function () {
                const c = this as unknown as Custom;
                const host = c.element as HTMLElement;
                const div = document.createElement("div");
                div.style.height = "100%";
                // rg-scope 是插件样式的作用域根：收窄版 preflight 与 KaTeX 的
                // 公式样式都挂在它下面，漏掉它会让面板里的排版重置与公式样式全部失效
                div.className = "rg-scope";
                host.appendChild(div);
                self.mounted.set(
                    host,
                    mount(QuizPanel as Component, {
                        target: div,
                        props: {
                            service: self.buildService(),
                            tabData: c.data as QuizTabData,
                            closeTab: () => c.tab.close(),
                        },
                    }) as Record<string, unknown>
                );
            },
            destroy: function () {
                self.destroyMounted((this as unknown as Custom).element as HTMLElement);
            },
        });
        this.addTab({
            type: HISTORY_TAB,
            init: function () {
                const c = this as unknown as Custom;
                const host = c.element as HTMLElement;
                const div = document.createElement("div");
                div.style.height = "100%";
                div.style.overflow = "auto";
                div.className = "rg-scope";
                host.appendChild(div);
                self.mounted.set(
                    host,
                    mount(HistoryPanel as Component, {
                        target: div,
                        props: {
                            service: self.buildService(),
                            onOpenReview: (entry: ScoreIndexEntry) => void self.openReviewTab(entry),
                            onStartReview: (scope: { tag?: string; type?: QuestionType }) =>
                                self.openQuizTab({
                                    mode: "reviewDue",
                                    sourceDocId: "",
                                    sourceTitle:
                                        scope.tag ?? (scope.type ? t(`type.${scope.type}`) : t("bank.reviewDue")),
                                    dueTag: scope.tag,
                                    dueType: scope.type,
                                }),
                        },
                    }) as Record<string, unknown>
                );
            },
            destroy: function () {
                self.destroyMounted((this as unknown as Custom).element as HTMLElement);
            },
        });
        // 仅创建 Setting 实例以在插件列表显示齿轮图标，不使用 addItem 避免被 fn__flex-center/fn__size200 限制宽度
        this.setting = new Setting({});
        this.openSetting = () => this.openSettingsDialog();

        this.selector = new QuizSelector(this, (tabData) => this.openQuizTab(tabData));
        this.selector.register();

        this.addTopBar({
            icon: "iconRecallGen",
            title: t("tab.history"),
            position: "right",
            callback: () => this.openHistoryTab(),
        });
    }

    async onunload() {
        this.selector?.unregister();
        // 先把合并窗口内待写的配置落盘，避免刚改完设置就退出导致丢失
        await this.configStore.flushDeferred().catch((e) => console.warn("[RecallGen] 配置落盘失败", e));
        // 各面板的 beforeDestroy 会做最后一次进度保存，因此先卸载组件再冲刷
        for (const host of [...this.mounted.keys()]) this.destroyMounted(host);
        await Promise.all([
            this.scoreStore.flush().catch((e) => console.warn("[RecallGen] 成绩落盘失败", e)),
            this.progressStore.flush().catch((e) => console.warn("[RecallGen] 答题进度落盘失败", e)),
            this.bankStore.flush().catch((e) => console.warn("[RecallGen] 题库落盘失败", e)),
        ]);
        showMessage(localeText(this.i18n, "byePlugin", t("byePlugin")));
    }

    /** 卸载并登记注销：先跑组件自己的 beforeDestroy，再交给 Svelte 卸载 */
    private destroyMounted(host: HTMLElement): void {
        const comp = this.mounted.get(host);
        if (!comp) return;
        this.mounted.delete(host);
        (comp as { beforeDestroy?: () => void }).beforeDestroy?.();
        unmount(comp);
    }

    async uninstall() {
        await this.removeData("recallgen-config.json").catch(() => {});
        await this.removeData("recallgen-progress.json").catch(() => {});
        // 成绩已拆为索引 + 按月分片，交给 ScoreStore 统一枚举删除
        await this.scoreStore.purgeAll().catch(() => undefined);
        await this.bankStore.purgeAll().catch(() => undefined);
    }

    /** 打开历史成绩回看：按需加载明细后再开 Tab */
    private async openReviewTab(entry: ScoreIndexEntry): Promise<void> {
        try {
            const detail = await this.scoreStore.loadDetail(entry.id);
            if (!detail) {
                showMessage(t("history.detailMissing"), 7000, "error");
                return;
            }
            this.openQuizTab({
                mode: "review",
                sourceDocId: entry.sourceDocId ?? "",
                sourceTitle: entry.title,
                review: { entry, detail },
            });
        } catch (e) {
            console.error("[RecallGen] 加载成绩明细失败", e);
            showMessage(t("history.detailLoadFailed", (e as Error).message), 7000, "error");
        }
    }

    private openSettingsDialog() {
        const self = this;
        const dialog = new Dialog({
            title: this.displayName ?? "RecallGen",
            content: '<div class="rg-scope flex h-full min-h-[400px] flex-col"></div>',
            width: "900px",
            height: "70vh",
            destroyCallback: () => closeSetting(),
        });
        const host = dialog.element as HTMLElement;
        const root = dialog.element.querySelector(".rg-scope") as HTMLElement;
        if (!root) return;
        const closeSetting = () => self.destroyMounted(host);
        void this.scoreStore.listIndex().then((scores) => {
            // 对话框可能在成绩加载期间就被关闭
            if (!dialog.element.isConnected) return;
            self.mounted.set(
                host,
                mount(SettingPanel as Component, {
                    target: root,
                    props: {
                        config: self.config,
                        service: self.buildService(),
                        scores,
                        onTestConnection: () => aiTestConnection(self.config.ai),
                        onClearScores: async () => {
                            await self.scoreStore.clear();
                        },
                        onClearProgress: async () => {
                            await self.progressStore.clearAll();
                        },
                        onExportBank: () => this.bankStore.list(),
                        onImportBank: (items) => this.bankStore.importItems(items),
                        onClearBank: async () => {
                            await self.bankStore.clear();
                        },
                        onExportScores: () => self.scoreStore.exportAll(),
                        onImportScores: async (items) => {
                            const before = (await self.scoreStore.listIndex()).length;
                            await self.scoreStore.importMany(items);
                            const after = (await self.scoreStore.listIndex()).length;
                            return { added: after - before, skipped: items.length - (after - before) };
                        },
                        onImportConfig: async (next, result) => {
                            // 导入的配置立即生效并落盘；warnings 由设置面板逐条提示
                            self.config = next;
                            for (const listener of self.configListeners) listener(next);
                            try {
                                await self.configStore.set(next, { immediate: true });
                            } catch (err) {
                                console.error("[RecallGen] 导入配置落盘失败", err);
                                showMessage(t("settings.saveFailed", (err as Error).message), 7000, "error");
                            }
                            console.info("[RecallGen] 配置导入完成", result.warnings);
                        },
                        onSave: async (next: RecallGenConfig) => {
                            self.config = next;
                            for (const listener of self.configListeners) listener(next);
                            try {
                                await self.configStore.set(self.config);
                            } catch (err) {
                                // 写盘失败不能再静默吞掉：否则用户以为设置已保存
                                console.error("[RecallGen] 保存配置失败", err);
                                showMessage(t("settings.saveFailed", (err as Error).message), 7000, "error");
                            }
                        },
                    },
                }) as Record<string, unknown>
            );
        });
    }

    private buildService(): QuizService {
        return {
            getConfig: () => this.config,
            subscribeConfig: (listener) => {
                this.configListeners.add(listener);
                return () => this.configListeners.delete(listener);
            },
            generate: (content: string, onProgress?: GenProgressCallback, signal?: AbortSignal) =>
                generateQuestions(this.config, content, onProgress, signal),
            loadDateRangeContent: (cfg, range, notebookId) => loadDateRangeNotes(cfg, range, notebookId),
            grade: (qs, ans, onProgress, seconds, signal) =>
                gradeAll(this.config, qs, ans, onProgress, seconds, signal),
            analyze: (results, questions) => this.analyze(results, questions),
            chat: (question, result, analysis, history, userMessage) =>
                this.chat(question, result, analysis, history, userMessage),
            chatGlobal: (questions, results, analysis, history, userMessage) =>
                this.chatGlobal(questions, results, analysis, history, userMessage),
            saveResultToDoc: (session, analysis, results, wrongOnly) =>
                this.saveResultToDoc(session, analysis, results, wrongOnly),
            saveProgress: (session) => this.progressStore.save(session),
            loadProgress: (id) => this.progressStore.load(id),
            findProgressBySourceDocId: (sourceDocId) => this.progressStore.findBySourceDocId(sourceDocId),
            clearProgress: (id) => this.progressStore.clear(id),
            saveScore: (record) => this.scoreStore.add(record),
            updateScoreAnalysis: (id, analysis) => this.scoreStore.updateAnalysis(id, analysis),
            listScores: () => this.scoreStore.listIndex(),
            loadScoreDetail: (id) => this.scoreStore.loadDetail(id),
            removeScore: (id) => this.scoreStore.remove(id),
            exportAllScores: () => this.scoreStore.exportAll(),
            importScores: async (items) => {
                const before = await this.scoreStore.listIndex();
                await this.scoreStore.importMany(items);
                const after = await this.scoreStore.listIndex();
                return { added: after.length - before.length, skipped: items.length - (after.length - before.length) };
            },
            dueBankQuestions: async (scope = {}) => {
                const items = await this.bankStore.list();
                return toReviewQuestions(selectReviewItems(items, scope));
            },
            bankSummary: () => this.bankStore.summary(),
            listBank: () => this.bankStore.list(),
            exportBank: () => this.bankStore.list(),
            importBank: (items) => this.bankStore.importItems(items),
            removeBankItem: (id) => this.bankStore.remove(id),
            recordBankOutcomes: async (questions, source, results) => {
                const scoreById = new Map(results.map((r) => [r.questionId, r.score]));
                const existing = await this.bankStore.findMany(questions.map((q) => questionFingerprint(q)));
                const toWrite = questions.map((question) => {
                    const fingerprint = questionFingerprint(question);
                    const percent = scoreById.get(question.id) ?? 0;
                    const item = existing.get(fingerprint) ?? createBankItem(question, source);
                    return applyResult(item, percent);
                });
                const reused = toWrite.filter((item) => item.timesSeen > 1).length;
                await this.bankStore.upsertMany(toWrite);
                return { added: toWrite.length - reused, reused };
            },
            clearBank: () => this.bankStore.clear(),
            listNotebooks: async () => {
                const res = await lsNotebooks().catch(() => null);
                return (res?.notebooks ?? []).filter((n) => !n.closed).map((n) => ({ id: n.id, name: n.name }));
            },
            testConnection: () => aiTestConnection(this.config.ai),
            clearScores: () => this.scoreStore.clear(),
            clearAllProgress: () => this.progressStore.clearAll(),
        };
    }

    openQuizTab(tabData: QuizTabData) {
        openTab({
            app: (this as unknown as { app: import("siyuan").App }).app,
            custom: {
                id: this.name + QUIZ_TAB,
                icon: "iconRecallGen",
                title: tabData.sourceTitle ? t("tab.quiz", tabData.sourceTitle) : t("tab.quizDefault"),
                data: tabData,
            },
        });
    }

    openHistoryTab() {
        openTab({
            app: (this as unknown as { app: import("siyuan").App }).app,
            custom: {
                id: this.name + HISTORY_TAB,
                icon: "iconRecallGen",
                title: t("tab.history"),
            },
        });
    }

    private async analyze(results: GradingResult[], questions: Question[]): Promise<string> {
        const prompts = activePrompts(this.config.prompts, this.config.general.language);
        const messages = buildAnalysisMessages(prompts, results, questions, this.config.general.language);
        const rc = resolveAI(this.config.ai, this.config.ai.roles.grader);
        const res = await callLLM(rc, messages as ChatMessage[], {
            temperature: 0.5,
            maxTokens: 512,
        });
        return res.content;
    }

    private async saveResultToDoc(
        session: QuizSession,
        analysis: string,
        results: GradingResult[],
        wrongOnly?: boolean
    ): Promise<string> {
        // 按 questionId 对齐而不是按下标，避免题序不一致时筛错题目
        const scoreById = new Map(results.map((r) => [r.questionId, r.score]));
        const questions = wrongOnly
            ? session.questions.filter((q) => (scoreById.get(q.id) ?? 100) < 60)
            : session.questions;
        if (questions.length === 0) {
            showMessage(t("quiz.noWrongToSave"));
            return "";
        }
        const docId = await saveAsNewDoc(this.config.general, questions, session.sourceDocId, session.sourceTitle);
        await appendAnalysis(docId, analysis);
        return docId;
    }

    private async chat(
        question: Question,
        result: GradingResult,
        analysis: string,
        history: Array<{ role: "user" | "assistant"; content: string }>,
        userMessage: string
    ): Promise<string> {
        const messages = buildChatMessages(
            activePrompts(this.config.prompts, this.config.general.language),
            question,
            result,
            analysis,
            history,
            userMessage,
            this.config.general.language
        );
        const rc = resolveAI(this.config.ai, this.config.ai.roles.grader);
        const res = await callLLM(rc, messages as ChatMessage[], {
            temperature: 0.6,
            maxTokens: 1024,
        });
        return res.content;
    }

    private async chatGlobal(
        questions: Question[],
        results: GradingResult[],
        analysis: string,
        history: Array<{ role: "user" | "assistant"; content: string }>,
        userMessage: string
    ): Promise<string> {
        const messages = buildGlobalChatMessages(
            activePrompts(this.config.prompts, this.config.general.language),
            questions,
            results,
            analysis,
            history,
            userMessage,
            this.config.general.language
        );
        const rc = resolveAI(this.config.ai, this.config.ai.roles.grader);
        const res = await callLLM(rc, messages as ChatMessage[], {
            temperature: 0.6,
            maxTokens: 1024,
        });
        return res.content;
    }
}
