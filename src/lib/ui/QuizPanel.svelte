<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import ProgressBar from "./ProgressBar.svelte";
    import QuestionView from "./QuestionView.svelte";
    import ResultPanel from "./ResultPanel.svelte";
    import { showMessage, Dialog } from "siyuan";
    import { button, badge, card, cn } from "./components";
    import { t } from "../i18n";
    import type { QuizService, QuizTabData, DateGenConfig } from "../quiz/service";
    import type { GradingResult, PanelState, Question, QuizSession, UserAnswer } from "@/types/quiz";

    export let service: QuizService;
    export let tabData: QuizTabData;
    export let closeTab: () => void = () => {};

    let panelState: PanelState = "loading_generating";
    let dateCfg: DateGenConfig = { days: 7, baseHour: 0, baseMinute: 0 };
    let session: QuizSession | null = null;
    let error: string | null = null;
    let results: GradingResult[] | null = null;
    let analysis: string | null = null;
    let progressValue: number | null = null;
    let progressLabel = "";
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const config = service.getConfig();
    $: countdownEnabled = config.general.countdownEnabled && config.general.countdownMinutes > 0;
    $: countdownSec = config.general.countdownMinutes * 60;
    let countdownLeft = 0;

    $: questions = session?.questions ?? [];
    $: hasError = !!error && questions.length === 0;

    /** 解析错误类型与建议 */
    function parseError(msg: string): { title: string; detail: string; hint: string } {
        const httpMatch = msg.match(/HTTP (\d+)/);
        if (httpMatch) {
            const code = parseInt(httpMatch[1]);
            if (code === 400) return { title: t("err.400.title"), detail: msg, hint: t("err.400.hint") };
            if (code === 401 || code === 403)
                return { title: t("err.401.title", String(code)), detail: msg, hint: t("err.401.hint") };
            if (code === 429) return { title: t("err.429.title"), detail: msg, hint: t("err.429.hint") };
            if (code >= 500) return { title: t("err.5xx.title", String(code)), detail: msg, hint: t("err.5xx.hint") };
            return { title: t("err.network.title", String(code)), detail: msg, hint: t("err.network.hint") };
        }
        if (msg.includes("未配置") || msg.includes("未设置") || msg.includes("not configured"))
            return { title: t("err.config.title"), detail: msg, hint: t("err.config.hint") };
        if (msg.includes("timeout") || msg.includes("超时"))
            return { title: t("err.timeout.title"), detail: msg, hint: t("err.timeout.hint") };
        if (msg.includes("JSON") || msg.includes("解析") || msg.includes("parse"))
            return { title: t("err.json.title"), detail: msg, hint: t("err.json.hint") };
        return { title: t("err.generic.title"), detail: msg, hint: t("err.generic.hint") };
    }
    $: errorInfo = error ? parseError(error) : null;

    onMount(async () => {
        if (tabData.mode === "resume" && tabData.quizId) {
            await resume();
        } else if (tabData.mode === "generate") {
            // SiYuan 重启后可能恢复 tab，先检查是否有已保存的进度避免重新生成
            const existing = await service.findProgressBySourceDocId(tabData.sourceDocId);
            if (existing && existing.questions.length > 0) {
                session = existing;
                panelState = "answering";
                if (countdownEnabled) {
                    countdownLeft = countdownSec;
                    startCountdown();
                }
            } else {
                await startGenerate();
            }
        } else if (tabData.mode === "dateGenerate") {
            // 先检查是否有已保存的进度
            const existing = await service.findProgressBySourceDocId(tabData.sourceDocId);
            if (existing && existing.questions.length > 0) {
                session = existing;
                panelState = "answering";
                if (countdownEnabled) {
                    countdownLeft = countdownSec;
                    startCountdown();
                }
            } else {
                panelState = "configuring";
            }
        } else if (tabData.mode === "review" && tabData.review) {
            const { entry, detail } = tabData.review;
            session = {
                id: entry.quizId,
                sourceDocId: entry.sourceDocId ?? "",
                sourceTitle: entry.title,
                questions: detail.questions ?? [],
                createdAt: entry.timestamp,
                answers: {},
            };
            results = detail.detail;
            analysis = detail.analysis ?? "";
            // 回看时也要显示当时的答题耗时
            durationVar = entry.duration ?? 0;
            panelState = "result";
        } else {
            error = t("quiz.invalidTab");
            panelState = "answering";
        }
    });

    onDestroy(() => {
        if (saveTimer) clearTimeout(saveTimer);
        if (countdownTimer) clearInterval(countdownTimer);
    });

    /** tab 销毁前调用：中止生成 + 强制保存进度 */
    export function beforeDestroy() {
        cancelled = true;
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
        if (session && panelState === "answering") {
            void service.saveProgress(session);
        }
    }

    function checkAiConfig(): boolean {
        const ai = config.ai;
        if (!ai.models || ai.models.length === 0) {
            error = t("quiz.aiNoModel");
            return false;
        }
        const genModel = ai.models.find((m) => m.id === ai.roles.generator);
        if (!genModel) {
            error = t("quiz.aiNoGenModel");
            return false;
        }
        const ep = ai.endpoints.find((e) => e.id === genModel.endpointId);
        if (!ep) {
            error = t("quiz.aiNoEndpoint");
            return false;
        }
        if (ep.provider !== "ollama" && !ep.apiKey) {
            error = t("quiz.aiNoApiKey");
            return false;
        }
        return true;
    }

    /** 从日期范围配置加载笔记后生成 */
    async function startDateGenerate() {
        error = null;
        cancelled = false;
        if (!checkAiConfig()) {
            panelState = "answering";
            return;
        }
        panelState = "loading_generating";
        progressValue = null;
        progressLabel = t("quiz.loadingNotes");
        try {
            const { content, title } = await service.loadDateRangeContent(
                dateCfg,
                tabData.dateRange ?? "beforeToday",
                tabData.notebookId
            );
            if (cancelled) return;
            tabData.content = content;
            tabData.sourceTitle = title;
            await startGenerate();
        } catch (e) {
            if (cancelled) return;
            error = (e as Error).message;
            panelState = "configuring";
        }
    }

    async function startGenerate() {
        error = null;
        cancelled = false;
        if (!checkAiConfig()) {
            panelState = "answering";
            return;
        }
        panelState = "loading_generating";
        progressValue = null;
        progressLabel = t("quiz.generating");
        try {
            const qs = await service.generate(tabData.content ?? "", (phase, round, detail) => {
                progressLabel = detail;
                if (phase === "generating") progressValue = null;
                else progressValue = round * 30;
            });
            if (cancelled) return;
            if (qs.length === 0) {
                error = t("quiz.noQuestions");
                panelState = "answering";
                return;
            }
            const id = genId();
            session = {
                id,
                sourceDocId: tabData.sourceDocId,
                sourceTitle: tabData.sourceTitle,
                questions: qs,
                createdAt: Date.now(),
                answers: {},
            };
            const prev = await service.loadProgress(id);
            if (cancelled) return;
            if (prev) session.answers = prev.answers;
            panelState = "answering";
            if (countdownEnabled) {
                countdownLeft = countdownSec;
                startCountdown();
            }
        } catch (e) {
            if (cancelled) return;
            error = (e as Error).message;
            panelState = "answering";
        }
    }

    async function resume() {
        const prev = await service.loadProgress(tabData.quizId ?? "");
        if (!prev) {
            error = t("quiz.progressNotFound");
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

    function onAnswer(qid: string, a: UserAnswer) {
        if (!session) return;
        session.answers[qid] = a;
        scheduleSave();
    }
    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            if (session) void service.saveProgress(session);
        }, 800);
    }
    function isAnswered(q: Question): boolean {
        return !!session?.answers[q.id];
    }
    $: answeredCount = questions.filter(isAnswered).length;

    async function submit() {
        if (!session) return;
        panelState = "loading_grading";
        progressValue = 0;
        progressLabel = t("quiz.grading");
        try {
            results = await service.grade(session.questions, session.answers, (done, total) => {
                progressValue = total ? (done / total) * 100 : null;
                progressLabel = t("quiz.gradingProgress", String(done), String(total));
            });
            // 判分完成后立即保存成绩（含题目），不受后续分析影响
            const totalScore = results.reduce((s, r) => s + r.score, 0);
            const maxScore = results.reduce((s, r) => s + r.maxScore, 0);
            const duration = Math.round((Date.now() - session.createdAt) / 1000);
            durationVar = duration;
            const scoreId = genId();
            await service.saveScore({
                id: scoreId,
                quizId: session.id,
                title: session.sourceTitle,
                timestamp: Date.now(),
                totalScore,
                maxScore,
                questionCount: session.questions.length,
                detail: results,
                questions: session.questions,
                analysis: "",
                sourceDocId: session.sourceDocId,
                sourceTitle: session.sourceTitle,
                duration,
            });
            await service.clearProgress(session.id);
            // 薄弱点分析失败不影响成绩记录
            progressLabel = t("quiz.analyzing");
            progressValue = null;
            try {
                analysis = await service.analyze(results, session.questions);
                await service.updateScoreAnalysis(scoreId, analysis);
            } catch (e) {
                analysis = t("quiz.analysisFailed", (e as Error).message);
            }
            panelState = "result";
        } catch (e) {
            error = (e as Error).message;
            panelState = "result";
        }
    }

    let durationVar = 0;
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
    async function saveToDoc(wrongOnly: boolean) {
        if (!session || !results) return;
        try {
            await service.saveResultToDoc(session, analysis ?? "", results, wrongOnly);
            showMessage(wrongOnly ? t("quiz.savedWrongDoc") : t("quiz.savedDoc"));
        } catch (e) {
            error = (e as Error).message;
        }
    }
    async function retryGenerate() {
        error = null;
        await startGenerate();
    }
    async function confirmRegenerate() {
        const ok = await confirmAction(t("quiz.confirmRegenTitle"), t("quiz.confirmRegenMsg"));
        if (ok) await regenerate();
    }
    async function confirmSubmit() {
        const ok = await confirmAction(t("quiz.confirmSubmitTitle"), t("quiz.confirmSubmitMsg"));
        if (ok) await submit();
    }
    async function regenerate() {
        if (session) {
            await service.clearProgress(session.id);
        }
        session = null;
        error = null;
        await startGenerate();
    }
    async function retryGrade() {
        error = null;
        await submit();
    }
    /** 二次确认弹窗 */
    function confirmAction(title: string, msg: string): Promise<boolean> {
        return new Promise((resolve) => {
            const dialog = new Dialog({
                title,
                content: `<div class="b3-dialog__content"><div class="ft__breakword">${msg}</div></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div><button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button></div>`,
            });
            const btns = dialog.element.querySelectorAll(".b3-button");
            btns[0].addEventListener("click", () => {
                resolve(false);
                dialog.destroy();
            });
            btns[1].addEventListener("click", () => {
                resolve(true);
                dialog.destroy();
            });
        });
    }
    function typeLabel(ty: string): string {
        const m: Record<string, string> = {
            single_choice: t("type.single_choice_short"),
            multiple_choice: t("type.multiple_choice_short"),
            fill_blank: t("type.fill_blank_short"),
            true_false: t("type.true_false_short"),
            subjective: t("type.subjective_short"),
            coding: t("type.coding_short"),
        };
        return m[ty] ?? ty;
    }
    function diffLabel(d: string): string {
        const m: Record<string, string> = { easy: t("diff.easy"), medium: t("diff.medium"), hard: t("diff.hard") };
        return m[d] ?? d;
    }
    function diffBadge(d: string): "secondary" | "warning" | "destructive" {
        if (d === "easy") return "secondary";
        if (d === "medium") return "warning";
        return "destructive";
    }

    /** dateBaseTime 计算与同步 */
    $: dateBaseTime = `${String(dateCfg.baseHour).padStart(2, "0")}:${String(dateCfg.baseMinute).padStart(2, "0")}`;
    function onBaseTimeChange(e: Event) {
        const v = (e.target as HTMLInputElement).value;
        const [h, m] = v.split(":").map((x) => parseInt(x, 10));
        dateCfg = { ...dateCfg, baseHour: h ?? 0, baseMinute: m ?? 0 };
    }
