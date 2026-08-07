import { Plugin, showMessage, getFrontend, openTab, Setting, Dialog } from "siyuan";
import type { Custom } from "siyuan";
import "./index.scss";

import QuizPanel from "@/lib/ui/QuizPanel.svelte";
import SettingPanel from "@/lib/ui/SettingPanel.svelte";
import { ConfigStore, ScoreStore, ProgressStore } from "@/lib/storage";
import { QuizSelector } from "@/lib/quiz/selector";
import { generateQuestions } from "@/lib/quiz/generator";
import { gradeAll } from "@/lib/quiz/grader";
import { buildAnalysisMessages, buildChatMessages } from "@/lib/ai/prompts";
import { callLLM, testConnection as aiTestConnection, type ChatMessage } from "@/lib/ai/client";
import { saveAsNewDoc, appendAnalysis } from "@/lib/quiz/docWriter";
import type { QuizService, QuizTabData } from "@/lib/quiz/service";
import type { RecallGenConfig } from "@/types/config";
import type { GradingResult, Question, QuizSession } from "@/types/quiz";
import { getDefaultConfig } from "@/types/config";
import { LOGO_DATA_URI } from "@/lib/logo-data";

const ICON = `<symbol id="iconRecallGen" viewBox="0 0 128 128"><image href="${LOGO_DATA_URI}" width="128" height="128"/></symbol>`;

const QUIZ_TAB = "quiz";

export default class RecallGenPlugin extends Plugin {
    isMobile = false;
    private config: RecallGenConfig = getDefaultConfig();
    private configStore!: ConfigStore;
    private scoreStore!: ScoreStore;
    private progressStore!: ProgressStore;
    private selector: QuizSelector | null = null;
    private quizComp: QuizPanel | null = null;
    private settingComp: SettingPanel | null = null;

    async onload() {
        const frontEnd = getFrontend();
        this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";
        this.addIcons(ICON);

        this.configStore = new ConfigStore(this);
        this.scoreStore = new ScoreStore(this);
        this.progressStore = new ProgressStore(this);
        const loaded = await this.configStore.load();
        this.config = loaded ?? this.config;

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
        // 仅创建 Setting 实例以在插件列表显示齿轮图标，不使用 addItem 避免被 fn__flex-center/fn__size200 限制宽度
        this.setting = new Setting({});
        this.openSetting = () => this.openSettingsDialog();

        this.selector = new QuizSelector(this, (tabData) => this.openQuizTab(tabData));
        this.selector.register();
    }

    async onunload() {
        this.selector?.unregister();
        this.quizComp?.$destroy();
        this.settingComp?.$destroy();
        showMessage(this.i18n.byePlugin ?? "Bye, RecallGen");
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
                    onClearScores: async () => { await self.scoreStore.clear(); },
                    onClearProgress: async () => { await self.progressStore.clearAll(); },
                },
            });
            self.settingComp.$on("save", async (e: { detail: RecallGenConfig }) => {
                self.config = e.detail;
                await self.configStore.set(self.config);
            });
        });
    }

    private buildService(): QuizService {
        return {
            getConfig: () => this.config,
            generate: (content: string) => generateQuestions(this.config, content),
            grade: (qs, ans, onProgress) => gradeAll(this.config, qs, ans, onProgress),
            analyze: (results, questions) => this.analyze(results, questions),
            chat: (question, result, analysis, history, userMessage) => this.chat(question, result, analysis, history, userMessage),
            saveResultToDoc: (session, analysis) => this.saveResultToDoc(session, analysis),
            saveProgress: (session) => this.progressStore.save(session),
            loadProgress: (id) => this.progressStore.load(id),
            findProgressBySourceDocId: (sourceDocId) => this.progressStore.findBySourceDocId(sourceDocId),
            clearProgress: (id) => this.progressStore.clear(id),
            saveScore: (record) => this.scoreStore.add(record),
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
                title: tabData.sourceTitle ? `复习题 · ${tabData.sourceTitle}` : "复习题",
                data: tabData,
            },
        });
    }

    private async analyze(results: GradingResult[], questions: Question[]): Promise<string> {
        const messages = buildAnalysisMessages(this.config.prompts, results, questions);
        const res = await callLLM(this.config.ai, messages as ChatMessage[], {
            temperature: 0.5,
            maxTokens: 512,
        });
        return res.content;
    }

    private async saveResultToDoc(session: QuizSession, analysis: string): Promise<string> {
        const docId = await saveAsNewDoc(this.config.general, session.questions, session.sourceDocId, session.sourceTitle);
        await appendAnalysis(docId, analysis);
        return docId;
    }

    private async chat(
        question: Question,
        result: GradingResult,
        analysis: string,
        history: Array<{ role: "user" | "assistant"; content: string }>,
        userMessage: string,
    ): Promise<string> {
        const messages = buildChatMessages(this.config.prompts, question, result, analysis, history, userMessage);
        const res = await callLLM(this.config.ai, messages as ChatMessage[], {
            temperature: 0.6,
            maxTokens: 1024,
        });
        return res.content;
    }
}
