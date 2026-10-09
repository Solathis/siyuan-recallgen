<script lang="ts">
    import { Badge } from "@/lib/components/ui/badge";
    import { Button } from "@/lib/components/ui/button";
    import * as Alert from "@/lib/components/ui/alert";
    import * as Card from "@/lib/components/ui/card";
    import * as Empty from "@/lib/components/ui/empty";
    import { Spinner } from "@/lib/components/ui/spinner";
    import { Textarea } from "@/lib/components/ui/textarea";
    import CodeBlock from "../editor/CodeBlock.svelte";
    import * as Tabs from "@/lib/components/ui/tabs";
    import * as ToggleGroup from "@/lib/components/ui/toggle-group";
    import { Progress } from "@/lib/components/ui/progress";
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import type { ChatTurn, QuizService } from "../quiz/service";
    import { formatClock } from "./duration";
    import { renderMarkdownLatex } from "./latex";
    import { PASS_SCORE } from "@/types/quiz";
    import type { GradingResult, Question } from "@/types/quiz";

    let {
        service,
        results,
        questions,
        analysis = null,
        analysisError = null,
        /** 判分之后的保存类步骤失败的原因；有值时在结果上方给出持续可见的横幅 */
        submitError = null,
        sourceDocId = "",
        sourceTitle = "",
        duration = 0,
        onsave = () => {},
        onsavewrong = () => {},
        savingDoc = false,
        onretrywrong = () => {},
        ondiscard = () => {},
    }: {
        service: QuizService;
        results: GradingResult[];
        questions: Question[];
        analysis?: string | null;
        /** 分析失败的原因：展示给用户，但不作为分析内容参与答疑或写入文档 */
        analysisError?: string | null;
        submitError?: import("../ai/errors").ErrorDescription | null;
        /** 来源文档 ID；有值时结果页显示「跳回原始笔记」链接 */
        sourceDocId?: string;
        /** 来源文档标题，用于链接文字 */
        sourceTitle?: string;
        duration?: number;
        onsave?: () => void;
        onsavewrong?: () => void;
        /** 保存到文档进行中：按钮置灰，避免重复建文档 */
        savingDoc?: boolean;
        /** 只重做未达标的题目 */
        onretrywrong?: () => void;
        ondiscard?: () => void;
    } = $props();

    /* ── 汇总统计 ────────────────────────────────────────────────── */

    const total = $derived(results.reduce((s, r) => s + r.score, 0));
    const max = $derived(results.reduce((s, r) => s + r.maxScore, 0));
    const pct = $derived(max > 0 ? (total / max) * 100 : 0);
    const passed = $derived(pct >= PASS_SCORE);

    /**
     * 题目状态：客观题支持部分得分后，「正确」表示完全正确（100 分），
     * 部分得分单独成一类，避免把 75 分的多选题显示成绿色「正确」。
     */
    function qStatus(r: GradingResult): "correct" | "partial" | "wrong" | "unanswered" {
        if (!r.userAnswer) return "unanswered";
        if (r.score >= 100) return "correct";
        if (r.score > 0) return "partial";
        return "wrong";
    }

    /** 保留原始下标：题号要显示整卷里的序号，而不是筛选后的序号 */
    const indexed = $derived(results.map((result, index) => ({ result, index, status: qStatus(result) })));

    /**
     * 各状态的题数。
     *
     * 必须由 status 汇总，不能各自再写一遍过滤条件：原先「正确」用的是
     * score >= PASS_SCORE（达标），而筛选器里的「正确」用的是 score >= 100（完全正确），
     * 于是一道 75 分的多选题同时被算进「正确」和「部分得分」，
     * 筛选片上的数字相加还比总题数多——数字看着像算错了。
     * 现在两处共用同一份 status，各片之和恒等于总题数。
     */
    const counts = $derived.by(() => {
        const acc = { correct: 0, partial: 0, wrong: 0, unanswered: 0 };
        for (const item of indexed) acc[item.status]++;
        return acc;
    });

    const correctCount = $derived(counts.correct);
    const partialCount = $derived(counts.partial);
    const wrongCount = $derived(counts.wrong);
    const unanswered = $derived(counts.unanswered);

    /**
     * 达标题数与达标率。
     *
     * 顶部这个指标原本叫「正确率」，算法却是「得分 >= PASS_SCORE 的题数」——
     * 那不叫正确率，叫达标率，与统计页的说法也是两套。现在改成达标率：
     * 判分走 AI 时几乎不会有满分题（85、90 分都算部分得分），
     * 按「完全正确」算的话这个数会长期是 0%，看不出练得怎么样。
     */
    const passedQuestions = $derived(results.filter((r) => r.score >= PASS_SCORE).length);
    const passRate = $derived(results.length > 0 ? (passedQuestions / results.length) * 100 : 0);

    /**
     * 未达标的题数。
     *
     * 「重做错题」重做的是未达标的题（成绩低于 PASS_SCORE），其中包含只拿到
     * 部分分数的那些。原先按钮按「0 分的错题」判断显示，一道题拿 50 分时
     * 按钮会直接消失，而它恰恰是最该重做的。
     */
    const belowPass = $derived(results.filter((r) => r.score < PASS_SCORE).length);

    /** 每题平均耗时；没测到用时（duration 为 0）时保持 null，由 fmtDuration 显示「--」 */
    const secondsPerQuestion = $derived(duration > 0 && results.length > 0 ? duration / results.length : 0);

    /**
     * 按得分取主题语义色，不再硬编码十六进制色值
     * （原实现在暗色主题下对比度不足，基本不可读）。
     */
    function scoreTone(p: number): string {
        if (p >= 80) return "text-success";
        if (p >= 60) return "text-primary";
        if (p >= 30) return "text-warning";
        return "text-destructive";
    }

    function fmtDuration(sec: number): string {
        if (sec <= 0) return "--";
        return formatClock(sec);
    }

    /* ── 题目详情 ────────────────────────────────────────────────── */

    let activeTab = $state<"questions" | "analysis">("questions");
    let activeQ = $state(0);

    type StatusFilter = "all" | "correct" | "partial" | "wrong" | "unanswered";
    let filter = $state<StatusFilter>("all");

    const visible = $derived(filter === "all" ? indexed : indexed.filter((item) => item.status === filter));

    /*
     * 原实现这里是「一排状态圆点 + 一排图例文字」，两者都不可点，
     * 想只看错题得自己数题号。现在图例本身即筛选器，题号条只显示筛出来的题。
     */
    const filterItems = $derived([
        { value: "all", label: t("result.all", String(results.length)) },
        { value: "correct", label: t("result.correct", String(correctCount)) },
        { value: "partial", label: t("result.partial", String(partialCount)) },
        { value: "wrong", label: t("result.wrong", String(wrongCount)) },
        { value: "unanswered", label: t("result.unanswered", String(unanswered)) },
    ]);

    /** 当前查看的那道题：被筛掉时回落到第一条可见项 */
    const activeEntry = $derived(visible.find((item) => item.index === activeQ) ?? visible[0]);
    const activeResult = $derived(activeEntry?.result);
    const activeQuestion = $derived(questions[activeEntry?.index ?? -1]);

    function correctText(q: Question): string {
        switch (q.type) {
            case "single_choice":
                return String.fromCharCode(65 + q.answer);
            case "multiple_choice":
                return q.answer
                    .map((i) => String.fromCharCode(65 + i))
                    .sort()
                    .join("、");
            case "true_false":
                return q.answer ? t("common.true") : t("common.false");
            case "fill_blank":
                return q.answer.map((o) => o.join(" / ")).join("；");
            case "subjective":
                return q.reference_answer;
            case "coding":
                return t("common.seeAnswer");
        }
    }

    function userText(r: GradingResult): string {
        const ua = r.userAnswer;
        if (!ua) return t("common.unanswered");
        switch (ua.type) {
            case "single_choice":
                return String.fromCharCode(65 + ua.value);
            case "multiple_choice":
                return ua.value
                    .map((i) => String.fromCharCode(65 + i))
                    .sort()
                    .join("、");
            case "true_false":
                return ua.value ? t("common.true") : t("common.false");
            case "fill_blank":
                return ua.value.join("；");
            case "subjective":
            case "coding":
                return ua.value;
        }
    }

    function isCorrectOption(q: Question, index: number): boolean {
        if (q.type === "single_choice") return q.answer === index;
        if (q.type === "multiple_choice") return q.answer.includes(index);
        return false;
    }

    /**
     * 用户在选项里勾了哪几个。
     *
     * 原先只高亮正确答案，选错的选项与没选的一模一样 —— 回看时看不出自己当初选了什么，
     * 只能靠旁边那行「你的答案：C」去对号，多选更对不过来。
     */
    const chosenOptions = $derived.by(() => {
        const ua = activeResult?.userAnswer;
        if (ua?.type === "single_choice") return new Set([ua.value]);
        if (ua?.type === "multiple_choice") return new Set(ua.value);
        return new Set<number>();
    });

    const statusDot: Record<string, string> = {
        correct: "bg-success",
        partial: "bg-warning",
        wrong: "bg-destructive",
        unanswered: "bg-muted-foreground/40",
    };

    /* ── AI 答疑 ─────────────────────────────────────────────────── */

    let chatHistory = $state<ChatTurn[]>([]);
    let chatInput = $state("");
    let chatLoading = $state(false);
    let chatScroll: HTMLElement | null = $state(null);

    async function sendChat() {
        const message = chatInput.trim();
        if (!message || chatLoading) return;
        chatLoading = true;
        const prior = [...chatHistory, { role: "user" as const, content: message }];
        chatHistory = prior;
        chatInput = "";
        await scrollChat();
        try {
            const reply = await service.chatGlobal(
                questions,
                results,
                analysis ?? "",
                chatHistory.slice(0, -1),
                message
            );
            chatHistory = [...chatHistory, { role: "assistant", content: reply }];
        } catch (e) {
            chatHistory = [...chatHistory, { role: "assistant", content: t("chat.errorReply", (e as Error).message) }];
        } finally {
            chatLoading = false;
            await scrollChat();
        }
    }

    async function scrollChat() {
        await new Promise((r) => setTimeout(r, 0));
        chatScroll?.scrollTo({ top: chatScroll.scrollHeight, behavior: "smooth" });
    }

    function onChatKey(e: KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void sendChat();
        }
    }