</script>

<div class="rg-panel" style="--rg-panel-width: {config.general.panelWidth}px">
    <div class="rg-panel__inner">
        {#if panelState === "configuring"}
            <div class="rg-config">
                <div class={cn(card.root, "rg-config__card")}>
                    <div class={card.content}>
                        <h3 class="rg-config__title">{t("quiz.dateConfigTitle")}</h3>
                        <p class="rg-config__desc">
                            {tabData.dateRange === "today"
                                ? t("quiz.dateConfigTodayDesc")
                                : t("quiz.dateConfigBeforeDesc")}
                        </p>
                        {#if tabData.dateRange === "beforeToday"}
                            <div class="rg-config__row">
                                <label for="rg-date-days">{t("quiz.dateDaysLabel")}</label>
                                <span class="rg-config__val"
                                    >{dateCfg.days === 0
                                        ? t("quiz.dateDaysAll")
                                        : t("quiz.dateDaysVal", String(dateCfg.days))}</span
                                >
                            </div>
                            <input
                                id="rg-date-days"
                                class="rg-slider"
                                type="range"
                                min="0"
                                max="90"
                                step="1"
                                bind:value={dateCfg.days}
                            />
                            <p class="rg-config__hint">{t("quiz.dateDaysHint")}</p>
                        {/if}
                        <div class="rg-config__row">
                            <label for="rg-date-base">{t("quiz.dateBaseLabel")}</label>
                            <input
                                id="rg-date-base"
                                class="rg-time-input"
                                type="time"
                                bind:value={dateBaseTime}
                                on:change={onBaseTimeChange}
                            />
                        </div>
                        <p class="rg-config__hint">{t("quiz.dateBaseHint")}</p>
                        <div class="rg-config__actions">
                            <button class={button({ variant: "default" })} on:click={startDateGenerate}
                                >{t("quiz.dateGenerate")}</button
                            >
                            <button class={button({ variant: "ghost", size: "sm" })} on:click={closeTab}
                                >{t("common.cancel")}</button
                            >
                        </div>
                        {#if error}
                            <div class="rg-config__error">⚠ {error}</div>
                        {/if}
                    </div>
                </div>
            </div>
        {:else if panelState === "loading_generating" || panelState === "loading_grading"}
            <div class="rg-panel__loading">
                <ProgressBar value={progressValue} label={progressLabel} />
                {#if panelState === "loading_generating"}
                    <button
                        class={button({ variant: "outline", size: "sm" })}
                        on:click={() => {
                            cancelled = true;
                            closeTab();
                        }}>{t("quiz.cancelGenerate")}</button
                    >
                {/if}
            </div>
        {:else if panelState === "answering"}
            {#if hasError && errorInfo}
                <div class="rg-error">
                    <div class="rg-error__icon">⚠</div>
                    <h3 class="rg-error__title">{errorInfo.title}</h3>
                    <div class="rg-error__detail">{errorInfo.detail}</div>
                    <div class="rg-error__hint">💡 {errorInfo.hint}</div>
                    <div class="rg-error__actions">
                        <button class={button({ variant: "default" })} on:click={retryGenerate}
                            >{t("common.retry")}</button
                        >
                    </div>
                </div>
            {:else if questions.length > 0}
                <header class="rg-panel__topbar">
                    <div class="rg-panel__topbar-left">
                        <span class={badge("secondary")}
                            >{t("quiz.answered", String(answeredCount), String(questions.length))}</span
                        >
                    </div>
                    <div class="rg-panel__topbar-right">
                        {#if countdownEnabled}
                            <span class={badge("warning")}
                                >⏱ {Math.floor(countdownLeft / 60)}:{(countdownLeft % 60)
                                    .toString()
                                    .padStart(2, "0")}</span
                            >
                        {/if}
                        <button class={button({ variant: "outline", size: "sm" })} on:click={confirmRegenerate}
                            >{t("quiz.regenerate")}</button
                        >
                        <button class={button({ variant: "destructive" })} on:click={confirmSubmit}
                            >{t("quiz.submit")}</button
                        >
                    </div>
                </header>
                <div class="rg-panel__scroll">
                    <div class="rg-panel__list">
                        {#each questions as q, i}
                            <div class="rg-panel__q-item">
                                <div class="rg-panel__q-header">
                                    <span class={badge("secondary")}>{t("quiz.questionNum", String(i + 1))}</span>
                                    <span class={badge(diffBadge(q.difficulty))}>{diffLabel(q.difficulty)}</span>
                                    <span class={badge("outline")}>{typeLabel(q.type)}</span>
                                    {#if isAnswered(q)}<span class={badge("success")}>{t("quiz.answeredTag")}</span
                                        >{/if}
                                </div>
                                <QuestionView
                                    question={q}
                                    answer={session?.answers[q.id]}
                                    on:change={(e) => onAnswer(q.id, e.detail)}
                                />
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}
        {:else if panelState === "result"}
            {#if hasError && errorInfo}
                <div class="rg-error">
                    <div class="rg-error__icon">⚠</div>
                    <h3 class="rg-error__title">{errorInfo.title}</h3>
                    <div class="rg-error__detail">{errorInfo.detail}</div>
                    <div class="rg-error__hint">💡 {errorInfo.hint}</div>
                    <div class="rg-error__actions">
                        <button class={button({ variant: "default" })} on:click={retryGrade}
                            >{t("err.retryGrade")}</button
                        >
                    </div>
                </div>
            {:else if results && session}
                <ResultPanel
                    {service}
                    {results}
                    questions={session.questions}
                    {analysis}
                    duration={durationVar}
                    on:save={() => saveToDoc(false)}
                    on:saveWrong={() => saveToDoc(true)}
                    on:discard={() => closeTab()}
                />
            {/if}
        {/if}
    </div>
</div>

<style>
    .rg-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
    }
    .rg-panel__inner {
        max-width: var(--rg-panel-width, 1100px);
        margin: 0 auto;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 0;
        padding: 0 16px;
        box-sizing: border-box;
    }
    .rg-panel__loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 48px 24px;
        gap: 16px;
    }
    .rg-panel__topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 8px 0;
        border-bottom: 1px solid var(--b3-border-color);
        flex-shrink: 0;
    }
    .rg-panel__topbar-left {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .rg-panel__topbar-right {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: nowrap;
    }
    .rg-panel__scroll {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
    }
    .rg-panel__list {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 12px 0 16px;
    }
    .rg-panel__q-item {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .rg-panel__q-header {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
    }
    .rg-panel__footer {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 12px;
        padding: 8px 0;
        border-top: 1px solid var(--b3-border-color);
        flex-shrink: 0;
    }
    .rg-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 12px;
        padding: 48px 24px;
        max-width: 480px;
        margin: 0 auto;
    }
    .rg-error__icon {
        font-size: 48px;
        line-height: 1;
    }
    .rg-error__title {
        font-size: 18px;
        font-weight: 600;
        margin: 0;
        color: var(--b3-card-error);
    }
    .rg-error__detail {
        font-size: 13px;
        color: var(--b3-theme-on-surface-light);
        word-break: break-all;
        max-height: 120px;
        overflow-y: auto;
        font-family: var(--b3-font-family-code, monospace);
        background: var(--b3-theme-surface);
        padding: 8px 12px;
        border-radius: 6px;
        width: 100%;
        box-sizing: border-box;
    }
    .rg-error__hint {
        font-size: 13px;
        color: var(--b3-theme-on-surface-light);
    }
    .rg-error__actions {
        display: flex;
        gap: 8px;
        margin-top: 4px;
    }
    .rg-config {
        display: flex;
        justify-content: center;
        padding: 48px 24px;
    }
    .rg-config__card {
        max-width: 520px;
        width: 100%;
    }
    .rg-config__title {
        font-size: 18px;
        font-weight: 600;
        margin: 0 0 8px;
    }
    .rg-config__desc {
        font-size: 13px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.6;
        margin: 0 0 16px;
    }
    .rg-config__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 12px 0 4px;
    }
    .rg-config__row label {
        font-size: 14px;
        font-weight: 500;
    }
    .rg-config__val {
        font-size: 14px;
        color: var(--b3-theme-primary);
        font-weight: 600;
    }
    .rg-config__hint {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        margin: 4px 0 12px;
    }
    .rg-slider {
        width: 100%;
    }
    .rg-time-input {
        font-size: 14px;
        padding: 4px 8px;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius);
        background: var(--b3-theme-background);
        color: var(--b3-theme-on-background);
    }
    .rg-config__actions {
        display: flex;
        gap: 8px;
        margin-top: 16px;
    }
    .rg-config__error {
        font-size: 13px;
        color: var(--b3-card-error, #d23f31);
        margin-top: 12px;
        padding: 8px 12px;
        background: color-mix(in srgb, var(--b3-card-error, #d23f31) 8%, transparent);
        border-radius: var(--b3-border-radius);
    }
</style>
