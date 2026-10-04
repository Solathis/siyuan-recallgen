<script module lang="ts">
    /** 「重试」需要重跑的流程 */
    export type RetryAction = "reviewDue" | "dateGenerate" | "resume" | "generate";

    /**
     * 错误页的「重试」应当重跑哪条流程。
     *
     * 此前一律重跑「出题」：从题库复习或按日期范围进入时失败，
     * 重试会拿着空的 tabData.content 去请求一次出题。
     */
    export function retryAction(mode: string | undefined): RetryAction {
        if (mode === "reviewDue") return "reviewDue";
        if (mode === "dateGenerate") return "dateGenerate";
        if (mode === "resume") return "resume";
        return "generate";
    }

    /**
     * 解析 `<input type="time">` 的值。
     *
     * 用户清空输入时 value 是空串，parseInt 得到 NaN，而 `NaN ?? 0` 仍是 NaN
     * （?? 只拦 null/undefined），NaN 会一路传进日期区间计算并产出非法日期。
     */
    export function parseTimeInput(value: string | undefined | null): { hour: number; minute: number } {
        const toNumber = (part: string | undefined, max: number): number => {
            const n = Number.parseInt(part ?? "", 10);
            return Number.isInteger(n) && n >= 0 && n <= max ? n : 0;
        };
        const [hour, minute] = String(value ?? "").split(":");
        return { hour: toNumber(hour, 23), minute: toNumber(minute, 59) };
    }
</script>

