<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { button, separator, cn } from "./components";
    import { renderMarkdownLatex as renderLatex } from "../ui/latex";
    import type { QuizService, ChatTurn } from "../quiz/service";
    import type { GradingResult, Question } from "@/types/quiz";

    export let service: QuizService;
    export let results: GradingResult[];
    export let questions: Question[];
    export let analysis: string | null;
    export let duration: number = 0;

    const dispatch = createEventDispatcher<{ save: void; saveWrong: void; discard: void }>();

    // 导航标签
    let activeTab: "questions" | "analysis" | "advice" = "questions";
    // 当前选中的题目索引
    let activeQ = 0;

    // 全局 AI 答疑状态
    let chatHistory: ChatTurn[] = [];
    let chatInput = "";
    let chatLoading = false;
    let chatScrollEl: HTMLElement | null = null;

    const TYPE_LABEL: Record<string, string> = {
        single_choice: "单选题", multiple_choice: "多选题", fill_blank: "填空题",
        true_false: "判断题", subjective: "主观题", coding: "编程题",
    };
    const DIFF_LABEL: Record<string, string> = { easy: "初级", medium: "中级", hard: "高级" };

    $: total = results.reduce((s, r) => s + r.score, 0);
    $: max = results.reduce((s, r) => s + r.maxScore, 0);
    $: pct = max > 0 ? (total / max) * 100 : 0;
    $: passed = pct >= 60;
    $: correctCount = results.filter((r) => r.score >= 60).length;
    $: wrongCount = results.length - correctCount;
    $: unanswered = results.filter((r) => !r.userAnswer).length;
    $: accuracy = results.length > 0 ? (correctCount / results.length) * 100 : 0;

    $: activeResult = results[activeQ];
    $: activeQuestion = questions[activeQ];

    function fmtDuration(sec: number): string {
        if (sec <= 0) return "--";
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return `${m}:${String(s).padStart(2, "0")}`;
    }
    function qStatus(r: GradingResult): "correct" | "wrong" | "unanswered" {
        if (!r.userAnswer) return "unanswered";
        return r.score >= 60 ? "correct" : "wrong";
    }
    function correctText(q: Question): string {
        const qany = q as any;
        switch (q.type) {
            case "single_choice": return String.fromCharCode(65 + qany.answer);
            case "multiple_choice": return qany.answer.map((i: number) => String.fromCharCode(65 + i)).sort().join("、");
            case "true_false": return qany.answer ? "正确" : "错误";
            case "fill_blank": return qany.answer.map((o: string[]) => o.join(" / ")).join("；");
            case "subjective": return qany.reference_answer;
            case "coding": return "见参考答案";
        }
        return "";
    }
    function userText(r: GradingResult): string {
        const ua = r.userAnswer;
        if (!ua) return "（未作答）";
        const v = ua.value as any;
        switch (ua.type) {
            case "single_choice": return String.fromCharCode(65 + v);
            case "multiple_choice": return v.map((i: number) => String.fromCharCode(65 + i)).sort().join("、");
            case "true_false": return v ? "正确" : "错误";
            case "fill_blank": return v.join("；");
            case "subjective": case "coding": return v;
        }
        return "";
    }
    function isCorrectOption(q: Question, idx: number): boolean {
        const qany = q as any;
        if (q.type === "single_choice") return qany.answer === idx;
        if (q.type === "multiple_choice") return qany.answer.includes(idx);
        return false;
    }
    function scoreColor(p: number): string {
        if (p >= 80) return "#65a84c";
        if (p >= 60) return "var(--b3-theme-primary)";
        if (p >= 30) return "#d97706";
        return "#d23f31";
    }
    async function sendChat() {
        const msg = chatInput.trim();
        if (!msg || chatLoading) return;
        chatLoading = true;
        const prior = [...chatHistory, { role: "user" as const, content: msg }];
        chatHistory = prior;
        chatInput = "";
        await tick();
        chatScrollEl?.scrollTo({ top: chatScrollEl.scrollHeight, behavior: "smooth" });
        try {
            const reply = await service.chatGlobal(questions, results, analysis ?? "", chatHistory.slice(0, -1), msg);
            chatHistory = [...chatHistory, { role: "assistant", content: reply }];
        } catch (e) {
            chatHistory = [...chatHistory, { role: "assistant", content: `（出错了：${(e as Error).message}）` }];
        } finally {
            chatLoading = false;
            await tick();
            chatScrollEl?.scrollTo({ top: chatScrollEl.scrollHeight, behavior: "smooth" });
        }
    }
    function onChatKey(e: KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendChat(); }
    }
    function onChatInput(e: Event) {
        const el = e.target as HTMLTextAreaElement;
        chatInput = el.value;
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 80) + "px";
    }
    function tick(): Promise<void> { return new Promise((r) => setTimeout(r, 0)); }
