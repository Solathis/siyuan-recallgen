<script lang="ts">
    import { cn } from "@/lib/utils";
    import { t } from "../i18n";
    import type { RecallGenConfig } from "@/types/config";
    import type { ScoreDetail, ScoreIndexEntry } from "@/types/quiz";
    import SettingsAI from "./SettingsAI.svelte";
    import SettingsAIRoles from "./SettingsAIRoles.svelte";
    import SettingsData from "./SettingsData.svelte";
    import SettingsGeneral from "./SettingsGeneral.svelte";
    import SettingsHeatmap from "./SettingsHeatmap.svelte";
    import SettingsPrompts from "./SettingsPrompts.svelte";
    import { Button } from "@/lib/components/ui/button";
    import CalendarDaysIcon from "@lucide/svelte/icons/calendar-days";
    import DatabaseIcon from "@lucide/svelte/icons/database";
    import MessageSquareTextIcon from "@lucide/svelte/icons/message-square-text";
    import PlugIcon from "@lucide/svelte/icons/plug";
    import SlidersHorizontalIcon from "@lucide/svelte/icons/sliders-horizontal";
    import UsersIcon from "@lucide/svelte/icons/users";

    let {
        config,
        scores = [],
        onTestConnection = async () => "",
        onClearScores = async () => {},
        onClearProgress = async () => {},
        onSave = () => {},
        onClearBank = async () => {},
        onExportBank = async () => [],
        onImportBank = async () => ({ added: 0, skipped: 0 }),
        onImportConfig = () => {},
        onExportScores = async () => ({ entries: [], details: {} }),
        onImportScores = async () => ({ added: 0, skipped: 0 }),
        service,
    }: {
        config: RecallGenConfig;
        service?: import("../quiz/service").QuizService;
        scores?: ScoreIndexEntry[];
        onTestConnection?: () => Promise<string>;
        onClearScores?: () => Promise<void>;
        onClearProgress?: () => Promise<void>;
        onClearBank?: () => Promise<void>;
        onExportBank?: () => Promise<import("@/lib/quiz/bank").BankItem[]>;
        onImportBank?: (items: import("@/lib/quiz/bank").BankItem[]) => Promise<{ added: number; skipped: number }>;
        onImportConfig?: (next: RecallGenConfig, result: import("../quiz/config-io").ImportResult) => void;
        onExportScores?: () => Promise<{ entries: ScoreIndexEntry[]; details: Record<string, ScoreDetail> }>;
        onImportScores?: (
            items: { entry: ScoreIndexEntry; detail: ScoreDetail | null }[]
        ) => Promise<{ added: number; skipped: number }>;
        /** 配置保存回调。Svelte 5 的 mount() 不再暴露 $on，因此改用回调属性 */
        onSave?: (config: RecallGenConfig) => void;
    } = $props();

    /*
     * 分区图标用 lucide 组件而不是 emoji：
     * emoji 的字形由系统字体决定，Windows / macOS / 移动端各不相同，
     * 大小与基线也不受控；lucide 随字号缩放，并与文字共用 currentColor。
     */
    const SECTIONS = [
        { key: "ai", label: t("settings.nav.ai"), icon: PlugIcon },
        { key: "roles", label: t("settings.nav.roles"), icon: UsersIcon },
        { key: "general", label: t("settings.nav.general"), icon: SlidersHorizontalIcon },
        { key: "prompts", label: t("settings.nav.prompts"), icon: MessageSquareTextIcon },
        { key: "heatmap", label: t("settings.nav.heatmap"), icon: CalendarDaysIcon },
        { key: "data", label: t("settings.nav.data"), icon: DatabaseIcon },
    ] as const;

    type SectionKey = (typeof SECTIONS)[number]["key"];
    let active = $state<SectionKey>("ai");
    /**
     * 面板内的配置副本：弹窗打开后父组件的 props 不再更新，
     * 因此以本地副本为准，每次保存后同步刷新；读取初始值包在函数里以避开响应式捕获警告。
     */
    function initialConfig() {
        return config;
    }
    let localConfig = $state(initialConfig());

    /** 题库概览，用于数据管理分区展示与二次确认提示 */
    let bank = $state<{ total: number; due: number }>({ total: 0, due: 0 });
    $effect(() => {
        void service?.bankSummary().then((summary) => (bank = { total: summary.total, due: summary.due }));
    });

    function handleSave(next: RecallGenConfig) {
        localConfig = next;
        onSave(next);
    }

    /**
     * 导入配置。
     * 导入不经过 handleSave，但同样会改变真实配置，
     * 必须同步刷新本地副本：否则面板还显示旧值，用户下一次编辑
     * 就会拿旧副本覆盖掉刚导入的配置。
     */
    function handleImportConfig(next: RecallGenConfig, result: import("../quiz/config-io").ImportResult) {
        localConfig = next;
        onImportConfig(next, result);
    }
