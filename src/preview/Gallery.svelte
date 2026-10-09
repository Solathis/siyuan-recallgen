<script lang="ts">
    /**
     * 预览台外框。
     *
     * 左侧选页面，右侧是被预览组件所在的 iframe；宽度滑块直接改 iframe 元素的宽度，
     * 于是里面的视口断点（以及容器查询）会跟着变——这是能真正看到窄屏表现的关键。
     *
     * iframe 的 src 只在「换页/换语言」时用命令式赋值一次，不用 $state 派生：
     * 被预览的组件自己也会跳页（例如历史页点「回看」跳到结果页），
     * src 若是派生的，会被立刻重置回画廊以为的那一页，等于把用户的点击吃掉。
     *
     * 外框本身也用 shadcn 组件（Button / ToggleGroup / Slider / Textarea / Card / Badge），
     * 与插件界面同一套观感——它虽然是开发工具，但它是唯一被反复盯着看的一屏，
     * 自写样式的工具条会让人误以为插件里也是这样。
     */
    import { onMount } from "svelte";
    import { Badge } from "@/lib/components/ui/badge";
    import { Button } from "@/lib/components/ui/button";
    import { Slider } from "@/lib/components/ui/slider";
    import { Textarea } from "@/lib/components/ui/textarea";
    import * as ToggleGroup from "@/lib/components/ui/toggle-group";
    import { L } from "./labels";
    import { ALL_PAGES, DEFAULT_WIDTH, PAGE_GROUPS, WIDTH_STEPS, pageDef, type PageKey } from "./pages";
    import { PREVIEW_MESSAGE_TYPE, isPreviewPageMessage, type PreviewTheme } from "./state.svelte";
    import { applyThemeVars, clearAppliedVars, loadThemeVars, saveThemeVars } from "./theme-vars";

    type Lang = "zh" | "en";

    const DEFAULT_PAGE: PageKey = "quiz-answering";
    const DEFAULT_LANG: Lang = "zh";
    const PAGE_KEYS = new Set<string>(ALL_PAGES.map((item) => item.key));

    let page = $state<PageKey>(DEFAULT_PAGE);
    let theme = $state<PreviewTheme>("light");
    let lang = $state<Lang>(DEFAULT_LANG);
    let width = $state(DEFAULT_WIDTH);
    let forceMobile = $state(false);
    let showVars = $state(false);
    let varsText = $state("");
    let varsApplied = $state(0);
    let frameEl = $state<HTMLIFrameElement | null>(null);
    let stageEl = $state<HTMLDivElement | null>(null);

    /** 只在初始化时求值一次；后续换页靠 selectPage 直接改 frameEl.src */
    const initialSrc = embedSrc(DEFAULT_PAGE, DEFAULT_LANG);

    /** 把宽度设为舞台可用宽度：窗口不够宽时不必手动拖就能看全整个面板 */
    function fitWidth(): void {
        const available = stageEl?.clientWidth ?? 0;
        if (available > 0) width = Math.max(320, Math.min(1600, Math.floor(available)));
    }

    function embedSrc(target: PageKey, targetLang: Lang): string {
        const url = new URL(location.href);
        url.search = "";
        url.searchParams.set("embed", "1");
        url.searchParams.set("page", target);
        url.searchParams.set("lang", targetLang);
        return url.toString();
    }

    /** 换页与换语言需要重载 iframe；主题与触摸开关走消息，避免每次点都白屏一下 */
    function reload(target: PageKey = page, targetLang: Lang = lang): void {
        if (frameEl) frameEl.src = embedSrc(target, targetLang);
    }

    function selectPage(key: PageKey): void {
        page = key;
        reload(key);
    }

    function selectLang(next: Lang): void {
        lang = next;
        reload(page, next);
    }

    /** 把「怎么显示」推给 iframe；若它还没加载完，onload 会再推一次 */
    function post(): void {
        frameEl?.contentWindow?.postMessage({ type: PREVIEW_MESSAGE_TYPE, theme, forceMobile, varsText }, "*");
    }

    $effect(() => {
        const current = theme;
        document.documentElement.classList.toggle("theme-dark", current === "dark");
        // 明暗各记一套：内联样式会盖过 .theme-dark 的类规则，混用会导致切到深色后不生效
        const stored = loadThemeVars(current);
        varsText = stored;
        varsApplied = applyThemeVars(current, stored);
    });

    $effect(() => {
        void theme;
        void forceMobile;
        void varsText;
        post();
    });

    function applyVars(): void {
        saveThemeVars(theme, varsText);
        varsApplied = applyThemeVars(theme, varsText);
    }

    function resetVars(): void {
        varsText = "";
        saveThemeVars(theme, "");
        clearAppliedVars();
        varsApplied = 0;
    }

    onMount(() => {
        const onMessage = (event: MessageEvent): void => {
            // 组件内部跳页后同步左侧高亮；不动 src，免得把它自己刚跳到的页面又拉回来
            if (isPreviewPageMessage(event.data) && PAGE_KEYS.has(event.data.page)) {
                page = event.data.page as PageKey;
            }
        };
        window.addEventListener("message", onMessage);

        /*
         * 样式文件变更后强制重载 iframe。
         *
         * iframe 里的 HMR 不一定收到 app.css 的样式更新，于是改完样式预览还是旧的——
         * 这类「假故障」代价很高：会让人去改本来正确的地方。
         * 只对 css-update 重载（JS 变更由 HMR 自己处理），代价是丢失面板内的临时状态，
         * 但「看到的必须是最新样式」更重要。
         */
        const hot = import.meta.hot;
        const onAfterUpdate = (payload: { updates?: Array<{ type?: string }> }): void => {
            if (payload?.updates?.some((update) => update.type === "css-update")) reload();
        };
        hot?.on("vite:afterUpdate", onAfterUpdate);

        return () => {
            window.removeEventListener("message", onMessage);
            hot?.off("vite:afterUpdate", onAfterUpdate);
        };
    });
