<script lang="ts">
    /**
     * 内嵌渲染舞台：在 iframe 里只渲染被预览的那一屏，不带任何外框。
     *
     * 之所以走 iframe 而不是直接摆进画廊：Tailwind 的断点（md: / sm:）读的是
     * 视口宽度，只有把组件放进一个真实宽度受限的文档里，窄屏表现才是真的。
     * 容器查询改造完成后这里同样受益——改宽度就是在改它的容器尺寸。
     */
    import { onMount, untrack } from "svelte";
    import * as Card from "@/lib/components/ui/card";
    import BankPanel from "@/lib/ui/BankPanel.svelte";
    import FlashcardPanel from "@/lib/ui/FlashcardPanel.svelte";
    import HistoryPanel from "@/lib/ui/HistoryPanel.svelte";
    import QuizPanel from "@/lib/ui/QuizPanel.svelte";
    import SettingPanel from "@/lib/ui/SettingPanel.svelte";
    import StatsPanel from "@/lib/ui/StatsPanel.svelte";
    import { setForcedMobile } from "@/lib/ui/media.svelte";
    import type { ImportResult } from "@/lib/quiz/config-io";
    import type { QuizTabData } from "@/lib/quiz/service";
    import { showMessage } from "siyuan";
    import type { RecallGenConfig } from "@/types/config";
    import {
        PREVIEW_DOC_ID,
        PREVIEW_DOC_TITLE,
        previewBankItems,
        previewConfig,
        previewEmptySession,
        previewLatestRecord,
        previewScoreIndex,
        previewScoreRecords,
        previewSession,
        previewNotebooks,
    } from "./fixtures";
    import { createPreviewService } from "./mock-service";
    import type { PageKey } from "./pages";
    import { toasts } from "./toast.svelte";
    import { applyThemeVars } from "./theme-vars";
    import { PREVIEW_PAGE_TYPE, view } from "./state.svelte";

    let { page, scoreId }: { page: PageKey; scoreId?: string } = $props();

    /*
     * 控件必须在子组件挂载之前设好：QuizPanel 的 onMount 会立刻发起生成请求，
     * 若等 $effect 再设，请求已经用默认参数发出去了，慢速/失败这两屏根本看不到。
     * 用 untrack 读 page：它在 iframe 的整个生命周期里不会变（换页是重载 iframe），
     * 这里只是按它挑一组初始参数，不需要响应式。
     */
    const initialPage = untrack(() => page);
    const preview = createPreviewService();
    preview.controls.latency = initialPage === "quiz-generating-slow" ? 2400 : 700;
    preview.controls.failGenerate = initialPage === "quiz-generating-fail";
    preview.controls.emptyGenerate = initialPage === "quiz-generating-empty";
    preview.controls.failConnection = false;
    preview.controls.resumeProgress = false;

    const { service } = preview;

    /** 设置面板内部持有可编辑副本，保存后同步回服务层（验证订阅链路） */
    let config = $state<RecallGenConfig>(previewConfig());

    function saveConfig(next: RecallGenConfig): void {
        config = next;
        preview.setConfig(next);
    }

    /* ── 各屏的 tabData ────────────────────────────────────────── */

    const material = [
        "# Svelte 5 响应式系统",
        "",
        "## runes",
        "",
        "Svelte 5 用 runes 取代旧的响应式声明：`$state` 声明可变状态，`$derived` 声明派生值，",
        "`$effect` 声明副作用。三者都是编译期语法，不是普通的函数调用。",
        "",
        "## 代理与快照",
        "",
        "`$state` 返回的是响应式代理，深层读写都会被追踪。把代理交给外部库或跨线程传递时",
        "必须先用 `$state.snapshot` 取回普通对象。",
        "",
        "## 组件通信",
        "",
        "父组件通过属性传值，子组件用 `$props()` 接收；需要暴露方法时在子组件里",
        "`export function`，父组件用 `bind:this` 拿到实例后调用。",
    ].join("\n");

    const sessionFixture = previewSession();
    const emptyFixture = previewEmptySession();
    const resultRecord = previewScoreRecords.find((record) => record.id === scoreId) ?? previewLatestRecord;
    const resultIndex = previewScoreIndex.find((entry) => entry.id === resultRecord.id) ?? previewScoreIndex[0];

    const generatingTab: QuizTabData = {
        mode: "generate",
        content: material,
        sourceDocId: PREVIEW_DOC_ID,
        sourceTitle: PREVIEW_DOC_TITLE,
    };

    const dateTab: QuizTabData = {
        mode: "dateGenerate",
        sourceDocId: PREVIEW_DOC_ID,
        sourceTitle: previewNotebooks[0].name,
        dateRange: "beforeToday",
        notebookId: previewNotebooks[0].id,
    };

    const answeringTab: QuizTabData = {
        mode: "resume",
        quizId: sessionFixture.id,
        sourceDocId: PREVIEW_DOC_ID,
        sourceTitle: PREVIEW_DOC_TITLE,
    };

    const emptyTab: QuizTabData = {
        mode: "resume",
        quizId: emptyFixture.id,
        sourceDocId: PREVIEW_DOC_ID,
        sourceTitle: PREVIEW_DOC_TITLE,
    };

    const resultTab: QuizTabData = {
        mode: "review",
        sourceDocId: PREVIEW_DOC_ID,
        sourceTitle: resultRecord.title,
        review: {
            entry: resultIndex,
            detail: {
                id: resultRecord.id,
                detail: resultRecord.detail,
                questions: resultRecord.questions,
                analysis: resultRecord.analysis,
            },
        },
    };

    /* ── 面板之间的跳转（在 iframe 内换页）──────────────────────── */

    function navigate(next: PageKey, params: Record<string, string> = {}): void {
        const url = new URL(location.href);
        url.searchParams.set("page", next);
        for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
        location.href = url.toString();
    }

    /** 触摸路径的强制开关：真机上由指针类型决定，预览里手动切 */
    $effect(() => {
        setForcedMobile(view.forceMobile ? true : null);
    });

    /** 主题类挂在 iframe 自己的 html 上，与画廊互不影响 */
    $effect(() => {
        document.documentElement.classList.toggle("theme-dark", view.theme === "dark");
    });

    /** 粘贴的思源主题变量：同样只贴在这个文档上 */
    $effect(() => {
        applyThemeVars(view.theme, view.varsText);
    });

    onMount(() => {
        // 告诉画廊当前渲染的是哪一屏：iframe 内部跳转（例如历史页点「回看」）后
        // 左侧高亮要跟着走，否则会一直停在上一次点击的项上
        window.parent?.postMessage({ type: PREVIEW_PAGE_TYPE, page }, "*");
    });
