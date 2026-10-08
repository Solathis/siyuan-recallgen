<script lang="ts">
    /**
     * 预览台外框。
     *
     * 左侧选页面，右侧是被预览组件所在的 iframe；宽度拉杆直接改 iframe 元素的宽度，
     * 于是里面的视口断点（以及后续的容器查询）会跟着变——这是能真正看到窄屏表现的关键。
     *
     * iframe 的 src 只在「换页/换语言」时用命令式赋值一次，不用 $state 派生：
     * 被预览的组件自己也会跳页（例如历史页点「回看」跳到结果页），
     * src 若是派生的，会被立刻重置回画廊以为的那一页，等于把用户的点击吃掉。
     */
    import { onMount } from "svelte";
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

<div class="rgv-app">
    <header class="rgv-topbar">
        <div class="rgv-brand">
            <strong>{L.appTitle}</strong>
            <span>{L.appSubtitle}</span>
        </div>

        <div class="rgv-group">
            <span id="rgv-theme">{L.theme}</span>
            <span class="rgv-seg" role="group" aria-labelledby="rgv-theme">
                <button type="button" aria-pressed={theme === "light"} onclick={() => (theme = "light")}
                    >{L.themeLight}</button
                >
                <button type="button" aria-pressed={theme === "dark"} onclick={() => (theme = "dark")}
                    >{L.themeDark}</button
                >
            </span>
        </div>

        <div class="rgv-group">
            <span id="rgv-lang">{L.lang}</span>
            <span class="rgv-seg" role="group" aria-labelledby="rgv-lang">
                <button type="button" aria-pressed={lang === "zh"} onclick={() => selectLang("zh")}>{L.langZh}</button>
                <button type="button" aria-pressed={lang === "en"} onclick={() => selectLang("en")}>{L.langEn}</button>
            </span>
        </div>

        <div class="rgv-group">
            <span id="rgv-touch">{L.touch}</span>
            <span class="rgv-seg" role="group" aria-labelledby="rgv-touch">
                <button type="button" aria-pressed={!forceMobile} onclick={() => (forceMobile = false)}
                    >{L.touchOff}</button
                >
                <button type="button" aria-pressed={forceMobile} onclick={() => (forceMobile = true)}
                    >{L.touchOn}</button
                >
            </span>
        </div>

        <button type="button" class="rgv-btn" onclick={() => (showVars = !showVars)}>{L.varsToggle}</button>
    </header>

    {#if showVars}
        <section class="rgv-vars">
            <p><strong>{L.varsTitle}</strong></p>
            <p>{L.varsDesc}</p>
            <textarea bind:value={varsText} placeholder={L.varsPlaceholder} aria-label={L.varsTitle}></textarea>
            <div class="rgv-vars-row">
                <button type="button" class="rgv-btn" onclick={applyVars}>{L.varsApply}</button>
                <button type="button" class="rgv-btn" onclick={resetVars}>{L.varsClear}</button>
                <span>{varsApplied > 0 ? `${L.varsApplied}: ${varsApplied}` : L.varsEmpty}</span>
            </div>
        </section>
    {/if}

    <div class="rgv-body">
        <nav class="rgv-nav" aria-label={L.appTitle}>
            {#each PAGE_GROUPS as group (group.group)}
                <h3>{group.group}</h3>
                {#each group.pages as item (item.key)}
                    <button type="button" aria-current={page === item.key} onclick={() => selectPage(item.key)}>
                        {item.label}
                    </button>
                {/each}
            {/each}
        </nav>

        <div class="rgv-stage-wrap">
            <div class="rgv-stage-bar">
                <span id="rgv-width">{L.width}</span>
                <input type="range" min="320" max="1600" step="1" bind:value={width} aria-labelledby="rgv-width" />
                <span>{width}{L.widthPx}</span>
                <button type="button" class="rgv-btn" onclick={fitWidth}>{L.widthFit}</button>
                <button type="button" class="rgv-btn" onclick={() => (width = DEFAULT_WIDTH)}>{L.widthReset}</button>
                <span class="rgv-seg" role="group" aria-label={L.width}>
                    {#each WIDTH_STEPS as step (step)}
                        <button type="button" aria-pressed={width === step} onclick={() => (width = step)}>
                            {step}
                        </button>
                    {/each}
                </span>
                <span>{pageDef(page).hint}</span>
            </div>

            <div class="rgv-stage-scroll" bind:this={stageEl}>
                <iframe
                    bind:this={frameEl}
                    src={initialSrc}
                    class="rgv-stage rgv-stage--iframe"
                    style="width: {width}px"
                    title={pageDef(page).label}
                    onload={post}
                ></iframe>
            </div>
        </div>
    </div>
</div>
