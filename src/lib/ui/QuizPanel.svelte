<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import ProgressBar from "./ProgressBar.svelte";
    import QuestionView from "./QuestionView.svelte";
    import ResultPanel from "./ResultPanel.svelte";
    import { showMessage } from "siyuan";
    import type { QuizService, QuizTabData } from "../quiz/service";
    import type { GradingResult, PanelState, Question, QuizSession, UserAnswer } from "@/types/quiz";

    export let service: QuizService;
    export let tabData: QuizTabData;

    let panelState: PanelState = "loading_generating";
    let session: QuizSession | null = null;
    let currentIndex = 0;
    let error: string | null = null;
    let results: GradingResult[] | null = null;
    let analysis: string | null = null;
    let progressValue: number | null = null;
    let progressLabel = "";
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    const config = service.getConfig();
    $: countdownEnabled = config.general.countdownEnabled;
    $: countdownSec = config.general.countdownMinutes * 60;
    let countdownLeft = 0;

    $: questions = session?.questions ?? [];
    $: current = questions[currentIndex];

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
    });

    async function startGenerate() {
        panelState = "loading_generating";
        progressValue = null;
        progressLabel = "AI 正在生成题目…";
        try {
            const qs = await service.generate(tabData.content ?? "");
            const id = genId();
            session = {
                id,
                sourceDocId: tabData.sourceDocId,
                sourceTitle: tabData.sourceTitle,
                questions: qs,
                createdAt: Date.now(),
                answers: {},
            };
            // 尝试恢复同源旧进度
            const prev = await service.loadProgress(id);
            if (prev) session.answers = prev.answers;
            panelState = "answering";
            if (countdownEnabled) {
                countdownLeft = countdownSec;
                startCountdown();
            }
        } catch (e) {
            error = (e as Error).message;
            panelState = "answering";
        }
    }

    async function resume() {
        const prev = await service.loadProgress(tabData.quizId ?? "");
        if (!prev) {
            error = "未找到可恢复的进度";
            panelState = "answering";
            return;
        }
        session = prev;
        panelState = "answering";
        if (countdownEnabled) {
            countdownLeft = countdownSec;
            startCountdown();
        }
    }

    function onAnswer(a: UserAnswer) {
        if (!session || !current) return;
        session.answers[current.id] = a;
        scheduleSave();
    }

    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            if (session) void service.saveProgress(session);
        }, 800);
    }

    function go(i: number) {
        if (i < 0 || i >= questions.length) return;
        currentIndex = i;
    }

    function isAnswered(q: Question): boolean {
        return !!session?.answers[q.id];
    }

    async function submit() {
        if (!session) return;
        panelState = "loading_grading";
        progressValue = 0;
        progressLabel = "正在判分…";
        try {
            results = await service.grade(
                session.questions,
                session.answers,
                (done, total) => {
                    progressValue = total ? (done / total) * 100 : null;
                    progressLabel = `判分中 ${done}/${total}`;
                },
            );
            progressLabel = "正在生成薄弱点分析…";
            progressValue = null;
            analysis = await service.analyze(results, session.questions);
            const totalScore = results.reduce((s, r) => s + r.score, 0);
            const maxScore = results.reduce((s, r) => s + r.maxScore, 0);
            await service.saveScore({
                id: genId(),
                quizId: session.id,
                title: session.sourceTitle,
                timestamp: Date.now(),
                totalScore,
                maxScore,
                questionCount: session.questions.length,
                detail: results,
            });
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
            if (countdownLeft <= 0) {
                clearInterval(countdownTimer!);
                void submit();
            }
        }, 1000);
    }

    function genId(): string {
        if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
        return `rg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    async function saveToDoc() {
        if (!session || !results) return;
        try {
            await service.saveResultToDoc(session, analysis ?? "");
            showMessage("已保存到文档");
        } catch (e) {
            error = (e as Error).message;
        }
    }
</script>

<div class="rg-panel">
    {#if panelState === "loading_generating"}
        <div class="rg-panel__loading">
            <ProgressBar value={progressValue} label={progressLabel} />
        </div>
    {:else if panelState === "loading_grading"}
        <div class="rg-panel__loading">
            <ProgressBar value={progressValue} label={progressLabel} />
        </div>
    {:else if panelState === "answering"}
        {#if error}
            <div class="rg-panel__error">{error}</div>
        {/if}
        <div class="rg-panel__body">
            <aside class="rg-panel__nav">
                {#each questions as q, i}
                    <button class="rg-nav__item" class:active={i === currentIndex} class:done={isAnswered(q)}
                            on:click={() => go(i)}>{i + 1}</button>
                {/each}
            </aside>
            <section class="rg-panel__main">
                {#if current}
                    <QuestionView question={current} answer={session?.answers[current.id]}
                                  on:change={onAnswer} />
                {/if}
                <div class="rg-panel__pager">
                    <button class="b3-button" on:click={() => go(currentIndex - 1)} disabled={currentIndex === 0}>上一题</button>
                    <span>{currentIndex + 1} / {questions.length}</span>
                    <button class="b3-button" on:click={() => go(currentIndex + 1)} disabled={currentIndex === questions.length - 1}>下一题</button>
                </div>
            </section>
        </div>
        <footer class="rg-panel__footer">
            {#if countdownEnabled}
                <span class="rg-countdown">{Math.floor(countdownLeft / 60)}:{(countdownLeft % 60).toString().padStart(2, "0")}</span>
            {/if}
            <button class="b3-button b3-button--text" on:click={submit}>交卷</button>
        </footer>
    {:else if panelState === "result"}
        {#if error}
            <div class="rg-panel__error">{error}</div>
        {/if}
        {#if results && session}
            <ResultPanel results={results} questions={session.questions} {analysis}
                         on:save={() => saveToDoc()} />
        {/if}
    {/if}
</div>

<style>
    .rg-panel { display: flex; flex-direction: column; height: 100%; }
    .rg-panel__loading { display: flex; align-items: center; justify-content: center; padding: 40px 24px; }
    .rg-panel__body { display: flex; flex: 1; min-height: 0; }
    .rg-panel__nav { width: 56px; display: flex; flex-direction: column; gap: 4px; padding: 8px; overflow-y: auto; border-right: 1px solid var(--b3-border-color); }
    .rg-nav__item { width: 40px; height: 40px; border: 1px solid var(--b3-border-color); border-radius: 6px; background: var(--b3-theme-background); cursor: pointer; }
    .rg-nav__item.done { background: var(--b3-theme-primary-lightest); }
    .rg-nav__item.active { border-color: var(--b3-theme-primary); }
    .rg-panel__main { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; }
    .rg-panel__pager { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
    .rg-panel__footer { display: flex; justify-content: flex-end; align-items: center; gap: 16px; padding: 8px 16px; border-top: 1px solid var(--b3-border-color); }
    .rg-panel__error { color: var(--b3-card-error-color); padding: 12px; }
    @media (max-width: 768px) {
        .rg-panel__nav { width: 44px; }
        .rg-nav__item { width: 36px; height: 36px; font-size: 12px; }
    }
</style>