<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { showMessage } from "siyuan";
    import * as AlertDialog from "@/lib/components/ui/alert-dialog";
    import { Badge } from "@/lib/components/ui/badge";
    import { Button } from "@/lib/components/ui/button";
    import * as Card from "@/lib/components/ui/card";
    import { describeError, type ErrorDescription } from "../ai/errors";
    import { isAbortError } from "../ai/client";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import type { DateGenConfig, QuizService, QuizTabData } from "../quiz/service";
    import { PASS_SCORE } from "@/types/quiz";
    import type { GradingResult, PanelState, QuizSession, UserAnswer } from "@/types/quiz";
    import ProgressBar from "./ProgressBar.svelte";
    import QuestionView from "./QuestionView.svelte";
    import ResultPanel from "./ResultPanel.svelte";

    let {
        service,
        tabData,
        closeTab = () => {},
    }: { service: QuizService; tabData: QuizTabData; closeTab?: () => void } = $props();

    /* ── 状态机 ──────────────────────────────────────────────────── */

    let panelState = $state<PanelState>("loading_generating");
    let session = $state<QuizSession | null>(null);
    let results = $state<GradingResult[] | null>(null);
    let analysis = $state<string | null>(null);
    let error = $state<ErrorDescription | null>(null);
    let progressValue = $state<number | null>(null);
    let progressLabel = $state("");
    let duration = $state(0);
    /**
     * 取消控制器。
     * 光置一个标志位只能阻止 UI 更新，在途的批次、重试与审题轮次仍会继续请求；
     * 用 AbortSignal 才能真正把「不再发新请求」传下去。
     */
    let abortCtrl: AbortController | null = null;
    let cancelled = false;

    /** 开始一轮新的生成/取题：先中止上一轮，再新建信号 */
    function beginRun(): AbortSignal {
        abortCtrl?.abort();
        abortCtrl = new AbortController();
        cancelled = false;
        return abortCtrl.signal;
    }

    /** 中止当前轮次（关闭 tab、点取消时调用） */
    function abortRun(): void {
        cancelled = true;
        abortCtrl?.abort();
        abortCtrl = null;
    }

    /**
     * 配置必须响应式：原实现只在组件初始化时读一次，
     * 导致答题过程中改面板宽度 / 倒计时时长完全不生效。
     */
    /**
     * 配置：先取一次当前值，再订阅后续变化。
     * 读取放在函数里，避免在响应式上下文之外直接引用 service 触发 Svelte 警告。
     */
    function currentConfig() {
        return service.getConfig();
    }
    let config = $state(currentConfig());
    $effect(() => service.subscribeConfig((next) => (config = next)));

    const questions = $derived(session?.questions ?? []);
    const answeredCount = $derived(questions.filter((q) => !!session?.answers[q.id]).length);

    /* ── 日期范围配置 ────────────────────────────────────────────── */

    let dateCfg = $state<DateGenConfig>({ days: 7, baseHour: 0, baseMinute: 0 });
    /** 时间输入需要可写状态；dateCfg 才是真正的配置来源 */
    function fmtBaseTime(cfg: DateGenConfig): string {
        return `${String(cfg.baseHour).padStart(2, "0")}:${String(cfg.baseMinute).padStart(2, "0")}`;
    }
    let dateBaseTime = $state(fmtBaseTime({ days: 7, baseHour: 0, baseMinute: 0 }));

    function onBaseTimeChange(e: Event) {
        const value = (e.target as HTMLInputElement).value;
        dateBaseTime = value;
        const { hour, minute } = parseTimeInput(value);
        dateCfg = { ...dateCfg, baseHour: hour, baseMinute: minute };
    }

    /* ── 倒计时 ──────────────────────────────────────────────────── */

    /**
     * 剩余秒数由「截止时间戳」派生，而不是每秒自减。
     * setInterval 在后台标签页会被节流（Chrome 最慢可到 1 分钟一次），
     * 自减会让倒计时越走越慢、剩余时间与实际不符。
     */
    let countdownDeadline = $state<number | null>(null);
    /** 由定时器推进的「当前时间」，供派生剩余秒数使用 */
    let countdownNow = $state(Date.now());
    /** 上一次生效的时长，用于识别「答题中途改了倒计时」 */
    let countdownAppliedSec = $state(0);
    let countdownTimer: ReturnType<typeof setInterval> | null = null;
    const countdownEnabled = $derived(config.general.countdownEnabled && config.general.countdownMinutes > 0);
    const countdownSec = $derived(config.general.countdownMinutes * 60);
    const countdownLeft = $derived(
        countdownDeadline === null ? 0 : Math.max(0, Math.ceil((countdownDeadline - countdownNow) / 1000))
    );

    function startCountdown() {
        stopCountdown();
        countdownAppliedSec = countdownSec;
        countdownDeadline = Date.now() + countdownSec * 1000;
        countdownNow = Date.now();
        // 250ms 一跳：节流下也能及时刷新显示，代价可忽略
        countdownTimer = setInterval(() => {
            countdownNow = Date.now();
            if (countdownDeadline !== null && countdownNow >= countdownDeadline) {
                stopCountdown();
                void submit();
            }
        }, 250);
    }

    function stopCountdown() {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
        countdownDeadline = null;
        countdownNow = Date.now();
    }

    /** 答题中途修改倒计时时长时按新时长重新计时（原实现只在开始时读一次配置） */
    $effect(() => {
        const sec = countdownSec;
        if (countdownDeadline === null) return;
        if (sec === countdownAppliedSec) return;
        startCountdown();
    });

    const countdownText = $derived(`${Math.floor(countdownLeft / 60)}:${String(countdownLeft % 60).padStart(2, "0")}`);

    /* ── 生命周期 ────────────────────────────────────────────────── */

    /** 面板根节点，用于判断自身是否可见（见 isPanelVisible） */
    let rootEl: HTMLElement | null = $state(null);

    onDestroy(() => {
        window.removeEventListener("keydown", onKeydown);
        if (saveTimer) clearTimeout(saveTimer);
        stopCountdown();
    });

    onMount(() => {
        window.addEventListener("keydown", onKeydown);
        void init();
    });

    async function init() {
        if (tabData.mode === "resume" && tabData.quizId) {
            await resume();
        } else if (tabData.mode === "generate") {
            // 思源重启后可能恢复 tab，先检查是否有已保存的进度，避免重新生成
            const existing = await service.findProgressBySourceDocId(tabData.sourceDocId);
            if (existing && existing.questions.length > 0) {
                adoptSession(existing);
            } else {
                await startGenerate();
            }
        } else if (tabData.mode === "dateGenerate") {
            const existing = await service.findProgressBySourceDocId(tabData.sourceDocId);
            if (existing && existing.questions.length > 0) {
                adoptSession(existing);
            } else {
                panelState = "configuring";
            }
        } else if (tabData.mode === "reviewDue") {
            await startDueReview();
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
            duration = entry.duration ?? 0;
            panelState = "result";
        } else {
            error = { title: t("err.generic.title"), hint: t("err.generic.hint"), detail: t("quiz.invalidTab") };
            panelState = "answering";
        }
    }

    /**
     * 复习到期题目。
     * 与生成流程不同，这里不调用 AI 出题，直接取题库中按 FSRS 排到期的题目；
     * 判分仍需 AI（主观题/编程题），因此同样要求 AI 配置完整。
     */
    async function startDueReview() {
        error = null;
        beginRun();
        if (!checkAiConfig()) {
            panelState = "answering";
            return;
        }
        panelState = "loading_generating";
        progressValue = null;
        progressLabel = t("bank.loadingDue");
        try {
            // 按知识点复习时允许提前复习：用户是想练这个点，不该被排程挡住，
            // 因此只有题库里根本没有该知识点的题目时才会走到空态
            const { dueTag: tag, dueType: type } = tabData;
            // 按知识点/题型复习时允许提前复习：用户是想练这一类题，不该被排程挡住，
            // 因此只有题库里根本没有这类题目时才会走到空态
            const due = await service.dueBankQuestions({
                limit: 0,
                sourceDocId: tabData.dueSourceDocId,
                tag,
                type,
                ahead: Boolean(tag || type),
            });
            if (cancelled) return;
            if (due.length === 0) {
                error = {
                    title: t("bank.noDueTitle"),
                    hint: tag
                        ? t("bank.noTagQuestions", tag)
                        : type
                          ? t("bank.noTypeQuestions", t(`type.${type}`))
                          : t("bank.noDueHint"),
                    detail: t("bank.noDueDetail"),
                };
                panelState = "answering";
                return;
            }
            session = {
                id: genId(),
                sourceDocId: tabData.sourceDocId,
                sourceTitle: tag
                    ? t("bank.sessionTitleTag", tag, String(due.length))
                    : type
                      ? t("bank.sessionTitleType", t(`type.${type}`), String(due.length))
                      : t("bank.sessionTitle", String(due.length)),
                questions: due,
                createdAt: Date.now(),
                answers: {},
            };
            panelState = "answering";
            activeIndex = 0;
            timingQuestionId = due[0]?.id ?? null;
            timingSince = Date.now();
            if (countdownEnabled) startCountdown();
        } catch (e) {
            // 取消（无论来自关闭 tab 还是新一轮开始）都不该弹出错误
            if (cancelled || isAbortError(e)) return;
            error = describeError(e);
            panelState = "answering";
        }
    }

    function adoptSession(existing: QuizSession) {
        session = existing;
        panelState = "answering";
        activeIndex = 0;
        // 开始为第一题计时
        timingQuestionId = existing.questions[0]?.id ?? null;
        timingSince = Date.now();
        if (countdownEnabled) startCountdown();
    }

    /** tab 销毁前由插件调用：中止生成并强制保存进度 */
    export function beforeDestroy() {
        abortRun();
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        stopCountdown();
        if (session && panelState === "answering") {
            // 先结算最后一段计时，否则这段作答时间不会被计入
            flushTiming(null);
            void service.saveProgress(session);
        }
    }

    /* ── 生成 ────────────────────────────────────────────────────── */

    function checkAiConfig(): boolean {
        const ai = config.ai;
        if (!ai.models || ai.models.length === 0) {
            error = { title: t("err.config.title"), hint: t("err.config.hint"), detail: t("quiz.aiNoModel") };
            return false;
        }
        const genModel = ai.models.find((m) => m.id === ai.roles.generator);
        if (!genModel) {
            error = { title: t("err.config.title"), hint: t("err.config.hint"), detail: t("quiz.aiNoGenModel") };
            return false;
        }
        const ep = ai.endpoints.find((e) => e.id === genModel.endpointId);
        if (!ep) {
            error = { title: t("err.config.title"), hint: t("err.config.hint"), detail: t("quiz.aiNoEndpoint") };
            return false;
        }
        if (ep.provider !== "ollama" && !ep.apiKey) {
            error = { title: t("err.config.title"), hint: t("err.config.hint"), detail: t("quiz.aiNoApiKey") };
            return false;
        }
        return true;
    }

    async function startDateGenerate() {
        error = null;
        beginRun();
        if (!checkAiConfig()) {
            panelState = "answering";
            return;
        }
        panelState = "loading_generating";
        progressValue = null;
        progressLabel = t("quiz.loadingNotes");
        try {
            const loaded = await service.loadDateRangeContent(
                dateCfg,
                tabData.dateRange ?? "beforeToday",
                tabData.notebookId
            );
            if (cancelled) return;
            warnPartialScope(loaded);
            tabData.content = loaded.content;
            tabData.sourceTitle = loaded.title;
            await startGenerate();
        } catch (e) {
            // 取消（无论来自关闭 tab 还是新一轮开始）都不该弹出错误
            if (cancelled || isAbortError(e)) return;
            error = describeError(e);
            panelState = "configuring";
        }
    }

    /**
     * 提示「范围内的笔记没有全部纳入」。
     * 命中上限、超长被跳过、导出失败这三种情况原先都不吭声，
     * 用户会以为范围内所有笔记都参与了出题。
     */
    function warnPartialScope(loaded: { capped: boolean; skipped: number; failed: number }): void {
        if (loaded.capped) showMessage(t("date.capped", String(200)), 8000);
        if (loaded.skipped > 0) showMessage(t("date.skippedByLength", String(loaded.skipped)), 8000);
        if (loaded.failed > 0) showMessage(t("date.exportFailed", String(loaded.failed)), 8000);
    }

    async function startGenerate() {
        error = null;
        const signal = beginRun();
        if (!checkAiConfig()) {
            panelState = "answering";
            return;
        }
        panelState = "loading_generating";
        progressValue = null;
        progressLabel = t("quiz.generating");
        try {
            const generated = await service.generate(
                tabData.content ?? "",
                (phase, round, detail) => {
                    progressLabel = detail;
                    progressValue = phase === "generating" ? null : round * 30;
                },
                signal
            );
            if (cancelled) return;
            if (generated.length === 0) {
                error = { title: t("err.generic.title"), hint: t("err.generic.hint"), detail: t("quiz.noQuestions") };
                panelState = "answering";
                return;
            }
            const id = genId();
            session = {
                id,
                sourceDocId: tabData.sourceDocId,
                sourceTitle: tabData.sourceTitle,
                questions: generated,
                createdAt: Date.now(),
                answers: {},
            };
            const prev = await service.loadProgress(id);
            if (cancelled) return;
            if (prev) session.answers = prev.answers;
            panelState = "answering";
            if (countdownEnabled) startCountdown();
        } catch (e) {
            // 取消（无论来自关闭 tab 还是新一轮开始）都不该弹出错误
            if (cancelled || isAbortError(e)) return;
            error = describeError(e);
            panelState = "answering";
        }
    }

    /**
     * 按当前 tab 的进入方式重试。
     *
     * 错误页的「重试」原先一律调用 startGenerate()：复习到期题目或按日期范围
     * 进入时失败，重试会拿空的 tabData.content 去重新出题（等于发一次空内容请求）。
     */
    async function retry() {
        switch (retryAction(tabData.mode)) {
            case "reviewDue":
                await startDueReview();
                return;
            case "dateGenerate":
                await startDateGenerate();
                return;
            case "resume":
                await resume();
                return;
            default:
                await startGenerate();
        }
    }

    async function resume() {
        const prev = await service.loadProgress(tabData.quizId ?? "");
        if (!prev) {
            error = { title: t("err.generic.title"), hint: t("err.generic.hint"), detail: t("quiz.progressNotFound") };
            panelState = "answering";
            return;
        }
        adoptSession(prev);
    }

    /* ── 作答与进度保存 ──────────────────────────────────────────── */

    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    /* ── 单题耗时 ────────────────────────────────────────────────── */

    /**
     * 单段最多计入的秒数。
     * 用户可能挂着页面离开，若不加上限会把空闲时间算进「作答耗时」。
     */
    const MAX_TIMING_STEP_SECONDS = 300;

    let timingQuestionId: string | null = null;
    let timingSince = 0;

    /**
     * 结束当前题目的计时段落并累计到该题。
     * 只在题目切换或交卷时结算，因此「一直在看同一道题」的时间也会被计入，
     * 而离开很久的空档由上限制约。
     */
    function flushTiming(nextQuestionId: string | null) {
        const now = Date.now();
        if (session && timingQuestionId && timingSince > 0) {
            const elapsed = Math.min(MAX_TIMING_STEP_SECONDS, (now - timingSince) / 1000);
            if (elapsed > 0) {
                const timings = { ...(session.timings ?? {}) };
                timings[timingQuestionId] = (timings[timingQuestionId] ?? 0) + elapsed;
                session.timings = timings;
            }
        }
        timingQuestionId = nextQuestionId;
        timingSince = now;
    }

    function onAnswer(questionId: string, value: UserAnswer) {
        if (!session) return;
        // 同一题内的连续输入也逐段累计，避免只算第一段
        flushTiming(questionId);
        session.answers[questionId] = value;
        scheduleSave();
    }

    /** 标记/取消标记某题，便于长试卷稍后回看 */
    function toggleFlag(questionId: string) {
        if (!session) return;
        const flagged = { ...(session.flagged ?? {}) };
        if (flagged[questionId]) delete flagged[questionId];
        else flagged[questionId] = true;
        session.flagged = flagged;
        scheduleSave();
    }

    const flaggedCount = $derived(questions.filter((q) => session?.flagged?.[q.id]).length);

    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            if (session) void service.saveProgress(session);
        }, 800);
    }

    /* ── 交卷 ────────────────────────────────────────────────────── */

    async function submit() {
        if (!session) return;
        stopCountdown();
        flushTiming(null);
        panelState = "loading_grading";
        progressValue = 0;
        progressLabel = t("quiz.grading");
        try {
            results = await service.grade(
                session.questions,
                session.answers,
                (done, total) => {
                    progressValue = total ? (done / total) * 100 : null;
                    progressLabel = t("quiz.gradingProgress", String(done), String(total));
                },
                session.timings,
                beginRun()
            );

            duration = Math.round((Date.now() - session.createdAt) / 1000);
            const scoreId = genId();
            // 成绩先落盘，不受后续分析成败影响
            await service.saveScore({
                id: scoreId,
                quizId: session.id,
                title: session.sourceTitle,
                timestamp: Date.now(),
                totalScore: results.reduce((s, r) => s + r.score, 0),
                maxScore: results.reduce((s, r) => s + r.maxScore, 0),
                questionCount: session.questions.length,
                detail: results,
                questions: session.questions,
                analysis: "",
                sourceDocId: session.sourceDocId,
                sourceTitle: session.sourceTitle,
                duration,
            });
            await service.clearProgress(session.id);

            // 把作答结果写回题库以推进 FSRS 排程；失败不影响成绩与结果展示
            try {
                await service.recordBankOutcomes(
                    session.questions,
                    { sourceDocId: session.sourceDocId, sourceTitle: session.sourceTitle },
                    results
                );
            } catch (e) {
                console.error("[RecallGen] 题库排程更新失败", e);
            }

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
            error = describeError(e);
            panelState = "result";
        }
    }

    function genId(): string {
        if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
        return `rg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    async function regenerate() {
        if (session) await service.clearProgress(session.id);
        session = null;
        error = null;
        await startGenerate();
    }

    /** 只重做本卷未达标的题目：成绩已落盘，因此直接替换当前会话即可 */
    function retryWrong() {
        if (!session || !results) return;
        const wrongIds = new Set(results.filter((r) => r.score < PASS_SCORE).map((r) => r.questionId));
        const wrongQuestions = session.questions.filter((q) => wrongIds.has(q.id));
        if (wrongQuestions.length === 0) {
            showMessage(t("quiz.noWrongToRetry"), 4000);
            return;
        }

        const source = { sourceDocId: session.sourceDocId, sourceTitle: session.sourceTitle };
        session = {
            id: genId(),
            ...source,
            sourceTitle: t("quiz.retrySessionTitle", session.sourceTitle, String(wrongQuestions.length)),
            questions: wrongQuestions,
            createdAt: Date.now(),
            answers: {},
            flagged: {},
            timings: {},
        };
        results = null;
        analysis = null;
        duration = 0;
        error = null;
        panelState = "answering";
        activeIndex = 0;
        timingQuestionId = wrongQuestions[0]?.id ?? null;
        timingSince = Date.now();
        if (countdownEnabled) startCountdown();
    }

    /** 保存进行中：连点两次会各建一篇文档，因此期间禁用按钮 */
    let savingDoc = $state(false);

    async function saveToDoc(wrongOnly: boolean) {
        if (!session || !results || savingDoc) return;
        savingDoc = true;
        try {
            await service.saveResultToDoc(session, analysis ?? "", results, wrongOnly);
            showMessage(wrongOnly ? t("quiz.savedWrongDoc") : t("quiz.savedDoc"));
        } catch (e) {
            error = describeError(e);
        } finally {
            savingDoc = false;
        }
    }

    /* ── 确认对话框（替换原先自建且会泄漏的弹窗） ────────────────── */

    type PendingAction = { title: string; description: string; confirmLabel: string; run: () => void };
    let pending = $state<PendingAction | null>(null);

    function askRegenerate() {
        pending = {
            title: t("quiz.confirmRegenTitle"),
            description: t("quiz.confirmRegenMsg"),
            confirmLabel: t("quiz.regenerate"),
            run: () => void regenerate(),
        };
    }

    function askSubmit() {
        const unanswered = questions.length - answeredCount;
        pending = {
            title: t("quiz.confirmSubmitTitle"),
            description:
                unanswered > 0 ? t("quiz.confirmSubmitUnanswered", String(unanswered)) : t("quiz.confirmSubmitMsg"),
            confirmLabel: t("quiz.submit"),
            run: () => void submit(),
        };
    }

    /* ── 展示辅助 ────────────────────────────────────────────────── */

    const answeredText = $derived(`${answeredCount} / ${questions.length}`);
    const progressPct = $derived(questions.length > 0 ? (answeredCount / questions.length) * 100 : 0);

    /* ── 题目导航 ────────────────────────────────────────────────── */

    /** 滚动容器与当前定位到的题号（用于题号导航条与上一题/下一题） */
    let listEl = $state<HTMLDivElement | null>(null);
    let activeIndex = $state(0);

    function goToQuestion(index: number) {
        const clamped = Math.max(0, Math.min(questions.length - 1, index));
        activeIndex = clamped;
        flushTiming(questions[clamped]?.id ?? null);
        const nodes = listEl?.querySelectorAll<HTMLElement>("[data-question-index]");
        nodes?.[clamped]?.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    /** 焦点在输入控件里时不劫持按键，否则会打断输入 */
    function isTypingTarget(target: EventTarget | null): boolean {
        const element = target as HTMLElement | null;
        if (!element) return false;
        const tag = element.tagName;
        return (
            tag === "INPUT" ||
            tag === "TEXTAREA" ||
            tag === "SELECT" ||
            element.isContentEditable ||
            !!element.closest(".cm-editor")
        );
    }

    /** 面板是否真的显示在屏幕上：隐藏的 tab 里不能抢全局按键 */
    function isPanelVisible(): boolean {
        return !!rootEl && rootEl.isConnected && rootEl.getClientRects().length > 0;
    }

    /**
     * 答题快捷键：左右方向键切换题目，Ctrl/Cmd+Enter 交卷。
     *
     * 监听挂在 window 上，因为用户常常刚点完按钮、焦点并不在面板内；
     * 所以必须自己判断该不该响应：面板不可见、正在输入、或打开了弹层时都让行。
     */
    function onKeydown(event: KeyboardEvent) {
        if (panelState !== "answering" || questions.length === 0) return;
        if (isTypingTarget(event.target)) return;
        if (!isPanelVisible()) return;
        // 弹层（交卷确认、下拉菜单等）打开时把按键让给弹层
        if ((event.target as HTMLElement | null)?.closest?.('[role="dialog"], [role="menu"], [role="listbox"]')) {
            return;
        }

        if (event.key === "ArrowLeft" || event.key === "PageUp") {
            event.preventDefault();
            goToQuestion(activeIndex - 1);
        } else if (event.key === "ArrowRight" || event.key === "PageDown") {
            event.preventDefault();
            goToQuestion(activeIndex + 1);
        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            askSubmit();
        }
    }
</script>

<div bind:this={rootEl} class="flex h-full flex-col" style="--rg-panel-width: {config.general.panelWidth}px">
    <div class="mx-auto flex h-full w-full flex-col px-4" style="max-width: var(--rg-panel-width, 1100px)">
        {#if panelState === "configuring"}
            <div class="flex justify-center px-2 py-12">
                <Card.Root class="w-full max-w-lg">
                    <Card.Header>
                        <Card.Title>{t("quiz.dateConfigTitle")}</Card.Title>
                        <Card.Description>
                            {tabData.dateRange === "today"
                                ? t("quiz.dateConfigTodayDesc")
                                : t("quiz.dateConfigBeforeDesc")}
                        </Card.Description>
                    </Card.Header>
                    <Card.Content class="flex flex-col gap-4">
                        {#if tabData.dateRange === "beforeToday"}
                            <div class="flex flex-col gap-2">
                                <div class="flex items-center justify-between">
                                    <label class="text-sm font-medium" for="rg-date-days"
                                        >{t("quiz.dateDaysLabel")}</label
                                    >
                                    <span class="text-primary text-sm font-semibold">
                                        {dateCfg.days === 0
                                            ? t("quiz.dateDaysAll")
                                            : t("quiz.dateDaysVal", String(dateCfg.days))}
                                    </span>
                                </div>
                                <input
                                    id="rg-date-days"
                                    class="accent-primary w-full"
                                    type="range"
                                    min="0"
                                    max="90"
                                    step="1"
                                    bind:value={dateCfg.days}
                                />
                                <p class="text-muted-foreground text-xs">{t("quiz.dateDaysHint")}</p>
                            </div>
                        {/if}
                        <div class="flex items-center justify-between gap-3">
                            <label class="text-sm font-medium" for="rg-date-base">{t("quiz.dateBaseLabel")}</label>
                            <input
                                id="rg-date-base"
                                class="border-input bg-background rounded-md border px-2 py-1 text-sm"
                                type="time"
                                bind:value={dateBaseTime}
                                onchange={onBaseTimeChange}
                            />
                        </div>
                        <p class="text-muted-foreground text-xs">{t("quiz.dateBaseHint")}</p>
                        {#if error}
                            <p class="text-destructive text-sm">{error.detail}</p>
                        {/if}
                    </Card.Content>
                    <Card.Footer class="flex gap-2">
                        <Button onclick={startDateGenerate}>{t("quiz.dateGenerate")}</Button>
                        <Button variant="ghost" onclick={closeTab}>{t("common.cancel")}</Button>
                    </Card.Footer>
                </Card.Root>
            </div>
        {:else if panelState === "loading_generating" || panelState === "loading_grading"}
            <div class="flex flex-col items-center justify-center gap-4 px-6 py-20">
                <ProgressBar value={progressValue} label={progressLabel} />
                {#if panelState === "loading_generating"}
                    <Button
                        variant="outline"
                        size="sm"
                        onclick={() => {
                            abortRun();
                            closeTab();
                        }}
                    >
                        {t("quiz.cancelGenerate")}
                    </Button>
                {/if}
            </div>
        {:else if panelState === "answering"}
            {#if error && questions.length === 0}
                <div class="mx-auto flex max-w-lg flex-col items-center gap-3 px-4 py-20 text-center">
                    <h3 class="text-destructive text-lg font-semibold">{error.title}</h3>
                    <pre
                        class="bg-muted text-muted-foreground max-h-32 w-full overflow-auto rounded-md p-3 text-left text-xs">{error.detail}</pre>
                    <p class="text-muted-foreground text-sm">{error.hint}</p>
                    <Button onclick={() => void retry()}>{t("common.retry")}</Button>
                </div>
            {:else if questions.length === 0}
                <!-- 补齐空态：恢复到一个空会话时原实现会整屏空白 -->
                <div class="text-muted-foreground py-20 text-center text-sm">{t("quiz.emptySession")}</div>
            {:else}
                <header class="border-border flex shrink-0 flex-wrap items-center justify-between gap-2 border-b py-2">
                    <div class="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">
                            {t("quiz.answered", String(answeredCount), String(questions.length))}
                        </Badge>
                        {#if flaggedCount > 0}
                            <Badge variant="outline">{t("quiz.flaggedCount", String(flaggedCount))}</Badge>
                        {/if}
                        {#if countdownEnabled}
                            <Badge variant={countdownLeft <= 60 ? "destructive" : "warning"}>
                                {countdownText}
                            </Badge>
                        {/if}
                    </div>
                    <div class="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={activeIndex <= 0}
                            onclick={() => goToQuestion(activeIndex - 1)}
                            aria-label={t("quiz.prevQuestion")}
                        >
                            ←
                        </Button>
                        <span class="text-muted-foreground text-xs" aria-live="polite">
                            {activeIndex + 1}/{questions.length}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={activeIndex >= questions.length - 1}
                            onclick={() => goToQuestion(activeIndex + 1)}
                            aria-label={t("quiz.nextQuestion")}
                        >
                            →
                        </Button>
                        <Button variant="outline" size="sm" onclick={askRegenerate}>{t("quiz.regenerate")}</Button>
                        <Button variant="destructive" size="sm" onclick={askSubmit}>{t("quiz.submit")}</Button>
                    </div>
                </header>

                <div class="px-1 py-2">
                    <ProgressBar value={progressPct} label={t("quiz.progress", answeredText)} />
                </div>

                <!-- 题号导航：长试卷时不必靠滚动找题；已答/未答一眼可见 -->
                <div
                    class="flex flex-wrap items-center gap-1.5 px-1 pt-2"
                    role="group"
                    aria-label={t("quiz.navLabel")}
                    title={t("quiz.shortcutHint")}
                >
                    {#each questions as q, i (q.id)}
                        <button
                            type="button"
                            class={cn(
                                "size-7 rounded-md border text-xs font-semibold transition-colors",
                                session?.flagged?.[q.id] && "border-warning",
                                session?.answers[q.id]
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border text-muted-foreground hover:bg-accent",
                                i === activeIndex && "ring-ring ring-2"
                            )}
                            aria-label={t(
                                "result.jumpTo",
                                String(i + 1),
                                session?.answers[q.id] ? t("quiz.answeredTag") : t("result.status_unanswered")
                            )}
                            aria-current={i === activeIndex}
                            onclick={() => goToQuestion(i)}>{i + 1}</button
                        >
                    {/each}
                </div>

                <div class="min-h-0 flex-1 overflow-y-auto" bind:this={listEl}>
                    <div class="flex flex-col gap-4 py-2">
                        {#each questions as q, i (q.id)}
                            <div class="flex flex-col gap-2" data-question-index={i}>
                                <div class="flex flex-wrap items-center gap-2">
                                    <Badge variant="secondary">{t("quiz.questionNum", String(i + 1))}</Badge>
                                    <Badge
                                        variant={q.difficulty === "hard"
                                            ? "destructive"
                                            : q.difficulty === "medium"
                                              ? "warning"
                                              : "outline"}
                                    >
                                        {t(`diff.${q.difficulty}`)}
                                    </Badge>
                                    <Badge variant="outline">{t(`type.${q.type}_short`)}</Badge>
                                    {#if session?.answers[q.id]}
                                        <Badge variant="success">{t("quiz.answeredTag")}</Badge>
                                    {/if}
                                    <!-- 标记：长试卷里先把不确定的题标出来，稍后回看 -->
                                    <button
                                        type="button"
                                        class={cn(
                                            "ml-auto rounded-md border px-2 py-0.5 text-xs transition-colors",
                                            session?.flagged?.[q.id]
                                                ? "border-warning bg-warning/10 text-warning"
                                                : "border-border text-muted-foreground hover:bg-accent"
                                        )}
                                        aria-pressed={!!session?.flagged?.[q.id]}
                                        onclick={() => toggleFlag(q.id)}
                                    >
                                        {session?.flagged?.[q.id] ? t("quiz.unflag") : t("quiz.flag")}
                                    </button>
                                </div>
                                <QuestionView
                                    question={q}
                                    answer={session?.answers[q.id]}
                                    onchange={(a) => onAnswer(q.id, a)}
                                />
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}
        {:else if panelState === "result"}
            {#if error && !results}
                <div class="mx-auto flex max-w-lg flex-col items-center gap-3 px-4 py-20 text-center">
                    <h3 class="text-destructive text-lg font-semibold">{error.title}</h3>
                    <pre
                        class="bg-muted text-muted-foreground max-h-32 w-full overflow-auto rounded-md p-3 text-left text-xs">{error.detail}</pre>
                    <p class="text-muted-foreground text-sm">{error.hint}</p>
                    <Button onclick={() => void submit()}>{t("err.retryGrade")}</Button>
                </div>
            {:else if results && session}
                <ResultPanel
                    {service}
                    {results}
                    questions={session.questions}
                    {analysis}
                    {duration}
                    onsave={() => void saveToDoc(false)}
                    onsavewrong={() => void saveToDoc(true)}
                    {savingDoc}
                    onretrywrong={retryWrong}
                    ondiscard={closeTab}
                />
            {/if}
        {/if}
    </div>
</div>

<!-- 统一的二次确认对话框：ESCAPE 关闭安全，也不会像原自建弹窗那样泄漏未决 Promise -->
<AlertDialog.Root open={pending !== null} onOpenChange={(open) => !open && (pending = null)}>
    <AlertDialog.Content>
        <AlertDialog.Header>
            <AlertDialog.Title>{pending?.title ?? ""}</AlertDialog.Title>
            <AlertDialog.Description>{pending?.description ?? ""}</AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
            <AlertDialog.Cancel>{t("common.cancel")}</AlertDialog.Cancel>
            <AlertDialog.Action
                onclick={() => {
                    const action = pending?.run;
                    pending = null;
                    action?.();
                }}
            >
                {pending?.confirmLabel ?? t("common.confirm")}
            </AlertDialog.Action>
        </AlertDialog.Footer>
    </AlertDialog.Content>
</AlertDialog.Root>
