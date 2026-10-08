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
    import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
    import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
    import FlagIcon from "@lucide/svelte/icons/flag";
    import { showMessage } from "siyuan";
    import * as AlertDialog from "@/lib/components/ui/alert-dialog";
    import { Badge } from "@/lib/components/ui/badge";
    import { Button } from "@/lib/components/ui/button";
    import * as Card from "@/lib/components/ui/card";
    import { describeError, type ErrorDescription } from "../ai/errors";
    import { isAbortError } from "../ai/client";
    import { copyText } from "./clipboard";
    import { formatClock } from "./duration";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import type { DateGenConfig, QuizService, QuizTabData } from "../quiz/service";
    import { planBatches } from "../quiz/batching";
    import type { GenPhase, GenStats } from "../quiz/generator";
    import { genProgress } from "../quiz/gen-progress";
    import { PASS_SCORE } from "@/types/quiz";
    import type { AIProtocol } from "@/types/config";
    import type { GradingResult, PanelState, QuizSession, UserAnswer } from "@/types/quiz";
    import GenPlan from "./GenPlan.svelte";
    import GenSteps from "./GenSteps.svelte";
    import ProgressBar from "./ProgressBar.svelte";
    import QuestionView from "./QuestionView.svelte";
    import ResultPanel from "./ResultPanel.svelte";
    import StateBlock from "./StateBlock.svelte";
    import { rise } from "./motion";

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
    /**
     * 分析失败的原因。
     * 失败时不把错误文案塞进 analysis：那份文案要展示给用户，
     * 但不该被写进笔记，也不该当作「薄弱点分析」喂给答疑模型。
     */
    let analysisError = $state<string | null>(null);
    /**
     * 判分之后的步骤（成绩落盘 / 清理进度 / 排程更新）失败的原因。
     * 此时结果已经算出来了，必须展示结果，但不能让用户以为已保存。
     */
    let submitError = $state<ErrorDescription | null>(null);
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

    /* ── 生成过程信息展示 ────────────────────────────────────────── */

    /** 生成过程的实时快照（阶段/批次/已收集/已丢弃），由生成器回调推送 */
    let genStats = $state<GenStats | null>(null);
    /** 「已用时」按开始时间戳算，避免 setInterval 被后台节流后走慢 */
    let genStartedAt: number | null = null;
    let genElapsed = $state(0);
    let genTimer: ReturnType<typeof setInterval> | undefined;

    function beginGenTimer(): void {
        stopGenTimer();
        genStats = null;
        genElapsed = 0;
        genStartedAt = Date.now();
        genTimer = setInterval(() => {
            if (genStartedAt !== null) genElapsed = Math.floor((Date.now() - genStartedAt) / 1000);
        }, 500);
    }

    function stopGenTimer(): void {
        if (genTimer !== undefined) clearInterval(genTimer);
        genTimer = undefined;
        genStartedAt = null;
    }

    /**
     * 生成阶段名。
     * 用显式 t() 而不是查表：字典死键检查靠扫描 t() 调用里的字符串字面量，
     * 放进对象字面量里会被判成「没人用的键」。
     */
    function phaseLabel(phase: GenPhase): string {
        if (phase === "reviewing") return t("gen.phase.reviewing");
        if (phase === "regenerating") return t("gen.phase.regenerating");
        return t("gen.phase.generating");
    }

    /* ── 答题用时 ────────────────────────────────────────────────── */

    let answerStartedAt = $state<number | null>(null);
    let answerElapsed = $state(0);
    let answerTimer: ReturnType<typeof setInterval> | undefined;

    function beginAnswerTimer(): void {
        stopAnswerTimer();
        answerStartedAt = Date.now();
        answerElapsed = 0;
        answerTimer = setInterval(() => {
            if (answerStartedAt !== null) answerElapsed = Math.floor((Date.now() - answerStartedAt) / 1000);
        }, 1000);
    }

    function stopAnswerTimer(): void {
        if (answerTimer !== undefined) clearInterval(answerTimer);
        answerTimer = undefined;
    }

    function protocolLabel(protocol: AIProtocol | undefined): string {
        if (protocol === "responses") return "Responses API";
        if (protocol === "messages") return "Messages API";
        return "Chat Completions";
    }

    async function copyRaw(text: string): Promise<void> {
        const ok = await copyText(text);
        showMessage(ok ? t("err.raw.copied") : t("err.raw.failed"), ok ? 2000 : 6000, ok ? "info" : "error");
    }

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

    /* ── 出题计划展示用的派生值（依赖 config，必须声明在它之后）──────── */

    const genModel = $derived(config.ai.models.find((m) => m.id === config.ai.roles.generator));
    const genModelName = $derived(genModel?.name ?? "");
    // 协议挂在端点上，不在模型上
    const genProtocol = $derived(
        protocolLabel(config.ai.endpoints.find((ep) => ep.id === genModel?.endpointId)?.protocol)
    );
    const reviewerName = $derived(
        config.ai.roles.reviewer
            ? (config.ai.models.find((m) => m.id === config.ai.roles.reviewer)?.name ?? null)
            : null
    );
    const plannedBatches = $derived(Math.max(1, planBatches(config.general.difficulty).length));

    const questions = $derived(session?.questions ?? []);
    const answeredCount = $derived(questions.filter((q) => !!session?.answers[q.id]).length);
    /** 出题计划只在生成阶段展示；判分阶段没有它，布局也要跟着退回单列 */
    const showGenPlan = $derived(panelState === "loading_generating");

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

    /** 未作答的题目下标列表（按题序） */
    const unansweredIndices = $derived(
        questions.map((q, i) => (session?.answers[q.id] ? -1 : i)).filter((i) => i >= 0)
    );

    /** 跳到下一道未作答的题目 */
    function goToNextUnanswered(): void {
        if (unansweredIndices.length === 0) return;
        const next = unansweredIndices.find((i) => i > activeIndex) ?? unansweredIndices[0];
        goToQuestion(next);
    }

    /** 被标记的题目下标列表（按题序） */
    const flaggedIndices = $derived(questions.map((q, i) => (session?.flagged?.[q.id] ? i : -1)).filter((i) => i >= 0));

    /**
     * 跳到下一道标记题：从当前题往后找，到末尾再从头找（循环）。
     * 没有标记题时不做任何事（按钮同时也会置灰）。
     */
    function goToNextFlagged(): void {
        if (flaggedIndices.length === 0) return;
        const next = flaggedIndices.find((i) => i > activeIndex) ?? flaggedIndices[0];
        goToQuestion(next);
    }

    const countdownText = $derived(formatClock(countdownLeft));

    /* ── 生命周期 ────────────────────────────────────────────────── */

    /** 面板根节点，用于判断自身是否可见（见 isPanelVisible） */
    let rootEl: HTMLElement | null = $state(null);

    onDestroy(() => {
        window.removeEventListener("keydown", onKeydown);
        if (saveTimer) clearTimeout(saveTimer);
        stopCountdown();
        stopGenTimer();
        stopAnswerTimer();
    });

    /**
     * 进入答题状态就开始计时，离开就停。
     * 放在 effect 里而不是各个入口分别调用：恢复会话、按日期出题、复习到期
     * 都会进入 answering，逐个添加迟早会漏掉一个。
     */
    $effect(() => {
        if (panelState === "answering" && questions.length > 0) beginAnswerTimer();
        else stopAnswerTimer();
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
            const { dueTag: tag, dueType: type, dueDifficulty: difficulty, cram } = tabData;
            // 按知识点/题型复习时允许提前复习：用户是想练这一类题，不该被排程挡住，
            // 因此只有题库里根本没有这类题目时才会走到空态
            const due = await service.dueBankQuestions({
                limit: cram ? 0 : config.general.reviewLimit,
                sourceDocId: tabData.dueSourceDocId,
                tag,
                type,
                difficulty,
                ahead: Boolean(tag || type || difficulty),
                cram,
            });
            if (cancelled) return;
            if (due.length === 0) {
                error = {
                    title: t("bank.noDueTitle"),
                    hint: tag
                        ? t("bank.noTagQuestions", tag)
                        : type
                          ? t("bank.noTypeQuestions", t(`type.${type}`))
                          : difficulty
                            ? t("bank.noDifficultyQuestions", t(`diff.${difficulty}`))
                            : cram
                              ? t("bank.cramEmpty")
                              : t("bank.noDueHint"),
                    detail: t("bank.noDueDetail"),
                };
                panelState = "answering";
                return;
            }
            // 被题量上限截断时说明还剩多少，否则用户会以为到期题目只有这些
            if (config.general.reviewLimit > 0) {
                const summary = await service.bankSummary().catch(() => null);
                if (summary && summary.due > due.length) {
                    showMessage(t("bank.reviewLimitNotice", String(due.length), String(summary.due)), 8000);
                }
            }
            if (cancelled) return;

            session = {
                id: genId(),
                sourceDocId: tabData.sourceDocId,
                sourceTitle: tag
                    ? t("bank.sessionTitleTag", tag, String(due.length))
                    : type
                      ? t("bank.sessionTitleType", t(`type.${type}`), String(due.length))
                      : difficulty
                        ? t("bank.sessionTitleType", t(`diff.${difficulty}`), String(due.length))
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
        beginGenTimer();
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
        } finally {
            stopGenTimer();
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
        beginGenTimer();
        try {
            const generated = await service.generate(
                tabData.content ?? "",
                (phase, round, detail, stats) => {
                    progressLabel = detail;
                    /*
                     * 进度按「阶段权重 + 阶段内真实推进」算，而不是原实现的 round * 30：
                     * 后者让生成阶段永远是不确定条，之后每轮跳 30%，与实际工作量无关。
                     * 拿不到实时数据时 genProgress 返回 null，交回不确定进度条。
                     */
                    progressValue = genProgress(phase, round, stats);
                    // 生成器每批都会推送一次快照，界面据此显示「已收集 N 题 / 第 i/n 批」
                    if (stats) genStats = stats;
                },
                signal
            );
            if (cancelled) return;
            if (generated.length === 0) {
                error = { title: t("err.generic.title"), hint: t("err.generic.hint"), detail: t("quiz.noQuestions") };
                panelState = "answering";
                return;
            }
            // 模型少给题时原先只是静默少给：这里按请求题数对比并提示，
            // 让用户知道可以重试或降低题量，而不是以为设置没生效
            const requested = config.general.difficulty.total;
            if (tabData.mode !== "reviewDue" && generated.length < requested) {
                showMessage(t("quiz.fewerQuestions", String(requested), String(generated.length)), 8000);
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
        } finally {
            stopGenTimer();
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
        /*
         * 用时必须在判分之前结算。
         * 原先在 await service.grade(...) 之后才计算，于是判分耗时（主观题要调 AI，
         * 可能好几秒）被算进了「用时」——结果页与导出的耗时都偏大。
         */
        duration = Math.round((Date.now() - session.createdAt) / 1000);
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
                analysisError = null;
                submitError = null;
                await service.updateScoreAnalysis(scoreId, analysis);
            } catch (e) {
                analysis = null;
                analysisError = (e as Error).message;
            }
            submitError = null;
            panelState = "result";
        } catch (e) {
            error = describeError(e);
            // 判分成功后的失败（成绩落盘等）不应让结果不可见——用户已经答完了。
            // 但必须明确告知保存没有成功，否则用户以为一切正常，成绩记录其实丢了。
            submitError = describeError(e);
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
        analysisError = null;
        submitError = null;
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
        const flaggedUnanswered = questions.filter((q) => session?.flagged?.[q.id] && !session?.answers[q.id]).length;
        let description: string;
        if (unanswered > 0 && flaggedUnanswered > 0) {
            description = t("quiz.confirmSubmitUnansweredFlagged", String(unanswered), String(flaggedUnanswered));
        } else if (unanswered > 0) {
            description = t("quiz.confirmSubmitUnanswered", String(unanswered));
        } else if (flaggedCount > 0) {
            description = t("quiz.confirmSubmitFlagged", String(flaggedCount));
        } else {
            description = t("quiz.confirmSubmitMsg");
        }
        pending = {
            title: t("quiz.confirmSubmitTitle"),
            description,
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
    <!--
        @container 让内部可以用容器变体（@3xl: 等）而不是视口断点。
        插件面板的可用宽度与视口无关：思源的 tab 可以很窄，设置弹窗永远比视口窄，
        用 sm:/md: 判断「该收成几栏」从根上就是错的。
    -->
    <div class="@container mx-auto flex h-full w-full flex-col px-4" style="max-width: var(--rg-panel-width, 1100px)">
        {#if panelState === "configuring"}
            <!--
                配置页自适应。
                原实现是一张 max-w-xl（576px）的卡居中，宽面板下左右各空出四百像素；
                现在放宽到 64rem，并在容器够宽时把「出题计划」与「参数」并排两栏——
                前者是只读概览、后者是要调的东西，分开之后一眼能看出「改哪儿、影响什么」。
            -->
            <div class="rg-safe-center flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-6">
                <Card.Root class="h-fit w-full max-w-4xl">
                    <Card.Header>
                        <Card.Title>{t("quiz.dateConfigTitle")}</Card.Title>
                        <Card.Description>
                            {tabData.dateRange === "today"
                                ? t("quiz.dateConfigTodayDesc")
                                : t("quiz.dateConfigBeforeDesc")}
                        </Card.Description>
                    </Card.Header>
                    <Card.Content class="grid grid-cols-1 items-start gap-5 @3xl:grid-cols-2">
                        <!-- 出题计划：让用户在生成前确认题型/难度/模型/结构化输出 -->
                        <GenPlan
                            sourceTitle={tabData.sourceTitle}
                            difficulty={config.general.difficulty}
                            types={config.general.allowedTypes}
                            batches={plannedBatches}
                            modelName={genModelName}
                            protocol={genProtocol}
                            structured={config.ai.jsonSchemaEnabled}
                            reviewer={reviewerName}
                        />

                        <!-- 右栏与左侧的出题计划用同一种面板底，两栏才读得出是并列关系 -->
                        <div class="bg-muted/40 flex flex-col gap-5 rounded-md border p-3">
                            <!-- 日期范围 -->
                            {#if tabData.dateRange === "beforeToday"}
                                <div class="flex flex-col gap-2">
                                    <div class="flex items-center justify-between">
                                        <label class="text-sm font-medium" for="rg-date-days"
                                            >{t("quiz.dateDaysLabel")}</label
                                        >
                                        <span class="text-rg-accent text-sm font-semibold tabular-nums">
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
                        </div>
                    </Card.Content>
                    <Card.Footer class="flex gap-2">
                        <Button onclick={startDateGenerate}>{t("quiz.dateGenerate")}</Button>
                        <Button variant="ghost" onclick={closeTab}>{t("common.cancel")}</Button>
                    </Card.Footer>
                </Card.Root>
            </div>
        {:else if panelState === "loading_generating" || panelState === "loading_grading"}
            <div class="rg-safe-center flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-6">
                <!--
                    只做进场（in:），不做退场。
                    这里是一整屏状态容器：用 transition: 会在切到结果页时给旧内容播一段
                    淡出，于是「生成中」与「结果页」会有 200ms 同时挂在 DOM 里、上下叠着；
                    更糟的是面板不在前台时（思源里切到别的 tab）WAAPI 动画会被浏览器暂停，
                    退场永远播不完，旧界面就一直在那不退。进场动效没有这个问题。
                -->
                <div class="flex w-full max-w-5xl flex-col gap-4" in:rise={{ y: 8 }}>
                    <!--
                        容器够宽时进度卡与出题计划并排：进度是「正在发生什么」、
                        计划是「按什么在生成」，两栏并看比上下堆叠更好读，
                        也避免宽面板中间只剩一列 672px 的窄条。
                        只有生成阶段有出题计划，判分阶段退回单列占满整宽。
                    -->
                    <div class={cn("grid grid-cols-1 items-start gap-4", showGenPlan && "@3xl:grid-cols-2")}>
                        <!--
                        进度卡：原实现是一张 max-w-2xl 的小卡悬在整屏中间，
                        进度条和四格统计各占一行却互不对齐，看着像没做完的临时页面。
                        现在收成一张有明确层级的卡：标题行（阶段 + 用时）、步骤条、
                        进度条、统计行，全部左对齐同一列。
                    -->
                        <Card.Root>
                            <Card.Header>
                                <div class="flex flex-wrap items-baseline justify-between gap-2">
                                    <Card.Title>
                                        {panelState === "loading_generating" ? t("gen.progress.title") : progressLabel}
                                    </Card.Title>
                                    {#if panelState === "loading_generating"}
                                        <span class="text-muted-foreground text-xs tabular-nums">
                                            {t("gen.progress.elapsed")}
                                            {t("gen.progress.seconds", String(genElapsed))}
                                        </span>
                                    {/if}
                                </div>
                            </Card.Header>

                            <Card.Content class="flex flex-col gap-4">
                                {#if panelState === "loading_generating"}
                                    <GenSteps
                                        phase={genStats?.phase ?? "generating"}
                                        hasReviewer={!!config.ai.roles.reviewer}
                                    />
                                {/if}

                                <ProgressBar
                                    value={progressValue}
                                    label={progressLabel}
                                    size="md"
                                    showValue={progressValue !== null}
                                />

                                {#if panelState === "loading_generating"}
                                    <!--
                                    实时信息：光看进度条不知道「生成到哪了、有没有丢题」。
                                    批次与收题数是同一组口径，并排放在一行里读起来才连得上。
                                -->
                                    <!--
                                    用容器变体而不是 sm:：面板可用宽度与视口无关。
                                    容器刻度比视口刻度小得多（@3xl = 48rem），这里要的是
                                    「面板本身够宽才排四栏」。
                                -->
                                    <dl class="grid grid-cols-2 gap-x-4 gap-y-3 @3xl:grid-cols-4">
                                        <div class="flex flex-col gap-0.5">
                                            <dt class="text-muted-foreground text-xs">{t("gen.stat.batch")}</dt>
                                            <dd class="text-sm font-medium tabular-nums">
                                                {t(
                                                    "gen.stat.batchValue",
                                                    String(genStats?.batch ?? 1),
                                                    String(genStats?.batches ?? plannedBatches)
                                                )}
                                            </dd>
                                        </div>
                                        <div class="flex flex-col gap-0.5">
                                            <dt class="text-muted-foreground text-xs">{t("gen.stat.collected")}</dt>
                                            <dd class="text-sm font-medium tabular-nums">
                                                {genStats?.collected ?? 0}
                                                <span class="text-muted-foreground font-normal">
                                                    / {genStats?.target ?? config.general.difficulty.total}
                                                </span>
                                            </dd>
                                        </div>
                                        <div class="flex flex-col gap-0.5">
                                            <dt class="text-muted-foreground text-xs">{t("gen.stat.dropped")}</dt>
                                            <dd
                                                class={cn(
                                                    "text-sm font-medium tabular-nums",
                                                    (genStats?.dropped ?? 0) > 0 && "text-warning"
                                                )}
                                            >
                                                {genStats?.dropped ?? 0}
                                            </dd>
                                        </div>
                                        <div class="flex flex-col gap-0.5">
                                            <dt class="text-muted-foreground text-xs">{t("gen.stat.phase")}</dt>
                                            <dd class="text-sm font-medium">
                                                {genStats ? phaseLabel(genStats.phase) : t("gen.phase.generating")}
                                            </dd>
                                        </div>
                                    </dl>

                                    {#if genStats?.note}
                                        <p class="text-warning text-xs">{genStats.note}</p>
                                    {/if}
                                {/if}
                            </Card.Content>

                            {#if panelState === "loading_generating"}
                                <Card.Footer>
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
                                </Card.Footer>
                            {/if}
                        </Card.Root>

                        {#if panelState === "loading_generating"}
                            <GenPlan
                                sourceTitle={tabData.sourceTitle}
                                chars={tabData.content?.length ?? 0}
                                difficulty={config.general.difficulty}
                                types={config.general.allowedTypes}
                                batches={plannedBatches}
                                modelName={genModelName}
                                protocol={genProtocol}
                                structured={config.ai.jsonSchemaEnabled}
                                reviewer={reviewerName}
                            />
                        {/if}
                    </div>
                </div>
            </div>
        {:else if panelState === "answering"}
            {#if error && questions.length === 0}
                <div class="mx-auto flex max-w-lg flex-col items-center gap-3 px-4 py-20 text-center">
                    <h3 class="text-destructive text-lg font-semibold">{error.title}</h3>
                    <pre
                        class="bg-muted text-muted-foreground max-h-32 w-full overflow-auto rounded-md p-3 text-left text-xs">{error.detail}</pre>
                    <p class="text-muted-foreground text-sm">{error.hint}</p>
                    {#if error.raw}
                        <!-- 解析类失败只看一句报错无从排查：把模型原文摊开，能直接看出是截断还是形状不对 -->
                        <details class="bg-muted/40 w-full rounded-md border p-3 text-left">
                            <summary class="text-muted-foreground cursor-pointer text-xs font-medium">
                                {t("err.raw.title")}
                                <span class="text-2xs">{t("err.raw.size", String(error.raw.length))}</span>
                            </summary>
                            <pre
                                class="text-muted-foreground mt-2 max-h-60 overflow-auto text-2xs break-all whitespace-pre-wrap">{error.raw}</pre>
                            <Button
                                variant="outline"
                                size="sm"
                                class="mt-2"
                                onclick={() => void copyRaw(error?.raw ?? "")}
                            >
                                {t("err.raw.copy")}
                            </Button>
                        </details>
                    {/if}
                    <Button onclick={() => void retry()}>{t("common.retry")}</Button>
                </div>
            {:else if questions.length === 0}
                <!-- 补齐空态：恢复到一个空会话时原实现会整屏空白 -->
                <StateBlock
                    kind="empty"
                    icon="📄"
                    title={t("quiz.emptySession")}
                    description={t("quiz.emptySessionHint")}
                />
            {:else}
                <!--
                    顶栏重排。
                    原实现把「下一道未答题 / 已标记 / 下一道标记题 / 倒计时」与
                    「← 1/8 → / 重新生成」塞进同一个 flex-wrap 行，两侧各自折行后
                    高矮不齐、间距也不一致；进度条又被 ProgressBar 内部写死的
                    max-w-md 截到 448px 宽，右侧半屏空白。
                    现在拆成「工具行 + 进度条」两行：工具行里题序导航独立成组、
                    状态徽标居中、次要操作靠右，控件高度统一 h-7；进度条独占一行铺满。
                -->
                <header class="border-border flex shrink-0 flex-col gap-2 border-b py-2">
                    <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                        <div class="border-border flex items-center gap-0.5 rounded-md border p-0.5">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                disabled={activeIndex <= 0}
                                onclick={() => goToQuestion(activeIndex - 1)}
                                aria-label={t("quiz.prevQuestion")}
                                title={t("quiz.prevQuestion")}
                            >
                                <ChevronLeftIcon />
                            </Button>
                            <span
                                class="text-muted-foreground min-w-11 text-center text-xs tabular-nums"
                                aria-live="polite"
                            >
                                {activeIndex + 1}/{questions.length}
                            </span>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                disabled={activeIndex >= questions.length - 1}
                                onclick={() => goToQuestion(activeIndex + 1)}
                                aria-label={t("quiz.nextQuestion")}
                                title={t("quiz.nextQuestion")}
                            >
                                <ChevronRightIcon />
                            </Button>
                        </div>

                        {#if countdownEnabled}
                            <Badge
                                variant={countdownLeft <= 60 ? "destructive" : "warning"}
                                class="h-7 px-2 tabular-nums"
                            >
                                {countdownText}
                            </Badge>
                        {/if}

                        {#if flaggedCount > 0}
                            <Badge variant="outline" class="h-7 px-2">
                                {t("quiz.flaggedCount", String(flaggedCount))}
                            </Badge>
                        {/if}

                        <div class="ml-auto flex flex-wrap items-center gap-1.5">
                            {#if unansweredIndices.length > 0}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onclick={goToNextUnanswered}
                                    title={t("quiz.nextUnansweredHint")}
                                >
                                    {t("quiz.nextUnanswered")}
                                </Button>
                            {/if}
                            {#if flaggedCount > 0}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onclick={goToNextFlagged}
                                    title={t("quiz.nextFlaggedHint")}
                                >
                                    {t("quiz.nextFlagged")}
                                </Button>
                            {/if}
                            <Button variant="ghost" size="sm" onclick={askRegenerate}>{t("quiz.regenerate")}</Button>
                        </div>
                    </div>

                    <ProgressBar value={progressPct} label={t("quiz.progress", answeredText)} showValue />
                </header>

                <!-- 题号导航：长试卷时不必靠滚动找题；已答/未答一眼可见 -->
                <div
                    class="flex flex-wrap items-center gap-1.5 py-2"
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
                                    <!--
                                        标记：原先是一个文字按钮加 ml-auto，
                                        面板一宽就被推到最右侧、离题干隔了半屏；
                                        换成图标按钮后既省空间，位置也稳定。
                                    -->
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        class={cn("ml-auto", session?.flagged?.[q.id] && "text-warning bg-warning/10")}
                                        aria-pressed={!!session?.flagged?.[q.id]}
                                        aria-label={session?.flagged?.[q.id] ? t("quiz.unflag") : t("quiz.flag")}
                                        title={session?.flagged?.[q.id] ? t("quiz.unflag") : t("quiz.flag")}
                                        onclick={() => toggleFlag(q.id)}
                                    >
                                        <FlagIcon />
                                    </Button>
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

                <!--
                    交卷栏固定在面板底部：它是 flex 列的最后一个子项、
                    而滚动发生在上面那个题目列表内部，所以始终可见。
                    原实现把它写成 `sticky bottom-0` 且放在题号导航之前，
                    结果它停在进度条下方（滚不动也就吸不了底），
                    交卷按钮在页面顶部出现两次，长试卷滚到底也看不到交卷栏。
                -->
                <div
                    class="border-border bg-background/95 flex shrink-0 items-center justify-between gap-2 border-t px-1 py-2"
                >
                    <div class="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                        <span>{t("quiz.answered", String(answeredCount), String(questions.length))}</span>
                        {#if flaggedCount > 0}
                            <span class="text-warning">{t("quiz.flaggedCount", String(flaggedCount))}</span>
                        {/if}
                        <span>{t("quiz.elapsed", formatClock(answerElapsed))}</span>
                    </div>
                    <Button variant="destructive" size="sm" onclick={askSubmit}>{t("quiz.submit")}</Button>
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
                <!--
                    结果页自己滚动：它是最长的页面，原先直接挂在 h-full 的列里，
                    能否滚到只取决于外层容器（思源 tab 体）的 overflow，
                    遇到裁剪型容器就会出现「一键出结果但看不到按钮」。
                -->
                <div class="min-h-0 flex-1 overflow-y-auto">
                    <ResultPanel
                        {service}
                        {results}
                        questions={session.questions}
                        {analysis}
                        {analysisError}
                        {submitError}
                        sourceDocId={session.sourceDocId}
                        sourceTitle={session.sourceTitle}
                        {duration}
                        onsave={() => void saveToDoc(false)}
                        onsavewrong={() => void saveToDoc(true)}
                        {savingDoc}
                        onretrywrong={retryWrong}
                        ondiscard={closeTab}
                    />
                </div>
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
