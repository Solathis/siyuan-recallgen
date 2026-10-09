<script module lang="ts">
    // 实例 script 里有同名导入，svelte-check 会把两段 script 放到同一作用域，
    // 因此这里必须用别名
    import type { Question as QuizQuestion, UserAnswer as QuizAnswer } from "@/types/quiz";

    /**
     * 代码编辑器应当显示的内容。
     *
     * 关键在于区分「未作答」与「作答后清空」：前者回落到初始代码，
     * 后者必须保持为空。两者用 `||` 合并会让用户永远删不掉初始代码。
     */
    export function editorTarget(answer: QuizAnswer | undefined, question: QuizQuestion): string {
        if (answer?.type === "coding") return answer.value;
        return question.type === "coding" ? (question.starter_code ?? "") : "";
    }
</script>

<script lang="ts">
    import { untrack } from "svelte";
    import { showMessage } from "siyuan";
    import { Badge } from "@/lib/components/ui/badge";
    import { Button } from "@/lib/components/ui/button";
    import { Checkbox } from "@/lib/components/ui/checkbox";
    import { Input } from "@/lib/components/ui/input";
    import { Label } from "@/lib/components/ui/label";
    import * as RadioGroup from "@/lib/components/ui/radio-group";
    import { Textarea } from "@/lib/components/ui/textarea";
    import * as Tabs from "@/lib/components/ui/tabs";
    import { cn } from "@/lib/utils";
    import { CodeEditor, languageLabel } from "../editor/codemirror";
    import { copyText } from "./clipboard";
    import {
        isRunSupported,
        isRunnableLanguage,
        resolveEntryPoint,
        runCodingTests,
        type RunOutcome,
    } from "../quiz/code-runner";
    import { t } from "../i18n";
    import { renderMarkdownLatex } from "./latex";
    import type { Question, UserAnswer } from "@/types/quiz";

    let {
        question,
        answer = undefined,
        onchange,
    }: {
        question: Question;
        answer?: UserAnswer;
        /** Svelte 5 用回调属性取代 createEventDispatcher */
        onchange: (answer: UserAnswer) => void;
    } = $props();

    /* ── 单选题 / 多选题 / 判断题 ─────────────────────────────────── */

    /**
     * 选项序号（A/B/C…）。
     * 解析里经常写「选项 B 错在…」，而界面原先只有一排单选圈，
     * 用户得自己数到第几个；标上序号才能对上号。
     */
    function optionLetter(index: number): string {
        return String.fromCharCode(65 + index);
    }

    const singleValue = $derived(answer?.type === "single_choice" ? answer.value : null);
    const multiValue = $derived(answer?.type === "multiple_choice" ? answer.value : []);
    const boolValue = $derived(answer?.type === "true_false" ? answer.value : null);

    function setSingle(index: number) {
        onchange({ type: "single_choice", value: index });
    }

    function toggleMulti(index: number) {
        const next = multiValue.includes(index) ? multiValue.filter((i) => i !== index) : [...multiValue, index];
        onchange({ type: "multiple_choice", value: next.sort((a, b) => a - b) });
    }

    function setBool(value: boolean) {
        onchange({ type: "true_false", value });
    }

    /* ── 填空题 ──────────────────────────────────────────────────── */

    /** 空的数量由题目答案结构决定，作答值按空序保存 */
    const blankCount = $derived(question.type === "fill_blank" ? question.answer.length : 0);
    const blankValues = $derived(answer?.type === "fill_blank" ? answer.value : []);

    function setBlank(index: number, value: string) {
        const next = Array.from({ length: blankCount }, (_, i) => blankValues[i] ?? "");
        next[index] = value;
        onchange({ type: "fill_blank", value: next });
    }

    /* ── 主观题 ──────────────────────────────────────────────────── */

    /**
     * 题干与选项的渲染结果。
     *
     * 必须用派生值：直接写在模板里的话，主观题每敲一个字符、编程题每次输入
     * 都会重跑一次 marked + DOMPurify + KaTeX（5 个选项就是 6 次渲染）——
     * 这些内容只取决于 question，与作答无关。
     */
    const questionHtml = $derived(renderMarkdownLatex(question.question));
    const optionHtml = $derived(
        "options" in question && Array.isArray(question.options)
            ? question.options.map((option) => renderMarkdownLatex(option))
            : []
    );

    const subjectiveValue = $derived(answer?.type === "subjective" ? answer.value : "");
    /** 必须是派生值：写成普通常量只会渲染一次，输入后预览不会更新 */
    const subjectivePreview = $derived(renderMarkdownLatex(subjectiveValue));
    let subjectiveMode = $state<"edit" | "preview">("edit");

    /* ── 编程题 ──────────────────────────────────────────────────── */

    /**
     * 编程题当前代码。
     * 刻意用 undefined 表示「还没作答」，与「作答后被清空的空字符串」区分开：
     * 两者用 `||` 合并时，用户把代码全删掉会被当成未作答而重新填回初始代码，
     * 等于无法清空编辑器。
     */
    const codingValue = $derived(answer?.type === "coding" ? answer.value : undefined);
    /** 编辑器的占位容器：始终渲染，编辑器按需挂到它里面 */
    let editorEl = $state<HTMLDivElement | null>(null);
    /** 占位容器是否已接近视口（进入前不创建 CodeMirror） */
    let editorNear = $state(false);
    let editor: CodeEditor | null = null;
    let editorReady = $state(false);

    /**
     * 接近视口时才创建编辑器。
     *
     * 所有题目渲染在同一页里，一次最多可有 50 道编程题；每道都建一个
     * CodeMirror（含语法包、按键映射与各类观察器）会让生成/恢复明显变卡。
     * 这里用 IntersectionObserver 只激活可见附近的那几个。
     */
    $effect(() => {
        const el = editorEl;
        if (!el || question.type !== "coding") return;
        if (typeof IntersectionObserver === "undefined") {
            editorNear = true;
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    editorNear = true;
                    observer.disconnect();
                }
            },
            // 提前 400px 预热，滚动到该题时编辑器已就绪
            { rootMargin: "400px 0px" }
        );
        observer.observe(el);
        return () => observer.disconnect();
    });

    /**
     * 创建编辑器。
     *
     * 依赖必须只包含「题目身份 + 语言 + 是否临近视口」：作答内容每次按键都会变，
     * 若在这里读取它建立依赖，编辑器会在每个字符输入时被销毁重建，
     * 焦点、光标与撤销历史全部丢失，实际无法连续输入。
     * 初始内容用 untrack 读取，既拿到当前值又不建立依赖。
     */
    $effect(() => {
        const el = editorEl;
        const near = editorNear;
        // 通过局部变量收窄类型，同时把依赖固定为「这道题 + 这个语言 + 是否临近」
        const coding = question.type === "coding" ? question : null;
        if (!el || !coding || !near) return;

        const initial = untrack(() => codingValue ?? coding.starter_code ?? "");
        const instance = new CodeEditor(el, coding.language, initial, (doc) => {
            onchange({ type: "coding", value: doc });
        });
        instance.setWrap(untrack(() => wrap));
        editor = instance;
        editorReady = false;
        void instance.mount().then(() => {
            // 若 effect 已清理（组件销毁或题目切换），不要再标记就绪
            if (editor !== instance) return;
            editorReady = true;
        });

        return () => {
            editor = null;
            editorReady = false;
            instance.destroy();
        };
    });

    /* ── 运行测试用例 ────────────────────────────────────────────── */

    let running = $state(false);
    let runOutcome = $state<RunOutcome | null>(null);
    /** 当前代码是否软换行；长行折行还是横向滚动由用户自己定 */
    let wrap = $state(false);

    /** 这门语言能不能直接跑：只有 JS 有执行环境，其余语言不该给运行按钮 */
    const runnable = $derived(question.type === "coding" && isRunnableLanguage(question.language));

    function setWrap(on: boolean) {
        wrap = on;
        editor?.setWrap(on);
    }

    async function copyCode() {
        const text = editor?.getValue() ?? codingValue ?? "";
        const ok = await copyText(text);
        showMessage(ok ? t("code.copied") : t("code.copyFailed"), ok ? 2000 : 6000, ok ? "info" : "error");
    }

    function resetCode() {
        if (question.type !== "coding") return;
        const starter = question.starter_code ?? "";
        editor?.setValue(starter);
        onchange({ type: "coding", value: starter });
    }

    /**
     * 用当前编辑器内容跑一遍测试用例。
     * 执行在 Web Worker 中并有超时，避免死循环卡住思源界面；
     * 环境不支持时把原因展示出来，而不是静默失败。
     */
    async function runTests() {
        if (question.type !== "coding") return;
        // 事件处理器不在响应式上下文中，直接读取即可
        const code = codingValue ?? question.starter_code ?? "";
        const entryPoint = resolveEntryPoint(question) ?? "";
        running = true;
        runOutcome = null;
        try {
            runOutcome = await runCodingTests({
                language: question.language,
                code,
                entryPoint,
                cases: question.test_cases ?? [],
            });
        } finally {
            running = false;
        }
    }

    // 用派生值收窄联合类型，避免模板里无法判定 supported 分支
    const runCases = $derived(isRunSupported(runOutcome) ? runOutcome.results : null);
    const runFailure = $derived(runOutcome && !isRunSupported(runOutcome) ? runOutcome.reason : null);
    const passedCount = $derived(runCases ? runCases.filter((r) => r.passed).length : 0);
    /** 入口函数没加载成功时单独提示，避免只看到一堆一模一样的用例报错 */
    const runLoadError = $derived(isRunSupported(runOutcome) ? (runOutcome.loadError ?? null) : null);

    function formatValue(value: unknown): string {
        if (value === undefined) return "undefined";
        try {
            return typeof value === "string" ? value : JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    /** 题目或语言变化时把编辑器内容切换到当前题 */
    $effect(() => {
        const key = `${question.id}:${question.type === "coding" ? question.language : ""}`;
        void key;
        if (!editor || !editorReady) return;
        const target = editorTarget(answer, question);
        if (editor.getValue() !== target) editor.setValue(target);
    });
</script>

<div class="bg-card text-card-foreground rounded-lg border p-4">
    <p id={`${question.id}-stem`} class="rg-markdown mb-3 text-reading leading-relaxed">{@html questionHtml}</p>

    {#if question.type === "single_choice"}
        <!--
            选项用 shadcn 的 RadioGroup：原先手写的 input[type=radio] 只是「长得像单选」，
            组内方向键切换、读出「第 3 项，共 4 项」这些都由原语负责。
            控件与选项文字必须分开（radio 里放不下块级 markdown），用 for/aria-labelledby 关联。
        -->
        <RadioGroup.Root
            class="gap-1.5"
            value={singleValue === null ? "" : String(singleValue)}
            onValueChange={(v) => setSingle(Number(v))}
            aria-labelledby={`${question.id}-stem`}
        >
            {#each optionHtml as optionMarkup, i (i)}
                <div
                    class={cn(
                        "hover:bg-accent flex items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 transition-colors",
                        singleValue === i && "border-primary bg-primary/10"
                    )}
                >
                    <RadioGroup.Item
                        id={`${question.id}-opt-${i}`}
                        value={String(i)}
                        class="shrink-0"
                        aria-labelledby={`${question.id}-opt-${i}-letter ${question.id}-opt-${i}-text`}
                    />
                    <Label
                        for={`${question.id}-opt-${i}`}
                        class="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 font-normal"
                    >
                        <span
                            id={`${question.id}-opt-${i}-letter`}
                            class="text-muted-foreground w-3 shrink-0 font-mono text-xs">{optionLetter(i)}</span
                        >
                        <span id={`${question.id}-opt-${i}-text`} class="rg-markdown min-w-0">{@html optionMarkup}</span
                        >
                    </Label>
                </div>
            {/each}
        </RadioGroup.Root>
    {:else if question.type === "multiple_choice"}
        <div class="flex flex-col gap-1.5" role="group" aria-labelledby={`${question.id}-stem`}>
            {#each optionHtml as optionMarkup, i (i)}
                <div
                    class={cn(
                        "hover:bg-accent flex items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 transition-colors",
                        multiValue.includes(i) && "border-primary bg-primary/10"
                    )}
                >
                    <Checkbox
                        id={`${question.id}-opt-${i}`}
                        class="shrink-0"
                        checked={multiValue.includes(i)}
                        onCheckedChange={() => toggleMulti(i)}
                        aria-labelledby={`${question.id}-opt-${i}-letter ${question.id}-opt-${i}-text`}
                    />
                    <Label
                        for={`${question.id}-opt-${i}`}
                        class="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 font-normal"
                    >
                        <span
                            id={`${question.id}-opt-${i}-letter`}
                            class="text-muted-foreground w-3 shrink-0 font-mono text-xs">{optionLetter(i)}</span
                        >
                        <span id={`${question.id}-opt-${i}-text`} class="rg-markdown min-w-0">{@html optionMarkup}</span
                        >
                    </Label>
                </div>
            {/each}
        </div>
    {:else if question.type === "fill_blank"}
        <div class="flex flex-col gap-2">
            {#each Array.from({ length: blankCount }, (_, i) => i) as i (i)}
                <Input
                    placeholder={t("common.blank", String(i + 1))}
                    aria-label={t("common.blank", String(i + 1))}
                    value={blankValues[i] ?? ""}
                    oninput={(e) => setBlank(i, e.currentTarget.value)}
                />
            {/each}
        </div>
    {:else if question.type === "true_false"}
        <RadioGroup.Root
            class="gap-1.5"
            value={boolValue === null ? "" : String(boolValue)}
            onValueChange={(v) => setBool(v === "true")}
            aria-labelledby={`${question.id}-stem`}
        >
            {#each [{ label: t("common.true"), value: true }, { label: t("common.false"), value: false }] as opt (opt.label)}
                <div
                    class={cn(
                        "hover:bg-accent flex items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 transition-colors",
                        boolValue === opt.value && "border-primary bg-primary/10"
                    )}
                >
                    <RadioGroup.Item id={`${question.id}-tf-${opt.value}`} value={String(opt.value)} class="shrink-0" />
                    <Label for={`${question.id}-tf-${opt.value}`} class="min-w-0 flex-1 cursor-pointer font-normal"
                        >{opt.label}</Label
                    >
                </div>
            {/each}
        </RadioGroup.Root>
    {:else if question.type === "subjective"}
        <Tabs.Root value={subjectiveMode} onValueChange={(v) => (subjectiveMode = v as typeof subjectiveMode)}>
            <Tabs.List class="mb-2">
                <Tabs.Trigger value="edit">{t("question.edit")}</Tabs.Trigger>
                <Tabs.Trigger value="preview">{t("question.preview")}</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="edit">
                <Textarea
                    class="min-h-40"
                    placeholder={t("question.subjectivePlaceholder")}
                    value={subjectiveValue}
                    oninput={(e) => onchange({ type: "subjective", value: e.currentTarget.value })}
                />
            </Tabs.Content>
            <Tabs.Content value="preview">
                <div class="rg-markdown border-border min-h-40 rounded-md border px-3 py-2 text-sm">
                    {#if subjectiveValue.trim()}
                        {@html subjectivePreview}
                    {:else}
                        <span class="text-muted-foreground">{t("question.previewEmpty")}</span>
                    {/if}
                </div>
            </Tabs.Content>
        </Tabs.Root>
    {:else if question.type === "coding"}
        <div class="flex flex-col gap-2">
            <!--
                编辑器外壳。
                工具栏放「语言 / 用例数」与「运行、换行、复制、重置」：
                原先只有一行语言与用例数，改错了代码也没法退回初始代码，
                长行只能靠横向滚动，想看代码长度就得拖来拖去。
            -->
            <div class="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                <span class="bg-muted rounded-sm px-1.5 py-0.5 font-mono">{languageLabel(question.language)}</span>
                {#if question.test_cases?.length}
                    <span>{t("question.testCaseCount", String(question.test_cases.length))}</span>
                {/if}
                <div class="ml-auto flex flex-wrap items-center gap-1">
                    {#if runnable && question.test_cases?.length}
                        <Button size="xs" variant="outline" onclick={() => void runTests()} disabled={running}>
                            {running ? t("question.running") : t("question.runTests")}
                        </Button>
                    {:else if question.test_cases?.length}
                        <!-- 不可执行的语言直接说明原因，而不是让人点一下才知道 -->
                        <span class="text-2xs">{t("runtime.onlyJs", languageLabel(question.language))}</span>
                    {/if}
                    <Button
                        size="xs"
                        variant="ghost"
                        aria-pressed={wrap}
                        class={cn(wrap && "bg-accent text-accent-foreground")}
                        onclick={() => setWrap(!wrap)}
                        title={t("code.wrap")}
                    >
                        {t("code.wrap")}
                    </Button>
                    <Button
                        size="xs"
                        variant="ghost"
                        disabled={!editorReady}
                        onclick={() => void copyCode()}
                        title={t("code.copy")}
                    >
                        {t("code.copy")}
                    </Button>
                    <Button
                        size="xs"
                        variant="ghost"
                        disabled={!editorReady || !question.starter_code}
                        onclick={resetCode}
                        title={t("code.reset")}
                    >
                        {t("code.reset")}
                    </Button>
                </div>
            </div>
            <!--
                容器只画边框、不裁剪：高度上限交给编辑器的 .cm-scroller（见 codemirror.ts），
                外层一旦带 overflow，补全弹层就会被切掉一半。
                min-h 让空代码时也有个像输入框的高度。
            -->
            <div
                class="border-border min-h-40 rounded-md border"
                style="--rg-code-max-h: 24rem"
                bind:this={editorEl}
            ></div>

            {#if runCases}
                <div class="bg-muted/50 flex flex-col gap-1.5 rounded-md p-2 text-xs">
                    <div class="flex flex-wrap items-center gap-2">
                        <Badge variant={passedCount === runCases.length ? "success" : "warning"}>
                            {t("question.runSummary", String(passedCount), String(runCases.length))}
                        </Badge>
                        {#if runLoadError}
                            <span class="text-destructive text-2xs">{t("question.runLoadFailed", runLoadError)}</span>
                        {/if}
                    </div>
                    {#each runCases as outcome (outcome.index)}
                        <div class="flex flex-col gap-0.5">
                            <span class="flex items-center gap-1.5">
                                <Badge variant={outcome.passed ? "success" : "destructive"}>
                                    {outcome.passed ? t("question.casePassed") : t("question.caseFailed")}
                                </Badge>
                                <span class="text-muted-foreground"
                                    >{t("question.caseLabel", String(outcome.index + 1))}</span
                                >
                            </span>
                            {#if outcome.error}
                                <span class="text-destructive font-mono break-all">{outcome.error}</span>
                            {:else if !outcome.passed}
                                <span class="text-muted-foreground font-mono break-all">
                                    {t(
                                        "question.caseExpected",
                                        formatValue(outcome.expected),
                                        formatValue(outcome.actual)
                                    )}
                                </span>
                            {/if}
                        </div>
                    {/each}
                </div>
            {:else if runFailure}
                <p class="text-muted-foreground text-xs">{runFailure}</p>
            {/if}
        </div>
    {/if}
</div>