</script>

<div class="rg-scope flex h-full flex-col">
    <!-- 顶栏：品牌 + 三组开关 + 主题变量入口 -->
    <header class="border-border bg-muted/40 flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2">
        <div class="mr-auto flex items-baseline gap-2">
            <strong class="text-sm">{L.appTitle}</strong>
            <span class="text-muted-foreground text-2xs">{L.appSubtitle}</span>
        </div>

        <div class="flex items-center gap-1.5">
            <span id="rgv-theme" class="text-muted-foreground text-xs">{L.theme}</span>
            <ToggleGroup.Root
                type="single"
                value={theme}
                variant="outline"
                size="sm"
                spacing={2}
                aria-labelledby="rgv-theme"
                onValueChange={(next) => next && (theme = next as PreviewTheme)}
            >
                <ToggleGroup.Item value="light">{L.themeLight}</ToggleGroup.Item>
                <ToggleGroup.Item value="dark">{L.themeDark}</ToggleGroup.Item>
            </ToggleGroup.Root>
        </div>

        <div class="flex items-center gap-1.5">
            <span id="rgv-lang" class="text-muted-foreground text-xs">{L.lang}</span>
            <ToggleGroup.Root
                type="single"
                value={lang}
                variant="outline"
                size="sm"
                spacing={2}
                aria-labelledby="rgv-lang"
                onValueChange={(next) => next && selectLang(next as Lang)}
            >
                <ToggleGroup.Item value="zh">{L.langZh}</ToggleGroup.Item>
                <ToggleGroup.Item value="en">{L.langEn}</ToggleGroup.Item>
            </ToggleGroup.Root>
        </div>

        <div class="flex items-center gap-1.5">
            <span id="rgv-touch" class="text-muted-foreground text-xs">{L.touch}</span>
            <ToggleGroup.Root
                type="single"
                value={forceMobile ? "on" : "off"}
                variant="outline"
                size="sm"
                spacing={2}
                aria-labelledby="rgv-touch"
                onValueChange={(next) => next && (forceMobile = next === "on")}
            >
                <ToggleGroup.Item value="off">{L.touchOff}</ToggleGroup.Item>
                <ToggleGroup.Item value="on">{L.touchOn}</ToggleGroup.Item>
            </ToggleGroup.Root>
        </div>

        <Button variant="outline" size="sm" onclick={() => (showVars = !showVars)} aria-expanded={showVars}>
            {L.varsToggle}
        </Button>
    </header>

    {#if showVars}
        <section class="border-border bg-muted/40 flex flex-col gap-2 border-b p-3">
            <p class="text-sm font-medium">{L.varsTitle}</p>
            <p class="text-muted-foreground text-xs">{L.varsDesc}</p>
            <Textarea
                bind:value={varsText}
                placeholder={L.varsPlaceholder}
                aria-label={L.varsTitle}
                class="bg-background min-h-24 font-mono text-xs"
            />
            <div class="flex flex-wrap items-center gap-2">
                <Button size="sm" onclick={applyVars}>{L.varsApply}</Button>
                <Button variant="outline" size="sm" onclick={resetVars}>{L.varsClear}</Button>
                <Badge variant={varsApplied > 0 ? "secondary" : "outline"}>
                    {varsApplied > 0 ? `${L.varsApplied}: ${varsApplied}` : L.varsEmpty}
                </Badge>
            </div>
        </section>
    {/if}

    <div class="flex min-h-0 flex-1">
        <!-- 页面清单 -->
        <nav class="border-border bg-muted/20 w-48 shrink-0 overflow-y-auto border-r p-2" aria-label={L.appTitle}>
            {#each PAGE_GROUPS as group (group.group)}
                <h3 class="text-muted-foreground mt-2 mb-1 px-2 text-2xs font-semibold tracking-wide uppercase">
                    {group.group}
                </h3>
                {#each group.pages as item (item.key)}
                    <Button
                        variant="ghost"
                        size="sm"
                        class="w-full justify-start text-xs {page === item.key ? 'bg-background font-medium' : ''}"
                        aria-current={page === item.key}
                        onclick={() => selectPage(item.key)}
                    >
                        {item.label}
                    </Button>
                {/each}
            {/each}
        </nav>

        <div class="flex min-w-0 flex-1 flex-col">
            <!-- 舞台工具条：宽度滑块 + 档位 + 当前屏要点 -->
            <div class="border-border flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
                <span id="rgv-width" class="text-muted-foreground text-xs">{L.width}</span>
                <div class="w-56">
                    <Slider
                        type="single"
                        min={320}
                        max={1600}
                        step={1}
                        value={width}
                        onValueChange={(v) => (width = v)}
                        aria-labelledby="rgv-width"
                    />
                </div>
                <Badge variant="outline">{width}{L.widthPx}</Badge>
                <Button variant="outline" size="sm" onclick={fitWidth}>{L.widthFit}</Button>
                <Button variant="ghost" size="sm" onclick={() => (width = DEFAULT_WIDTH)}>{L.widthReset}</Button>

                <ToggleGroup.Root
                    type="single"
                    value={String(width)}
                    variant="outline"
                    size="sm"
                    spacing={2}
                    aria-label={L.width}
                    onValueChange={(next) => next && (width = Number(next))}
                >
                    {#each WIDTH_STEPS as step (step)}
                        <ToggleGroup.Item value={String(step)}>{step}</ToggleGroup.Item>
                    {/each}
                </ToggleGroup.Root>

                <span class="text-muted-foreground text-xs">{pageDef(page).hint}</span>
            </div>

            <div class="rgv-stage min-h-0 flex-1 overflow-auto p-4">
                <iframe
                    bind:this={frameEl}
                    src={initialSrc}
                    class="border-border bg-background mx-auto block h-full min-h-[560px] border shadow-sm"
                    style="width: {width}px"
                    title={pageDef(page).label}
                    onload={post}
                ></iframe>
            </div>
        </div>
    </div>
</div>
