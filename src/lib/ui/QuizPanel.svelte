<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import ProgressBar from "./ProgressBar.svelte";
    import QuestionView from "./QuestionView.svelte";
    import ResultPanel from "./ResultPanel.svelte";
    import { showMessage, Dialog } from "siyuan";
    import { button, badge, card, alert, alertTitle, alertDescription, cn } from "./components";
    import type { QuizService, QuizTabData, DateGenConfig } from "../quiz/service";
    import type { GradingResult, PanelState, Question, QuizSession, UserAnswer } from "@/types/quiz";

    export let service: QuizService;
    export let tabData: QuizTabData;
    export let closeTab: () => void = () => {};

    let panelState: PanelState = "loading_generating";
    let dateCfg: DateGenConfig = { days: 7, baseHour: 0, baseMinute: 0 };
    let session: QuizSession | null = null;
    let error: string | null = null;
    let errorPhase: "generate" | "grade" | "other" = "other";
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
        // HTTP 状态错误
        const httpMatch = msg.match(/HTTP (\d+)/);
        if (httpMatch) {
            const code = parseInt(httpMatch[1]);
            if (code === 400)
                return { title: "请求被拒绝（400）", detail: msg, hint: "可能是 response_format 不被网关支持，请在设置中关闭 JSON Schema 严格模式" };
            if (code === 401 || code === 403)
                return { title: "认证失败（" + code + "）", detail: msg, hint: "请检查 API Key 和 Base URL 是否正确" };
            if (code === 429)
                return { title: "请求频率超限（429）", detail: msg, hint: "API 调用过于频繁，请稍后重试或更换 Key" };
            if (code >= 500)
                return { title: "AI 服务端错误（" + code + "）", detail: msg, hint: "AI 服务暂不可用，请稍后重试" };
            return { title: "网络错误（" + code + "）", detail: msg, hint: "请检查 Base URL 和网络连接" };
        }
        // 配置错误
        if (msg.includes("未配置") || msg.includes("未设置"))
            return { title: "配置不完整", detail: msg, hint: "请在设置中完成 AI 服务配置后再试" };
        // 超时
        if (msg.includes("timeout") || msg.includes("超时"))
            return { title: "请求超时", detail: msg, hint: "AI 生成耗时过长，请在设置中增大超时时间" };
        // JSON 解析
        if (msg.includes("JSON") || msg.includes("解析"))
            return { title: "AI 响应解析失败", detail: msg, hint: "模型返回格式异常，建议开启 JSON Schema 或更换模型" };
        return { title: "发生错误", detail: msg, hint: "请检查配置后重试" };
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
                if (countdownEnabled) { countdownLeft = countdownSec; startCountdown(); }
            } else {
                await startGenerate();
            }
        } else if (tabData.mode === "dateGenerate") {
            // 先检查是否有已保存的进度
            const existing = await service.findProgressBySourceDocId(tabData.sourceDocId);
            if (existing && existing.questions.length > 0) {
                session = existing;
                panelState = "answering";
                if (countdownEnabled) { countdownLeft = countdownSec; startCountdown(); }
            } else {
                panelState = "configuring";
            }
        } else {
            error = "无效的 Tab 数据";
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
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        if (session && panelState === "answering") {
            void service.saveProgress(session);
        }
    }

    /** 检查 AI 配置是否有效 */
    function checkAiConfig(): boolean {
        const ai = config.ai;
        if (!ai.models || ai.models.length === 0) {
            error = "未配置任何 AI 模型，请先在设置中添加端点和模型";
            return false;
        }
        const genModel = ai.models.find((m) => m.id === ai.roles.generator);
        if (!genModel) {
            error = "出题者模型未配置，请在 AI 身份中指定";
            return false;
        }
        const ep = ai.endpoints.find((e) => e.id === genModel.endpointId);
        if (!ep) {
            error = "出题者模型引用的端点不存在，请检查配置";
            return false;
        }
        if (ep.provider !== "ollama" && !ep.apiKey) {
            error = "API Key 未配置，请先在设置中填写";
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
            errorPhase = "generate";
            return;
        }
        panelState = "loading_generating";
        progressValue = null;
        progressLabel = "正在加载笔记内容…";
        try {
            const { content, title } = await service.loadDateRangeContent(
                dateCfg,
                tabData.dateRange ?? "beforeToday",
                tabData.notebookId,
            );
            if (cancelled) return;
            tabData.content = content;
            tabData.sourceTitle = title;
            await startGenerate();
        } catch (e) {
            if (cancelled) return;
            error = (e as Error).message;
            errorPhase = "generate";
            panelState = "configuring";
        }
    }

    async function startGenerate() {
        error = null;
        cancelled = false;
        if (!checkAiConfig()) {
            panelState = "answering";
            errorPhase = "generate";
            return;
        }
        panelState = "loading_generating";
        progressValue = null;
        progressLabel = "AI 正在生成题目…";
        try {
            const qs = await service.generate(tabData.content ?? "", (phase, round, detail) => {
                progressLabel = detail;
                if (phase === "generating") progressValue = null;
                else progressValue = round * 30;
            });
            if (cancelled) return;
            if (qs.length === 0) {
                error = "AI 未生成任何题目，请检查内容或重试";
                errorPhase = "generate";
                panelState = "answering";
                return;
            }
            const id = genId();
            session = { id, sourceDocId: tabData.sourceDocId, sourceTitle: tabData.sourceTitle, questions: qs, createdAt: Date.now(), answers: {} };
            const prev = await service.loadProgress(id);
            if (cancelled) return;
            if (prev) session.answers = prev.answers;
            panelState = "answering";
            if (countdownEnabled) { countdownLeft = countdownSec; startCountdown(); }
        } catch (e) {
            if (cancelled) return;
            error = (e as Error).message;
            errorPhase = "generate";
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
            // 判分完成后立即保存成绩，不受后续分析影响
            const totalScore = results.reduce((s, r) => s + r.score, 0);
            const maxScore = results.reduce((s, r) => s + r.maxScore, 0);
            await service.saveScore({ id: genId(), quizId: session.id, title: session.sourceTitle, timestamp: Date.now(), totalScore, maxScore, questionCount: session.questions.length, detail: results });
            await service.clearProgress(session.id);
            // 薄弱点分析失败不影响成绩记录
            progressLabel = "正在生成薄弱点分析…";
            progressValue = null;
            try {
                analysis = await service.analyze(results, session.questions);
            } catch (e) {
                analysis = `薄弱点分析失败：${(e as Error).message}`;
            }
            panelState = "result";
        } catch (e) {
            error = (e as Error).message;
            errorPhase = "grade";
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
    async function saveToDoc(wrongOnly: boolean) {
        if (!session || !results) return;
        try {
            await service.saveResultToDoc(session, analysis ?? "", results, wrongOnly);
            showMessage(wrongOnly ? "已保存错题到文档" : "已保存到文档");
        } catch (e) { error = (e as Error).message; }
    }
    async function retryGenerate() {
        error = null;
        await startGenerate();
    }
    async function confirmRegenerate() {
        const ok = await confirmAction("重新生成", "确定要放弃当前题目并重新生成吗？");
        if (ok) await regenerate();
    }
    async function confirmSubmit() {
        const ok = await confirmAction("交卷", "确定要提交答案吗？提交后不可修改。");
        if (ok) await submit();
    }
    async function regenerate() {
        if (session) { await service.clearProgress(session.id); }
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
            btns[0].addEventListener("click", () => { resolve(false); dialog.destroy(); });
            btns[1].addEventListener("click", () => { resolve(true); dialog.destroy(); });
        });
    }
    function typeLabel(t: string): string {
        const m: Record<string, string> = {
            single_choice: "单选", multiple_choice: "多选", fill_blank: "填空",
            true_false: "判断", subjective: "简答", coding: "编程",
        };
        return m[t] ?? t;
    }
    function diffLabel(d: string): string {
        const m: Record<string, string> = { easy: "初级", medium: "中级", hard: "高级" };
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
                    <h3 class="rg-config__title">📅 日期范围配置</h3>
                    <p class="rg-config__desc">
                        {tabData.dateRange === "today" ? "今日笔记模式：基点时间定义「今日」的起始。例如设为 04:00，则今日范围为 4:00 至现在。" : "近 N 天模式：基点时间为每日分界点。例如设为 04:00，则从 N 天前 4:00 到今日 4:00 之间的笔记。"}
                    </p>
                    {#if tabData.dateRange === "beforeToday"}
                        <div class="rg-config__row">
                            <label>天数范围</label>
                            <span class="rg-config__val">{dateCfg.days === 0 ? "基点之前全部" : `${dateCfg.days} 天`}</span>
                        </div>
                        <input class="rg-slider" type="range" min="0" max="90" step="1" bind:value={dateCfg.days} />
                        <p class="rg-config__hint">0 = 基点时间之前的所有笔记</p>
                    {/if}
                    <div class="rg-config__row">
                        <label>基点时间</label>
                        <input class="rg-time-input" type="time" bind:value={dateBaseTime} on:change={onBaseTimeChange} />
                    </div>
                    <p class="rg-config__hint">过了此时间点算作第二天。适合凌晨写笔记的用户。</p>
                    <div class="rg-config__actions">
                        <button class={button({ variant: "default" })} on:click={startDateGenerate}>生成复习题</button>
                        <button class={button({ variant: "ghost", size: "sm" })} on:click={closeTab}>取消</button>
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
                <button class={button({ variant: "outline", size: "sm" })} on:click={() => { cancelled = true; closeTab(); }}>取消生成</button>
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
                    <button class={button({ variant: "default" })} on:click={retryGenerate}>重试</button>
                </div>
            </div>
        {:else if questions.length > 0}
            <header class="rg-panel__topbar">
                <div class="rg-panel__topbar-left">
                    <span class={badge("secondary")}>已答 {answeredCount} / {questions.length}</span>
                </div>
                <div class="rg-panel__topbar-right">
                    {#if countdownEnabled}
                        <span class={badge("warning")}>⏱ {Math.floor(countdownLeft / 60)}:{(countdownLeft % 60).toString().padStart(2, "0")}</span>
                    {/if}
                    <button class={button({ variant: "outline", size: "sm" })} on:click={confirmRegenerate}>重新生成</button>
                    <button class={button({ variant: "destructive" })} on:click={confirmSubmit}>交卷</button>
                </div>
            </header>
            <div class="rg-panel__scroll">
                <div class="rg-panel__list">
                    {#each questions as q, i}
                        <div class="rg-panel__q-item">
                            <div class="rg-panel__q-header">
                                <span class={badge("secondary")}>第 {i + 1} 题</span>
                                <span class={badge(diffBadge(q.difficulty))}>{diffLabel(q.difficulty)}</span>
                                <span class={badge("outline")}>{typeLabel(q.type)}</span>
                                {#if isAnswered(q)}<span class={badge("success")}>已答</span>{/if}
                            </div>
                            <QuestionView question={q} answer={session?.answers[q.id]} on:change={(e) => onAnswer(q.id, e.detail)} />
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
                    <button class={button({ variant: "default" })} on:click={retryGrade}>重试判分</button>
                </div>
            </div>
        {:else if results && session}
            <ResultPanel {service} results={results} questions={session.questions} {analysis} on:save={() => saveToDoc(false)} on:saveWrong={() => saveToDoc(true)} on:discard={() => closeTab()} />
        {/if}
    {/if}
    </div>
</div>

<style>
    .rg-panel { display: flex; flex-direction: column; height: 100%; }
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
    .rg-panel__loading { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 24px; gap: 16px; }
    .rg-panel__topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 8px 0;
        border-bottom: 1px solid var(--b3-border-color);
        flex-shrink: 0;
    }
    .rg-panel__topbar-left { display: flex; align-items: center; gap: 6px; }
    .rg-panel__topbar-right { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; }
    .rg-panel__scroll { flex: 1; overflow-y: auto; min-height: 0; }
    .rg-panel__list { display: flex; flex-direction: column; gap: 16px; padding: 12px 0 16px; }
    .rg-panel__q-item { display: flex; flex-direction: column; gap: 8px; }
    .rg-panel__q-header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .rg-panel__footer { display: flex; justify-content: flex-end; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid var(--b3-border-color); flex-shrink: 0; }
    .rg-error { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; padding: 48px 24px; max-width: 480px; margin: 0 auto; }
    .rg-error__icon { font-size: 48px; line-height: 1; }
    .rg-error__title { font-size: 18px; font-weight: 600; margin: 0; color: var(--b3-card-error); }
    .rg-error__detail { font-size: 13px; color: var(--b3-theme-on-surface-light); word-break: break-all; max-height: 120px; overflow-y: auto; font-family: var(--b3-font-family-code, monospace); background: var(--b3-theme-surface); padding: 8px 12px; border-radius: 6px; width: 100%; box-sizing: border-box; }
    .rg-error__hint { font-size: 13px; color: var(--b3-theme-on-surface-light); }
    .rg-error__actions { display: flex; gap: 8px; margin-top: 4px; }
    .rg-config { display: flex; justify-content: center; padding: 48px 24px; }
    .rg-config__card { max-width: 520px; width: 100%; }
    .rg-config__title { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
    .rg-config__desc { font-size: 13px; color: var(--b3-theme-on-surface-light); line-height: 1.6; margin: 0 0 16px; }
    .rg-config__row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 12px 0 4px; }
    .rg-config__row label { font-size: 14px; font-weight: 500; }
    .rg-config__val { font-size: 14px; color: var(--b3-theme-primary); font-weight: 600; }
    .rg-config__hint { font-size: 12px; color: var(--b3-theme-on-surface-light); margin: 4px 0 12px; }
    .rg-slider { width: 100%; }
    .rg-time-input { font-size: 14px; padding: 4px 8px; border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); background: var(--b3-theme-background); color: var(--b3-theme-on-background); }
    .rg-config__actions { display: flex; gap: 8px; margin-top: 16px; }
    .rg-config__error { font-size: 13px; color: var(--b3-card-error, #d23f31); margin-top: 12px; padding: 8px 12px; background: color-mix(in srgb, var(--b3-card-error, #d23f31) 8%, transparent); border-radius: var(--b3-border-radius); }
</style>