</script>

<div class="rgv-embed">
    {#if page === "quiz-date-config"}
        <div class="rg-scope h-full"><QuizPanel {service} tabData={dateTab} /></div>
    {:else if page === "quiz-generating" || page === "quiz-generating-slow" || page === "quiz-generating-fail" || page === "quiz-generating-empty"}
        <div class="rg-scope h-full"><QuizPanel {service} tabData={generatingTab} /></div>
    {:else if page === "quiz-answering"}
        <div class="rg-scope h-full"><QuizPanel {service} tabData={answeringTab} /></div>
    {:else if page === "quiz-answering-empty"}
        <div class="rg-scope h-full"><QuizPanel {service} tabData={emptyTab} /></div>
    {:else if page === "quiz-result"}
        <div class="rg-scope h-full"><QuizPanel {service} tabData={resultTab} /></div>
    {:else if page === "flashcard"}
        <div class="rg-scope h-full">
            <FlashcardPanel
                items={previewBankItems()}
                onDone={(grades) => showMessage(`闪卡完成：${grades.length} 张`)}
            />
        </div>
    {:else if page === "bank"}
        <!-- 题库真机上是历史面板的一个分区（外层 p-4），单独预览时要补上同样的内边距 -->
        <div class="rg-scope h-full p-4">
            <BankPanel
                {service}
                lang="zh"
                onStartReview={(scope) => showMessage(`开始复习：${JSON.stringify(scope)}`)}
                openFlashcard={() => navigate("flashcard")}
            />
        </div>
    {:else if page === "stats"}
        <!--
            统计页真机上是历史面板的一个分区（外层 p-4），单独预览时要补上同样的内边距，
            否则内容会紧贴视口边缘，右侧的数值看着像被裁掉了。
        -->
        <div class="rg-scope h-full p-4">
            <StatsPanel
                records={previewScoreIndex}
                loading={false}
                heatmapConfig={config.heatmap}
                lang="zh"
                onStartReview={(scope) => showMessage(`开始复习：${JSON.stringify(scope)}`)}
                onDayClick={() => navigate("history")}
            />
        </div>
    {:else if page === "history"}
        <div class="rg-scope h-full">
            <HistoryPanel
                {service}
                onOpenReview={(entry) => navigate("quiz-result", { score: entry.id })}
                onStartReview={(scope) => showMessage(`开始复习：${JSON.stringify(scope)}`)}
                openFlashcard={() => navigate("flashcard")}
            />
        </div>
    {:else if page === "settings"}
        <!--
            按真实弹窗宽度预览。
            设置面板真机上跑在思源的 Dialog 里（min(1200px, 94vw)），
            直接铺满预览视口会高估可用宽度——那种宽度下并排字段看着够用，
            真机上却会被挤回单列。这里套一层 1200px 的框对齐真实条件。
        -->
        <div class="mx-auto h-full w-full max-w-[1200px]">
            <SettingPanel
                {config}
                scores={previewScoreIndex}
                {service}
                onSave={saveConfig}
                onTestConnection={() => service.testConnection()}
                onClearScores={async () => {
                    await service.clearScores();
                    showMessage("成绩已清空（预览数据，刷新即恢复）");
                }}
                onClearProgress={async () => {
                    await service.clearAllProgress();
                    showMessage("进度已清空");
                }}
                onClearBank={async () => {
                    await service.clearBank();
                    showMessage("题库已清空");
                }}
                onExportBank={() => service.exportBank()}
                onImportBank={(items) => service.importBank(items)}
                onImportConfig={(next: RecallGenConfig, result: ImportResult) => {
                    saveConfig(next);
                    showMessage(`配置已导入，${result.warnings.length} 条提示`);
                }}
                onExportScores={() => service.exportAllScores()}
                onImportScores={(items) => service.importScores(items)}
            />
        </div>
    {/if}

    <!--
        提示条用 shadcn 的 Card 呈现（思源的 showMessage 在浏览器里没有去处）。
        这一层必须带 .rg-scope：app.css 把重置限定在该类内，否则 Card 的边框不成立；
        bg-transparent 用来盖掉 .rg-scope 自带的底色（工具类在后，能压过基础层）。
    -->
    <div class="rg-scope pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2 bg-transparent">
        {#each toasts as toast (toast.id)}
            <Card.Root class="pointer-events-auto shadow-rg-md">
                <Card.Content class="py-2 text-xs">{toast.msg}</Card.Content>
            </Card.Root>
        {/each}
    </div>
</div>
