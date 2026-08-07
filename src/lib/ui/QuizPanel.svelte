<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import ProgressBar from "./ProgressBar.svelte";
    import QuestionView from "./QuestionView.svelte";
    import ResultPanel from "./ResultPanel.svelte";
    import { showMessage } from "siyuan";
    import { button, badge, alert, alertTitle, alertDescription, cn } from "./components";
    import type { QuizService, QuizTabData } from "../quiz/service";
    import type { GradingResult, PanelState, Question, QuizSession, UserAnswer } from "@/types/quiz";

    export let service: QuizService;
    export let tabData: QuizTabData;

    let panelState: PanelState = "loading_generating";
    let session: QuizSession | null = null;
    let error: string | null = null;
    let results: GradingResult[] | null = null;
    let analysis: string | null = null;
    let progressValue: number | null = null;
    let progressLabel = "";
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    const config = service.getConfig();
    $: countdownEnabled = config.general.countdownEnabled && config.general.countdownMinutes > 0;
    $: countdownSec = config.general.countdownMinutes * 60;
    let countdownLeft = 0;

    $: questions = session?.questions ?? [];

    onMount(async () => {
        if (tabData.mode === "resume" && tabData.quizId) {
            await resume();
        } else if (tabData.mode === "generate") {
            await startGenerate();
        } else {
            error = "无效的 Tab 数据";
            panelState = "answering";
        }
    });

    onDestroy(() => {
        if (saveTimer) clearTimeout(saveTimer);
        if (countdownTimer) clearInterval(countdownTimer);
    });

    /** 检查 AI 配置是否有效 */
    function checkAiConfig(): boolean {
        const ai = config.ai;
        if (!ai.model) {
            error = "未配置 AI 模型，请先在设置中填写模型名称";
            return false;
        }
        if (ai.provider !== "ollama" && !ai.apiKey) {
            error = "未配置 API Key，请先在设置中填写";
            return false;
        }
        return true;
    }

    async function startGenerate() {
        error = null;
        if (!checkAiConfig()) {
            panelState = "answering";
            return;
        }
        panelState = "loading_generating";
        progressValue = null;
        progressLabel = "AI 正在生成题目…";
        try {
            const qs = await service.generate(tabData.content ?? "");
            if (qs.length === 0) {
                error = "AI 未生成任何题目，请检查内容或重试";
                panelState = "answering";
                return;
            }
            const id = genId();
            session = { id, sourceDocId: tabData.sourceDocId, sourceTitle: tabData.sourceTitle, questions: qs, createdAt: Date.now(), answers: {} };
            const prev = await service.loadProgress(id);
            if (prev) session.answers = prev.answers;
            panelState = "answering";
            if (countdownEnabled) { countdownLeft = countdownSec; startCountdown(); }
        } catch (e) {
            error = (e as Error).message;
            panelState = "answering";
        }
    }

    async function resume() {
        const prev = await service.loadProgress(tabData.quizId ?? "");
        if (!prev) { error = "未找到可恢复的进度"; panelState = "answering"; return; }
        session = prev;
        panelState = "answering";
        if (countdownEnabled) { countdownLeft = countdownSec; startCountdown(); }
    }

    function onAnswer(qid: string, a: UserAnswer) {
        if (!session) return;
        session.answers[qid] = a;
        scheduleSave();
    }
    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { if (session) void service.saveProgress(session); }, 800);
    }
    function isAnswered(q: Question): boolean { return !!session?.answers[q.id]; }
    $: answeredCount = questions.filter(isAnswered).length;

    async function submit() {
        if (!session) return;
        panelState = "loading_grading";
        progressValue = 0;
        progressLabel = "正在判分…";
        try {
            results = await service.grade(session.questions, session.answers, (done, total) => {
                progressValue = total ? (done / total) * 100 : null;
                progressLabel = `判分中 ${done}/${total}`;
            });
            progressLabel = "正在生成薄弱点分析…";
            progressValue = null;
            analysis = await service.analyze(results, session.questions);
            const totalScore = results.reduce((s, r) => s + r.score, 0);
            const maxScore = results.reduce((s, r) => s + r.maxScore, 0);
            await service.saveScore({ id: genId(), quizId: session.id, title: session.sourceTitle, timestamp: Date.now(), totalScore, maxScore, questionCount: session.questions.length, detail: results });
            await service.clearProgress(session.id);
            panelState = "result";
        } catch (e) {
            error = (e as Error).message;
            panelState = "result";
        }
    }

    let countdownTimer: ReturnType<typeof setInterval> | null = null;
    function startCountdown() {
        countdownTimer = setInterval(() => {
            countdownLeft--;
            if (countdownLeft <= 0) { clearInterval(countdownTimer!); void submit(); }
        }, 1000);
    }
    function genId(): string {
        if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
        return `rg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    async function saveToDoc() {
        if (!session || !results) return;
        try { await service.saveResultToDoc(session, analysis ?? ""); showMessage("已保存到文档"); }
        catch (e) { error = (e as Error).message; }
    }
    function typeLabel(t: string): string {
        const m: Record<string, string> = {
            single_choice: "单选", multiple_choice: "多选", fill_blank: "填空",
            true_false: "判断", subjective: "简答", coding: "编程",
        };
        return m[t] ?? t;
    }
</script>

<div class="rg-panel">
    {#if panelState === "loading_generating" || panelState === "loading_grading"}
        <div class="rg-panel__loading">
            <ProgressBar value={progressValue} label={progressLabel} />
        </div>
    {:else if panelState === "answering"}
        {#if error}
            <div class={alert("destructive")}><p class={alertTitle}>出错了</p><p class={alertDescription}>{error}</p></div>
        {/if}
        {#if questions.length > 0}
            <div class="rg-panel__scroll">
                <div class="rg-panel__list">
                    {#each questions as q, i}
                        <div class="rg-panel__q-item">
                            <div class="rg-panel__q-header">
                                <span class={badge("secondary")}>第 {i + 1} 题</span>
                                <span class={badge("outline")}>{typeLabel(q.type)}</span>
                                {#if isAnswered(q)}<span class={badge("success")}>已答</span>{/if}
                            </div>
                            <QuestionView question={q} answer={session?.answers[q.id]} on:change={(e) => onAnswer(q.id, e.detail)} />
                        </div>
                    {/each}
                </div>
            </div>
            <footer class="rg-panel__footer">
                <span class={badge("secondary")}>已答 {answeredCount} / {questions.length}</span>
                {#if countdownEnabled}
                    <span class={badge("warning")}>{Math.floor(countdownLeft / 60)}:{(countdownLeft % 60).toString().padStart(2, "0")}</span>
                {/if}
                <button class={button({ variant: "destructive" })} on:click={submit}>交卷</button>
            </footer>
        {/if}
    {:else if panelState === "result"}
        {#if error}
            <div class={alert("destructive")}><p class={alertTitle}>出错了</p><p class={alertDescription}>{error}</p></div>
        {/if}
        {#if results && session}
            <ResultPanel {service} results={results} questions={session.questions} {analysis} on:save={() => saveToDoc()} />
        {/if}
    {/if}
</div>

<style>
    .rg-panel { display: flex; flex-direction: column; height: 100%; gap: 12px; }
    .rg-panel__loading { display: flex; align-items: center; justify-content: center; padding: 48px 24px; }
    .rg-panel__scroll { flex: 1; overflow-y: auto; min-height: 0; }
    .rg-panel__list { display: flex; flex-direction: column; gap: 16px; padding: 4px 0 16px; }
    .rg-panel__q-item { display: flex; flex-direction: column; gap: 8px; }
    .rg-panel__q-header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .rg-panel__footer { display: flex; justify-content: flex-end; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid var(--b3-border-color); flex-shrink: 0; }
</style>
