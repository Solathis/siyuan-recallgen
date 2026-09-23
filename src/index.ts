import { Plugin, showMessage, openTab, Setting, Dialog } from "siyuan";
import type { Custom } from "siyuan";
import "./index.scss";

import QuizPanel from "@/lib/ui/QuizPanel.svelte";
import HistoryPanel from "@/lib/ui/HistoryPanel.svelte";
import SettingPanel from "@/lib/ui/SettingPanel.svelte";
import { ConfigStore, ScoreStore, ProgressStore } from "@/lib/storage";
import { QuizSelector } from "@/lib/quiz/selector";
import { generateQuestions, type GenProgressCallback } from "@/lib/quiz/generator";
import { gradeAll } from "@/lib/quiz/grader";
import { buildAnalysisMessages, buildChatMessages, buildGlobalChatMessages } from "@/lib/ai/prompts";
import { callLLM, resolveAI, testConnection as aiTestConnection, type ChatMessage } from "@/lib/ai/client";
import { saveAsNewDoc, appendAnalysis } from "@/lib/quiz/docWriter";
import type { QuizService, QuizTabData } from "@/lib/quiz/service";
import { loadDateRangeNotes } from "@/lib/quiz/dateRange";
import { initI18n, setFallback, t } from "@/lib/i18n";
import enFallback from "@/../public/i18n/en.json";
import type { RecallGenConfig } from "@/types/config";
import type { GradingResult, Question, QuizSession } from "@/types/quiz";
import { getDefaultConfig } from "@/types/config";

const ICON = `<symbol id="iconRecallGen" viewBox="0 0 1024 1024"><path d="M689.810286 290.194286c-7.899429-11.666286-14.994286-21.321143-11.300572-37.266286 13.824-59.099429-2.048-110.921143-43.300571-154.587429a33.974857 33.974857 0 0 1-10.093714-28.269714 31.524571 31.524571 0 1 0-49.078858-27.428571c-10.678857 8.192-24.685714 10.605714-37.522285 6.582857a139.446857 139.446857 0 0 0-52.516572 0.658286c-13.750857 2.596571-27.172571 5.997714-40.301714-6.436572a28.16 28.16 0 0 0-35.730286-0.950857 24.502857 24.502857 0 0 0-8.813714 31.378286c5.741714 13.641143-2.56 19.382857-9.654857 27.318857A165.376 165.376 0 0 0 350.025143 248.685714a35.876571 35.876571 0 0 1-7.899429 31.707429C256.950857 389.595429 224.658286 516.242286 219.428571 652.982857c2.596571 75.885714 10.678857 151.771429 54.747429 218.587429 23.698286 35.84 43.446857 44.617143 81.846857 28.598857 21.028571-8.777143 27.501714-1.170286 38.253714 14.116571 29.696 42.532571 66.742857 73.874286 123.136 73.142857 55.332571-0.731429 90.806857-32.256 119.954286-73.691428 9.691429-13.641143 15.798857-19.419429 34.377143-12.836572 39.497143 14.006857 55.296 6.4 78.994286-29.001142a230.034286 230.034286 0 0 0 32.621714-69.010286c48.091429-185.344 13.348571-355.766857-93.549714-512.731429z m-167.314286-185.782857c59.318857 2.816 104.521143 53.833143 101.046857 116.772571-72.301714-47.177143-144.969143-48.420571-218.770286-2.779429 1.645714-70.436571 51.675429-117.284571 117.723429-114.029714z m76.873143 763.209142c-18.505143 34.304-44.726857 61.074286-84.48 66.304-27.721143 3.730286-74.020571-38.765714-86.272-72.045714a25.234286 25.234286 0 0 1 3.876571-26.989714 656.822857 656.822857 0 0 0 79.250286-144.347429c25.746286 57.344 50.541714 108.251429 86.418286 152.502857 5.924571 6.948571 6.4 17.078857 1.206857 24.576z"/></symbol>`;

const QUIZ_TAB = "quiz";
const HISTORY_TAB = "history";