</script>

<div class="@container/main rg-scope h-full min-h-0 flex-1">
    <!--
        注意 @container/main 挂在上面那层、flex 排布挂在这一层：
        CSS 容器查询只对容器的**后代**生效，写在容器自身的元素上不会命中，
        于是「够宽就排成两栏」永远不成立（导航会一直压在内容上方）。
    -->
    <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border @3xl/main:flex-row">
        <!--
        导航形态按容器宽度切换，而不是视口宽度：
        设置面板跑在思源的 Dialog 里（min(1080px, 96vw)），窗口再宽弹窗也只有这么宽，
        用 md: 判断「要不要排成左侧竖导航」跟的是浏览器窗口而不是面板本身。
    -->
        <nav
            class="border-border flex w-full shrink-0 gap-1 overflow-x-auto border-b p-2 @3xl/main:w-40 @3xl/main:flex-col @3xl/main:overflow-x-visible @3xl/main:overflow-y-auto @3xl/main:border-r @3xl/main:border-b-0"
            aria-label={t("settings.title")}
        >
            {#each SECTIONS as section (section.key)}
                <Button
                    variant="ghost"
                    class={cn(
                        "h-9 shrink-0 justify-start gap-2 rounded-md border-l-2 px-3 text-left text-sm whitespace-nowrap",
                        active === section.key
                            ? "border-primary bg-background hover:bg-background font-semibold"
                            : "text-muted-foreground border-transparent"
                    )}
                    aria-current={active === section.key}
                    onclick={() => (active = section.key)}
                >
                    <section.icon class="size-4 shrink-0" aria-hidden="true" />
                    <span>{section.label}</span>
                </Button>
            {/each}
        </nav>

        <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
            <!--
            表单列限宽但不居中。
            限宽是因为 Base URL、API Key、端点名这类短字段铺满整行之后，
            「标签-输入框」的对应关系被距离拉断；但居中会在左右各留一块对称空白，
            看起来像没排满。改成左对齐并放宽到 64rem，与左侧导航形成
            「导航 + 内容」的常规两栏观感。
        -->
            <div class="min-h-0 flex-1 overflow-y-auto p-4">
                <div class="flex w-full max-w-5xl flex-col @container">
                    <!-- 按分区做 key：换分区时内容重新入场，切换有反馈 -->
                    {#key active}
                        <div class="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
                            {#if active === "ai"}
                                <SettingsAI config={localConfig} {onTestConnection} onsave={handleSave} />
                            {:else if active === "roles"}
                                <SettingsAIRoles config={localConfig} onsave={handleSave} />
                            {:else if active === "general"}
                                <SettingsGeneral config={localConfig} onsave={handleSave} {service} />
                            {:else if active === "prompts"}
                                <SettingsPrompts config={localConfig} onsave={handleSave} />
                            {:else if active === "heatmap"}
                                <SettingsHeatmap config={localConfig} {scores} onsave={handleSave} />
                            {:else if active === "data"}
                                <SettingsData
                                    {onClearScores}
                                    {onClearProgress}
                                    {onClearBank}
                                    {onExportBank}
                                    {onImportBank}
                                    config={localConfig}
                                    onImportConfig={handleImportConfig}
                                    {onExportScores}
                                    {onImportScores}
                                    existingScoreIds={scores.map((score) => score.id)}
                                    scoreCount={scores.length}
                                    bankSize={bank.total}
                                    bankDue={bank.due}
                                />
                            {/if}
                        </div>
                    {/key}
                </div>
            </div>
        </div>
    </div>
</div>