</script>

<div class="rg-result">
    <!-- 标题区域 -->
    <div class="rg-header">
        <h2 class="rg-header__title">结果查看与学习</h2>
        <p class="rg-header__sub">查看结果、解析与 AI 答疑</p>
    </div>

    <!-- 3 个统计卡片 -->
    <div class="rg-stats">
        <div class="rg-stat-card">
            <div class="rg-stat-card__icon rg-stat-card__icon--score">✓</div>
            <div>
                <div class="rg-stat-card__num" style="color:{scoreColor(pct)}">{pct.toFixed(0)}</div>
                <div class="rg-stat-card__label">得分</div>
                <div class="rg-stat-card__sub">{total.toFixed(0)}/{max}</div>
            </div>
        </div>
        <div class="rg-stat-card">
            <div class="rg-stat-card__icon rg-stat-card__icon--acc">%</div>
            <div>
                <div class="rg-stat-card__num" style="color:{scoreColor(accuracy)}">{accuracy.toFixed(0)}%</div>
                <div class="rg-stat-card__label">正确率</div>
                <div class="rg-stat-card__sub">{correctCount}/{results.length} 题</div>
            </div>
        </div>
        <div class="rg-stat-card">
            <div class="rg-stat-card__icon rg-stat-card__icon--time">⏱</div>
            <div>
                <div class="rg-stat-card__num">{fmtDuration(duration)}</div>
                <div class="rg-stat-card__label">用时</div>
                <div class="rg-stat-card__sub">{wrongCount} 错 · {unanswered} 未答</div>
            </div>
        </div>
    </div>

    <!-- 导航标签 -->
    <div class="rg-tabs">
        <button class="rg-tabs__btn" class:active={activeTab === "questions"} on:click={() => activeTab = "questions"}>题目列表</button>
        <button class="rg-tabs__btn" class:active={activeTab === "analysis"} on:click={() => activeTab = "analysis"}>薄弱点分析</button>
        <button class="rg-tabs__btn" class:active={activeTab === "advice"} on:click={() => activeTab = "advice"}>学习建议</button>
    </div>

    <!-- 题目列表 Tab -->
    {#if activeTab === "questions"}
        <!-- 汇总信息行 -->
        <div class="rg-qstats">
            <span class="rg-qstats__item">
                <span class="rg-qstats__dot rg-qstats__dot--all"></span>
                全部({results.length})
            </span>
            <span class="rg-qstats__item">
                <span class="rg-qstats__dot rg-qstats__dot--correct"></span>
                正确({correctCount})
            </span>
            <span class="rg-qstats__item">
                <span class="rg-qstats__dot rg-qstats__dot--wrong"></span>
                错误({wrongCount})
            </span>
            <span class="rg-qstats__item">
                <span class="rg-qstats__dot rg-qstats__dot--unanswered"></span>
                未答({unanswered})
            </span>
        </div>

        <!-- 题目进度条 -->
        <div class="rg-progress-bar">
            {#each results as r, i}
                <button
                    class="rg-progress-bar__circle"
                    class:correct={qStatus(r) === "correct"}
                    class:wrong={qStatus(r) === "wrong"}
                    class:unanswered={qStatus(r) === "unanswered"}
                    class:active={i === activeQ}
                    on:click={() => activeQ = i}
                    title="第{i + 1}题"
                >{i + 1}</button>
            {/each}
        </div>

        <!-- 选中题目解析 -->
        {#if activeQuestion}
            <div class="rg-qdetail">
                <div class="rg-qdetail__header">
                    <span class="rg-qdetail__type">{TYPE_LABEL[activeQuestion.type] ?? activeQuestion.type}</span>
                    <span class="rg-qdetail__diff">{DIFF_LABEL[activeQuestion.difficulty] ?? activeQuestion.difficulty}</span>
                    <span class="rg-qdetail__score" style="color:{scoreColor(activeResult.score / activeResult.maxScore * 100)}">{activeResult.score.toFixed(0)}/{activeResult.maxScore}</span>
                </div>
                <p class="rg-qdetail__q">{@html renderLatex(activeQuestion.question)}</p>

                {#if activeQuestion.type === "single_choice" || activeQuestion.type === "multiple_choice"}
                    <div class="rg-qdetail__options">
                        {#each activeQuestion.options as opt, j}
                            <div class="rg-qdetail__opt" class:is-correct={isCorrectOption(activeQuestion, j)}>
                                <b>{String.fromCharCode(65 + j)}.</b> {@html renderLatex(opt)}
                            </div>
                        {/each}
                    </div>
                {/if}
                <p><b>你的答案：</b>{@html renderLatex(userText(activeResult))}</p>
                {#if activeQuestion.type !== "subjective" && activeQuestion.type !== "coding"}
                    <p><b>正确答案：</b>{@html renderLatex(correctText(activeQuestion))}</p>
                {/if}
                {#if activeQuestion.explanation}
                    <div class="rg-qdetail__analysis">
                        <p class="rg-qdetail__analysis-title">解析</p>
                        <div class="rg-qdetail__analysis-content">{@html renderLatex(activeQuestion.explanation)}</div>
                    </div>
                {/if}
                {#if activeResult.comment}
                    <div class="rg-qdetail__analysis">
                        <p class="rg-qdetail__analysis-title">评语</p>
                        <div class="rg-qdetail__analysis-content">{@html renderLatex(activeResult.comment)}</div>
                    </div>
                {/if}
            </div>
        {/if}
    {:else if activeTab === "analysis"}
        <div class="rg-panel-text">
            {#if analysis}
                {@html renderLatex(analysis)}
            {:else}
                <p class="rg-empty">暂无薄弱点分析</p>
            {/if}
        </div>
    {:else if activeTab === "advice"}
        <div class="rg-panel-text">
            {#if analysis}
                {@html renderLatex(analysis)}
            {:else}
                <p class="rg-empty">暂无学习建议</p>
            {/if}
        </div>
    {/if}

    <!-- AI 答疑 -->
    <div class="rg-chat">
        <div class="rg-chat__header">
            <span>💬 AI 答疑</span>
            <span class="rg-chat__hint">针对本次答题追问</span>
        </div>
        <div class="rg-chat__msgs" bind:this={chatScrollEl}>
            {#if chatHistory.length === 0}
                <p class="rg-chat__empty">可以向 AI 追问本次答题的任何问题</p>
            {/if}
            {#each chatHistory as turn}
                <div class="rg-chat__msg" class:is-user={turn.role === "user"} class:is-ai={turn.role === "assistant"}>
                    <span class="rg-chat__role">{turn.role === "user" ? "我" : "AI"}</span>
                    <span class="rg-chat__text">{@html renderLatex(turn.content)}</span>
                </div>
            {/each}
            {#if chatLoading}
                <div class="rg-chat__msg is-ai">
                    <span class="rg-chat__role">AI</span>
                    <span class="rg-chat__typing">思考中…</span>
                </div>
            {/if}
        </div>
        <div class="rg-chat__input-row">
            <textarea class="rg-chat__input" placeholder="请输入你的问题..." value={chatInput} on:input={onChatInput} on:keydown={onChatKey} disabled={chatLoading}></textarea>
            <button class="rg-chat__send" on:click={sendChat} disabled={chatLoading || !chatInput.trim()}>➤</button>
        </div>
    </div>

    <!-- 底部操作 -->
    <div class="rg-result__foot">
        <button class={button({ variant: "ghost", size: "sm" })} on:click={() => dispatch("discard")}>放弃保存</button>
        <button class={button({ variant: "outline", size: "sm" })} on:click={() => dispatch("saveWrong")}>仅保存错题</button>
        <button class={button({ variant: "default", size: "sm" })} on:click={() => dispatch("save")}>保存到文档</button>
    </div>
</div>

<style>
    .rg-result { display: flex; flex-direction: column; gap: 12px; padding: 0 0 12px; }

    /* 标题区域 */
    .rg-header { background: color-mix(in srgb, #65a84c 10%, var(--b3-theme-background)); border-radius: var(--b3-border-radius); padding: 12px 16px; }
    .rg-header__title { font-size: 18px; font-weight: 700; margin: 0; color: #2d6a2d; }
    .rg-header__sub { font-size: 13px; color: #5a8a5a; margin: 2px 0 0; }

    /* 统计卡片 */
    .rg-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .rg-stat-card { display: flex; align-items: center; gap: 12px; border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); padding: 12px; background: var(--b3-theme-background); }
    .rg-stat-card__icon { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 700; flex-shrink: 0; }
    .rg-stat-card__icon--score { background: color-mix(in srgb, #65a84c 18%, transparent); color: #65a84c; }
    .rg-stat-card__icon--acc { background: color-mix(in srgb, var(--b3-theme-primary) 18%, transparent); color: var(--b3-theme-primary); }
    .rg-stat-card__icon--time { background: color-mix(in srgb, #d97706 18%, transparent); color: #d97706; }
    .rg-stat-card__num { font-size: 22px; font-weight: 700; line-height: 1.1; }
    .rg-stat-card__label { font-size: 12px; color: var(--b3-theme-on-surface-light); }
    .rg-stat-card__sub { font-size: 11px; color: var(--b3-theme-on-surface-light); }

    /* 导航标签 */
    .rg-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--b3-border-color); }
    .rg-tabs__btn { padding: 8px 16px; border: none; background: transparent; cursor: pointer; font-size: 13px; color: var(--b3-theme-on-surface-light); border-radius: var(--b3-border-radius) var(--b3-border-radius) 0 0; border-bottom: 2px solid transparent; appearance: none; -webkit-appearance: none; }
    .rg-tabs__btn.active { color: #2d6a2d; border-bottom-color: #65a84c; font-weight: 600; }
    .rg-tabs__btn:hover:not(.active) { background: var(--b3-list-hover); }

    /* 汇总信息行 */
    .rg-qstats { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--b3-theme-on-surface-light); }
    .rg-qstats__item { display: flex; align-items: center; gap: 4px; }
    .rg-qstats__dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
    .rg-qstats__dot--all { background: var(--b3-theme-on-surface-light); }
    .rg-qstats__dot--correct { background: #65a84c; }
    .rg-qstats__dot--wrong { background: #d23f31; }
    .rg-qstats__dot--unanswered { background: #aaa; }

    /* 题目进度条 */
    .rg-progress-bar { display: flex; gap: 6px; flex-wrap: wrap; padding: 4px 0; }
    .rg-progress-bar__circle { width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--b3-border-color); background: var(--b3-theme-background); cursor: pointer; font-size: 12px; font-weight: 600; display: flex; align-items: center; justify-content: center; color: var(--b3-theme-on-surface-light); appearance: none; -webkit-appearance: none; transition: transform .12s, border-color .12s; }
    .rg-progress-bar__circle:hover { transform: scale(1.1); }
    .rg-progress-bar__circle.correct { background: #65a84c; border-color: #65a84c; color: #fff; }
    .rg-progress-bar__circle.wrong { background: #d23f31; border-color: #d23f31; color: #fff; }
    .rg-progress-bar__circle.unanswered { background: #aaa; border-color: #aaa; color: #fff; }
    .rg-progress-bar__circle.active { box-shadow: 0 0 0 3px color-mix(in srgb, var(--b3-theme-primary) 40%, transparent); border-color: var(--b3-theme-primary); }

    /* 题目解析 */
    .rg-qdetail { border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); padding: 12px 16px; background: var(--b3-theme-background); }
    .rg-qdetail__header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .rg-qdetail__type { font-size: 12px; font-weight: 600; color: #2d6a2d; background: color-mix(in srgb, #65a84c 12%, transparent); padding: 2px 8px; border-radius: var(--b3-border-radius); }
    .rg-qdetail__diff { font-size: 12px; color: var(--b3-theme-on-surface-light); }
    .rg-qdetail__score { font-size: 14px; font-weight: 700; margin-left: auto; }
    .rg-qdetail__q { font-size: 14px; font-weight: 500; line-height: 1.6; margin: 0 0 12px; }
    .rg-qdetail__options { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
    .rg-qdetail__opt { padding: 6px 10px; border-radius: var(--b3-border-radius); font-size: 13px; }
    .rg-qdetail__opt.is-correct { background: color-mix(in srgb, #65a84c 12%, transparent); font-weight: 600; }
    .rg-qdetail__analysis { margin-top: 12px; border-top: 1px solid var(--b3-border-color); padding-top: 8px; }
    .rg-qdetail__analysis-title { font-size: 13px; font-weight: 600; color: #2d6a2d; margin: 0 0 4px; }
    .rg-qdetail__analysis-content { font-size: 13px; line-height: 1.7; color: var(--b3-theme-on-background); }

    /* 通用文本面板 */
    .rg-panel-text { border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); padding: 12px 16px; font-size: 13px; line-height: 1.7; background: var(--b3-theme-background); min-height: 100px; }
    .rg-empty { color: var(--b3-theme-on-surface-light); text-align: center; padding: 24px; }

    /* AI 答疑 */
    .rg-chat { border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); background: var(--b3-theme-background); display: flex; flex-direction: column; overflow: hidden; }
    .rg-chat__header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: color-mix(in srgb, #65a84c 8%, var(--b3-theme-background)); font-size: 13px; font-weight: 600; color: #2d6a2d; }
    .rg-chat__hint { font-size: 11px; color: var(--b3-theme-on-surface-light); font-weight: 400; }
    .rg-chat__msgs { display: flex; flex-direction: column; gap: 8px; padding: 12px; max-height: 240px; overflow-y: auto; min-height: 60px; }
    .rg-chat__empty { font-size: 13px; color: var(--b3-theme-on-surface-light); text-align: center; padding: 12px; }
    .rg-chat__msg { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: var(--b3-border-radius); font-size: 13px; line-height: 1.6; }
    .rg-chat__msg.is-user { background: color-mix(in srgb, var(--b3-theme-primary) 10%, transparent); align-self: flex-end; max-width: 85%; }
    .rg-chat__msg.is-ai { background: var(--b3-theme-background-light); align-self: flex-start; max-width: 90%; }
    .rg-chat__role { font-size: 11px; color: var(--b3-theme-on-surface-light); font-weight: 600; }
    .rg-chat__text { word-break: break-word; }
    .rg-chat__typing { color: var(--b3-theme-on-surface-light); font-style: italic; }
    .rg-chat__input-row { display: flex; gap: 8px; align-items: flex-end; padding: 8px 12px; border-top: 1px solid var(--b3-border-color); }
    .rg-chat__input { flex: 1; min-height: 36px; max-height: 80px; resize: none; padding: 6px 10px; border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); background: var(--b3-theme-background); color: var(--b3-theme-on-background); font-size: 13px; font-family: inherit; }
    .rg-chat__send { width: 36px; height: 36px; border-radius: 50%; border: none; background: #65a84c; color: #fff; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; appearance: none; -webkit-appearance: none; }
    .rg-chat__send:hover:not(:disabled) { background: #5a8a3f; }
    .rg-chat__send:disabled { opacity: .5; cursor: not-allowed; }

    .rg-result__foot { display: flex; justify-content: flex-end; gap: 8px; padding-top: 4px; }

    @media (max-width: 640px) {
        .rg-stats { grid-template-columns: 1fr; }
        .rg-qstats { gap: 8px; }
        .rg-progress-bar__circle { width: 24px; height: 24px; font-size: 11px; }
    }
</style>