export default class RecallGenPlugin extends Plugin {
    private config: RecallGenConfig = getDefaultConfig();
    private configStore!: ConfigStore;
    private scoreStore!: ScoreStore;
    private progressStore!: ProgressStore;
    private selector: QuizSelector | null = null;
    private quizComp: QuizPanel | null = null;
    private settingComp: SettingPanel | null = null;
    private historyComp: HistoryPanel | null = null;

    async onload() {
        this.addIcons(ICON);
        initI18n(this.i18n);
        setFallback(enFallback as Record<string, string>);

        this.configStore = new ConfigStore(this);
        this.scoreStore = new ScoreStore(this);
        this.progressStore = new ProgressStore(this);
        const loaded = await this.configStore.load();
        this.config = loaded ?? this.config;

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
                const div = document.createElement("div");
                div.style.height = "100%";
                (c.element as HTMLElement).appendChild(div);
                self.quizComp = new QuizPanel({
                    target: div,
                    props: {
                        service: self.buildService(),
                        tabData: c.data as QuizTabData,
                        closeTab: () => c.tab.close(),
                    },
                });
            },
            destroy: () => {
                self.quizComp?.beforeDestroy();
                self.quizComp?.$destroy();
                self.quizComp = null;
            },
        });
        this.addTab({
            type: HISTORY_TAB,
            init: function () {
                const c = this as unknown as Custom;
                const div = document.createElement("div");
                div.style.height = "100%";
                div.style.overflow = "auto";
                (c.element as HTMLElement).appendChild(div);
                self.historyComp = new HistoryPanel({
                    target: div,
                    props: {
                        service: self.buildService(),
                        onOpenReview: (rec) =>
                            self.openQuizTab({
                                mode: "review",
                                sourceDocId: rec.sourceDocId ?? "",
                                sourceTitle: rec.title,
                                reviewRecord: rec,
                            }),
                    },
                });
            },
            destroy: () => {
                self.historyComp?.$destroy();
                self.historyComp = null;
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
        this.quizComp?.$destroy();
        this.settingComp?.$destroy();
        this.historyComp?.$destroy();
        showMessage(this.i18n.byePlugin ?? t("byePlugin"));
    }

    async uninstall() {
        await this.removeData("recallgen-config.json").catch(() => {});
        await this.removeData("recallgen-scores.json").catch(() => {});
        await this.removeData("recallgen-progress.json").catch(() => {});
    }

    private openSettingsDialog() {
        const self = this;
        const dialog = new Dialog({
            title: this.displayName ?? "RecallGen",
            content: '<div class="rg-setting-root"></div>',
            width: "900px",
            height: "70vh",
            destroyCallback: () => {
                self.settingComp?.$destroy();
                self.settingComp = null;
            },
        });
        const root = dialog.element.querySelector(".rg-setting-root") as HTMLElement;
        if (!root) return;
        void this.scoreStore.list().then((scores) => {
            self.settingComp = new SettingPanel({
                target: root,
                props: {
                    config: self.config,
                    scores,
                    onTestConnection: () => aiTestConnection(self.config.ai),
                    onClearScores: async () => {
                        await self.scoreStore.clear();
                    },
                    onClearProgress: async () => {
                        await self.progressStore.clearAll();
                    },
                },
            });
            self.settingComp.$on("save", async (e: { detail: RecallGenConfig }) => {
                self.config = e.detail;
                try {
                    await self.configStore.set(self.config);
                } catch (err) {
                    // 写盘失败不能再静默吞掉：否则用户以为设置已保存
                    console.error("[RecallGen] 保存配置失败", err);
                    showMessage(t("settings.saveFailed", (err as Error).message), 7000, "error");
                }
            });
        });
    }

    private buildService(): QuizService {
        return {
            getConfig: () => this.config,
            generate: (content: string, onProgress?: GenProgressCallback) =>
                generateQuestions(this.config, content, onProgress),
            loadDateRangeContent: (cfg, range, notebookId) => loadDateRangeNotes(cfg, range, notebookId),
            grade: (qs, ans, onProgress) => gradeAll(this.config, qs, ans, onProgress),
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
            updateScore: (id, patch) => this.scoreStore.update(id, patch),
            listScores: () => this.scoreStore.list(),
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
        const messages = buildAnalysisMessages(this.config.prompts, results, questions, this.config.general.language);
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
            this.config.prompts,
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
            this.config.prompts,
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