</script>

<!--
    @container：结果页的排版要按「面板可用宽度」决定，而不是视口宽度。
    思源里面板可以很窄，用 sm:/md: 判断是否并排从根上就是错的。
-->
<div class="@container flex flex-col gap-4 pb-4">
    <!--
        汇总重做。
        原实现是三块并排的大数字（得分 / 正确率 / 用时），窄屏下叠成三层、
        每层之间留出一大截空白，主次也分不出来——看不出这次到底过没过。
        现在左侧是得分环 + 达标徽标（一眼可判），右侧是指标行；窄容器下
        指标行排成两列，不再出现三块纵向堆叠的大空白。
    -->
    <div class="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
        <Card.Root>
            <Card.Content class="flex flex-col gap-4 pt-4 @2xl:flex-row @2xl:items-center @2xl:gap-6">
                <div class="flex items-center gap-4">
                    <div class="flex w-full max-w-56 flex-col gap-2">
                        <div class="flex items-baseline gap-2">
                            <span
                                class={cn(
                                    "text-3xl leading-none font-semibold tabular-nums",
                                    passed ? "text-success" : "text-destructive"
                                )}>{pct.toFixed(0)}</span
                            >
                            <span class="text-muted-foreground text-2xs">{t("result.score")}</span>
                        </div>
                        <Progress
                            value={pct}
                            class="h-2 [&>[data-slot=progress-indicator]]:bg-rg-accent"
                            aria-label={t("result.score")}
                        />
                    </div>

                    <div class="flex min-w-0 flex-col items-start gap-1.5">
                        <Badge variant={passed ? "success" : "destructive"}>
                            {passed ? t("result.passed") : t("result.notPassed")}
                        </Badge>
                        <span class="text-muted-foreground text-xs tabular-nums">{total.toFixed(0)}/{max}</span>
                        {#if sourceDocId && sourceTitle}
                            <span class="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
                                <span class="shrink-0">{t("result.sourceNote")}:</span>
                                <Button
                                    variant="link"
                                    size="xs"
                                    class="h-auto max-w-40 truncate px-0"
                                    title={sourceTitle}
                                    onclick={() => service.openDoc(sourceDocId)}
                                >
                                    {sourceTitle}
                                </Button>
                            </span>
                        {/if}
                    </div>
                </div>

                <dl class="grid grid-cols-2 gap-x-5 gap-y-3 @xl:grid-cols-4 @2xl:ml-auto">
                    <div class="flex flex-col gap-0.5">
                        <dt class="text-muted-foreground text-xs">{t("result.passRate")}</dt>
                        <dd class={cn("text-lg font-semibold tabular-nums", scoreTone(passRate))}>
                            {passRate.toFixed(0)}%
                        </dd>
                        <span class="text-muted-foreground text-2xs">
                            {t("result.qCount", `${passedQuestions}/${results.length}`)}
                        </span>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <dt class="text-muted-foreground text-xs">{t("result.time")}</dt>
                        <dd class="text-lg font-semibold tabular-nums">{fmtDuration(duration)}</dd>
                    </div>
                    <!--
                        后两格放「未达标」与「每题平均耗时」，而不是「错误」「未作答」：
                        后者在下面的筛选片里已经逐项给出计数，顶部再来一遍只是重复；
                        「未达标」是要不要动手重做的依据，每题均时则看得出这次是不是在赶。
                    -->
                    <div class="flex flex-col gap-0.5">
                        <dt class="text-muted-foreground text-xs">{t("result.notPassed")}</dt>
                        <dd class={cn("text-lg font-semibold tabular-nums", belowPass > 0 && "text-destructive")}>
                            {belowPass}
                        </dd>
                    </div>
                    <div class="flex flex-col gap-0.5">
                        <dt class="text-muted-foreground text-xs">{t("stats.perQuestion")}</dt>
                        <dd class="text-lg font-semibold tabular-nums">{fmtDuration(secondsPerQuestion)}</dd>
                    </div>
                </dl>
            </Card.Content>
        </Card.Root>
    </div>

    {#if submitError}
        <Alert.Root variant="destructive" class="animate-in fade-in-0 slide-in-from-top-1 duration-200">
            <Alert.Title>{t("result.submitError")}</Alert.Title>
            <Alert.Description>{t("result.submitErrorHint")}</Alert.Description>
            {#if submitError.detail}
                <p class="mt-1 font-mono text-xs break-all">{submitError.detail}</p>
            {/if}
        </Alert.Root>
    {/if}

    <!--
        原先「薄弱点分析」与「学习建议」两个标签页渲染的是同一段 analysis 文本，
        属于重复内容。现合并为单一「解析与建议」标签页。
    -->
    <Tabs.Root value={activeTab} onValueChange={(v) => (activeTab = v as typeof activeTab)}>
        <Tabs.List>
            <Tabs.Trigger value="questions">{t("result.tabQuestions")}</Tabs.Trigger>
            <Tabs.Trigger value="analysis">{t("result.tabAnalysisAdvice")}</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="questions" class="flex flex-col gap-3 pt-3">
            <!--
                筛选器：原实现是一排不可点的状态圆点 + 一排不可点的图例，
                下方还挂着一条只表示「看到第几题」的蓝色进度条（就是那条
                「没来由的蓝线」）。现在图例本身即筛选，蓝线去掉。
            -->
            <ToggleGroup.Root
                type="single"
                value={filter}
                variant="outline"
                size="sm"
                spacing={2}
                class="flex-wrap"
                aria-label={t("result.filterLabel")}
                onValueChange={(next) => next && (filter = next as StatusFilter)}
            >
                {#each filterItems as item (item.value)}
                    <!-- data-[state=on] 是 bits-ui 的选中态；描边变体默认只给一层浅灰底，
                         筛选这种场景需要一眼看出选中项，这里补成强调色填充 -->
                    <ToggleGroup.Item
                        value={item.value}
                        class="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                        >{item.label}</ToggleGroup.Item
                    >
                {/each}
            </ToggleGroup.Root>

            {#if visible.length === 0}
                <Empty.Root class="min-h-32">
                    <Empty.Header>
                        <Empty.Media variant="icon">🔍</Empty.Media>
                        <Empty.Title>{t("result.filterEmpty")}</Empty.Title>
                    </Empty.Header>
                </Empty.Root>
            {:else}
                <!-- 题号条只显示筛出来的题；点一下切换下方详情 -->
                <div
                    class="animate-in fade-in-0 flex flex-wrap items-center gap-1.5 duration-150"
                    role="group"
                    aria-label={t("result.tabQuestions")}
                >
                    {#each visible as item (item.result.questionId)}
                        <Button
                            variant="outline"
                            size="icon"
                            data-tap="icon"
                            class={cn(
                                "relative text-xs font-semibold transition-transform hover:scale-105",
                                item.index === activeEntry?.index
                                    ? "border-rg-accent ring-rg-accent-line ring-2"
                                    : "border-border"
                            )}
                            aria-label={t("result.jumpTo", String(item.index + 1), t(`result.status_${item.status}`))}
                            aria-current={item.index === activeEntry?.index}
                            onclick={() => (activeQ = item.index)}
                        >
                            {item.index + 1}
                            <span
                                class={cn(
                                    "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background",
                                    statusDot[item.status]
                                )}
                                aria-hidden="true"
                            ></span>
                        </Button>
                    {/each}
                </div>

                {#if activeQuestion && activeResult}
                    <!-- 按题号做 key：切换题目时整卡重新入场，让人看得出内容换了 -->
                    {#key activeEntry?.index}
                        <Card.Root class="animate-in fade-in-0 slide-in-from-top-1 duration-150">
                            <Card.Header>
                                <div class="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline">{t(`type.${activeQuestion.type}`)}</Badge>
                                    <Badge variant="secondary">{t(`diff.${activeQuestion.difficulty}`)}</Badge>
                                    {#each activeQuestion.tags ?? [] as tag (tag)}
                                        <Badge variant="outline">{tag}</Badge>
                                    {/each}
                                    <span
                                        class={cn(
                                            "ml-auto text-sm font-bold tabular-nums",
                                            scoreTone((activeResult.score / (activeResult.maxScore || 1)) * 100)
                                        )}
                                    >
                                        {activeResult.score.toFixed(0)}/{activeResult.maxScore}
                                    </span>
                                </div>
                            </Card.Header>
                            <Card.Content class="flex flex-col gap-3 text-sm">
                                <div class="rg-markdown">{@html renderMarkdownLatex(activeQuestion.question)}</div>

                                {#if activeQuestion.type === "single_choice" || activeQuestion.type === "multiple_choice"}
                                    <div class="flex flex-col gap-1">
                                        {#each activeQuestion.options as option, j (j)}
                                            {@const isCorrect = isCorrectOption(activeQuestion, j)}
                                            {@const isChosen = chosenOptions.has(j)}
                                            <!--
                                            选项行原本把序号写成一个 inline-block 的 span，
                                            里面的 <p> 是块级元素，窄屏下序号就被挤到单独一行。
                                            改成 flex：序号固定宽、正文占剩余宽度，任何宽度都不折。
                                            配色分三种：正确答案绿底，选错的那一项红底，其余中性。
                                        -->
                                            <div
                                                class={cn(
                                                    "flex items-start gap-2 rounded-md border px-2.5 py-1.5",
                                                    isCorrect
                                                        ? "border-success/40 bg-success/15"
                                                        : isChosen
                                                          ? "border-destructive/40 bg-destructive/15"
                                                          : "border-transparent"
                                                )}
                                            >
                                                <span class="text-muted-foreground w-3 shrink-0 font-mono text-xs">
                                                    {String.fromCharCode(65 + j)}
                                                </span>
                                                <div
                                                    class={cn(
                                                        "rg-markdown min-w-0 flex-1",
                                                        (isCorrect || isChosen) && "font-semibold"
                                                    )}
                                                >
                                                    {@html renderMarkdownLatex(option)}
                                                </div>
                                                {#if isCorrect}
                                                    <span
                                                        class="text-success shrink-0 font-semibold"
                                                        role="img"
                                                        aria-label={t("result.status_correct")}
                                                    >
                                                        ✓
                                                    </span>
                                                {:else if isChosen}
                                                    <span
                                                        class="text-destructive shrink-0 font-semibold"
                                                        role="img"
                                                        aria-label={t("result.status_wrong")}
                                                    >
                                                        ✗
                                                    </span>
                                                {/if}
                                            </div>
                                        {/each}
                                    </div>
                                {/if}

                                <div class="grid grid-cols-1 gap-2 @xl:grid-cols-2">
                                    <div>
                                        <span class="text-muted-foreground text-xs">{t("result.yourAnswer")}</span>
                                        <div class="rg-markdown">
                                            {@html renderMarkdownLatex(userText(activeResult))}
                                        </div>
                                    </div>
                                    {#if activeQuestion.type !== "subjective" && activeQuestion.type !== "coding"}
                                        <div>
                                            <span class="text-muted-foreground text-xs"
                                                >{t("result.correctAnswer")}</span
                                            >
                                            <div class="rg-markdown">
                                                {@html renderMarkdownLatex(correctText(activeQuestion))}
                                            </div>
                                        </div>
                                    {/if}
                                </div>

                                {#if activeQuestion.type === "coding"}
                                    <!--
                                        编程题的参考答案是一段代码，原先只显示「见答案」而没有任何地方能看到它——
                                        数据里本来就有 answer 字段，这里用只读高亮视图展示出来。
                                    -->
                                    <div class="flex flex-col gap-1">
                                        <span class="text-muted-foreground text-xs">{t("result.correctAnswer")}</span>
                                        {#if activeQuestion.answer?.trim()}
                                            <CodeBlock
                                                code={activeQuestion.answer}
                                                language={activeQuestion.language}
                                                title={t("code.reference")}
                                            />
                                        {:else}
                                            <p class="text-muted-foreground text-xs">{t("result.noReference")}</p>
                                        {/if}
                                    </div>
                                {/if}

                                {#if activeQuestion.explanation}
                                    <div class="border-border border-t pt-2">
                                        <span class="text-muted-foreground text-xs">{t("result.explanation")}</span>
                                        <div class="rg-markdown">
                                            {@html renderMarkdownLatex(activeQuestion.explanation)}
                                        </div>
                                    </div>
                                {/if}

                                {#if activeResult.comment}
                                    <div class="border-border border-t pt-2">
                                        <span class="text-muted-foreground text-xs">{t("result.comment")}</span>
                                        <div class="rg-markdown">{@html renderMarkdownLatex(activeResult.comment)}</div>
                                    </div>
                                {/if}
                            </Card.Content>
                        </Card.Root>
                    {/key}
                {:else}
                    <Empty.Root class="min-h-32">
                        <Empty.Header>
                            <Empty.Media variant="icon">❔</Empty.Media>
                            <Empty.Title>{t("result.questionMissing")}</Empty.Title>
                        </Empty.Header>
                    </Empty.Root>
                {/if}
            {/if}

            <div class="flex flex-wrap justify-end gap-2">
                {#if belowPass > 0}
                    <Button variant="secondary" size="sm" onclick={() => onretrywrong()}
                        >{t("result.retryWrong")}</Button
                    >
                {/if}
                <Button variant="ghost" size="sm" onclick={() => ondiscard()}>{t("result.discard")}</Button>
                <Button variant="outline" size="sm" disabled={savingDoc} onclick={() => onsavewrong()}
                    >{t("result.saveWrong")}</Button
                >
                <Button size="sm" disabled={savingDoc} onclick={() => onsave()}>{t("result.save")}</Button>
            </div>
        </Tabs.Content>

        <Tabs.Content value="analysis" class="pt-3">
            {#if analysis}
                <Card.Root class="animate-in fade-in-0 duration-200">
                    <Card.Content class="rg-markdown pt-4 text-sm">{@html renderMarkdownLatex(analysis)}</Card.Content>
                </Card.Root>
            {:else if analysisError}
                <!-- 区分「分析失败」与「没有分析」：前者要给出原因，用户才知道可以重试 -->
                <Alert.Root variant="destructive">
                    <Alert.Title>{t("result.noAnalysis")}</Alert.Title>
                    <Alert.Description>{t("quiz.analysisFailed", analysisError)}</Alert.Description>
                </Alert.Root>
            {:else}
                <Empty.Root class="min-h-40">
                    <Empty.Header>
                        <Empty.Media variant="icon">📄</Empty.Media>
                        <Empty.Title>{t("result.noAnalysis")}</Empty.Title>
                    </Empty.Header>
                </Empty.Root>
            {/if}
        </Tabs.Content>
    </Tabs.Root>

    <!-- 整卷 AI 答疑 -->
    <Card.Root>
        <Card.Header>
            <Card.Title class="text-sm">{t("chat.globalTitle")}</Card.Title>
            <Card.Description>{t("chat.globalHint")}</Card.Description>
        </Card.Header>
        <Card.Content class="flex flex-col gap-2">
            <div
                class="flex max-h-60 min-h-16 flex-col gap-2 overflow-y-auto"
                bind:this={chatScroll}
                aria-live="polite"
            >
                {#if chatHistory.length === 0}
                    <p class="text-muted-foreground py-3 text-center text-xs">{t("chat.globalEmpty")}</p>
                {/if}
                {#each chatHistory as turn, i (i)}
                    <div
                        class={cn(
                            "max-w-4/5 animate-in fade-in-0 rounded-md px-2.5 py-2 text-sm",
                            turn.role === "user" ? "bg-primary/10 self-end" : "bg-muted self-start"
                        )}
                    >
                        <span class="text-muted-foreground text-2xs font-semibold">
                            {turn.role === "user" ? t("common.me") : t("common.ai")}
                        </span>
                        <div class="rg-markdown break-words">{@html renderMarkdownLatex(turn.content)}</div>
                    </div>
                {/each}
                {#if chatLoading}
                    <div
                        class="bg-muted text-muted-foreground flex items-center gap-1.5 self-start rounded-md px-2.5 py-2 text-sm italic"
                    >
                        <Spinner class="size-3.5" />
                        {t("common.thinking")}
                    </div>
                {/if}
            </div>
            <div class="flex items-end gap-2">
                <Textarea
                    class="max-h-20 min-h-9 flex-1 resize-none"
                    placeholder={t("chat.globalPlaceholder")}
                    aria-label={t("chat.globalPlaceholder")}
                    value={chatInput}
                    disabled={chatLoading}
                    oninput={(e) => (chatInput = e.currentTarget.value)}
                    onkeydown={onChatKey}
                />
                <Button size="sm" onclick={() => void sendChat()} disabled={chatLoading || !chatInput.trim()}>
                    {t("common.send")}
                </Button>
            </div>
        </Card.Content>
    </Card.Root>
</div>
