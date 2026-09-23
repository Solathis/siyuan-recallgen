<script lang="ts">
    import { onMount } from "svelte";
    import { confirm, showMessage } from "siyuan";
    import { t } from "../i18n";
    import type { QuizService } from "../quiz/service";
    import type { ScoreIndexEntry } from "@/types/quiz";

    export let service: QuizService;
    export let onOpenReview: (entry: ScoreIndexEntry) => void;

    let records: ScoreIndexEntry[] = [];
    let loading = true;
    let groupBy: "date" | "notebook" = "date";
    let viewMode: "thumbnail" | "list" | "table" = "thumbnail";

    onMount(async () => {
        // 不再原地排序：store 返回的数组可能与其内部缓存共享引用
        records = await service.listScores();
        loading = false;
    });

    $: grouped = groupRecords(records, groupBy);

    function groupRecords(recs: ScoreIndexEntry[], mode: "date" | "notebook") {
        const map = new Map<string, { key: string; items: ScoreIndexEntry[] }>();
        for (const r of recs) {
            let key: string;
            if (mode === "date") {
                const d = new Date(r.timestamp);
                key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            } else {
                key = r.sourceTitle?.replace(/·.*$/, "") || r.title.replace(/·.*$/, "") || t("common.unanswered");
            }
            if (!map.has(key)) map.set(key, { key, items: [] });
            map.get(key)!.items.push(r);
        }
        return Array.from(map.values());
    }

    function pct(r: ScoreIndexEntry): number {
        return r.maxScore > 0 ? (r.totalScore / r.maxScore) * 100 : 0;
    }
    function timeStr(ts: number): string {
        const d = new Date(ts);
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    /** 删除单条成绩：二次确认后同时删除索引与明细 */
    function removeRecord(entry: ScoreIndexEntry, e: Event) {
        e.stopPropagation();
        confirm(t("history.deleteOne"), t("history.deleteConfirm", entry.title), () => {
            void service
                .removeScore(entry.id)
                .then(() => {
                    records = records.filter((r) => r.id !== entry.id);
                    showMessage(t("history.deleted"), 4000);
                })
                .catch((err) => {
                    console.error("[RecallGen] 删除成绩失败", err);
                    showMessage(t("history.deleteFailed", (err as Error).message), 7000, "error");
                });
        });
    }

    function scoreColor(r: ScoreIndexEntry): string {
        const p = pct(r);
        if (p >= 80) return "var(--b3-card-success, #65a84c)";
        if (p >= 60) return "var(--b3-theme-primary)";
        if (p >= 30) return "var(--b3-card-warning, #d97706)";
        return "var(--b3-card-error, #d23f31)";
    }
</script>

<div class="rg-history">
    <header class="rg-history__bar">
        <h2 class="rg-history__title">{t("history.title")}</h2>
        <div class="rg-history__controls">
            <div class="rg-history__group">
                <button class="rg-history__seg" class:active={groupBy === "date"} on:click={() => (groupBy = "date")}
                    >{t("history.byDate")}</button
                >
                <button
                    class="rg-history__seg"
                    class:active={groupBy === "notebook"}
                    on:click={() => (groupBy = "notebook")}>{t("history.bySource")}</button
                >
            </div>
            <div class="rg-history__group">
                <button
                    class="rg-history__seg"
                    class:active={viewMode === "thumbnail"}
                    on:click={() => (viewMode = "thumbnail")}
                    title={t("history.thumb")}>▦</button
                >
                <button
                    class="rg-history__seg"
                    class:active={viewMode === "list"}
                    on:click={() => (viewMode = "list")}
                    title={t("history.list")}>☰</button
                >
                <button
                    class="rg-history__seg"
                    class:active={viewMode === "table"}
                    on:click={() => (viewMode = "table")}
                    title={t("history.table")}>⊏</button
                >
            </div>
        </div>
    </header>

    {#if loading}
        <div class="rg-history__empty">{t("common.loading")}</div>
    {:else if records.length === 0}
        <div class="rg-history__empty">{t("history.empty")}</div>
    {:else}
        {#each grouped as group}
            <section class="rg-history__group-section">
                <h3 class="rg-history__group-title">
                    {group.key} <span class="rg-history__count">({group.items.length})</span>
                </h3>

                {#if viewMode === "thumbnail"}
                    <div class="rg-thumb-grid">
                        {#each group.items as r (r.id)}
                            <div class="rg-thumb">
                                <button type="button" class="rg-thumb__open" on:click={() => onOpenReview(r)}>
                                    <span class="rg-thumb__score" style="color:{scoreColor(r)}">
                                        {pct(r).toFixed(0)}<span class="rg-thumb__unit">{t("history.pts")}</span>
                                    </span>
                                    <span class="rg-thumb__info">
                                        <span class="rg-thumb__title">{r.title}</span>
                                        <span class="rg-thumb__meta">
                                            {t("result.qCount", String(r.questionCount))} · {timeStr(r.timestamp)}
                                        </span>
                                    </span>
                                    <span class="rg-thumb__bar">
                                        <span
                                            class="rg-thumb__bar-fill"
                                            style="width:{pct(r)}%;background:{scoreColor(r)}"
                                        ></span>
                                    </span>
                                </button>
                                <button
                                    type="button"
                                    class="rg-thumb__del"
                                    title={t("history.deleteOne")}
                                    aria-label={t("history.deleteOne")}
                                    on:click={(e) => removeRecord(r, e)}>✕</button
                                >
                            </div>
                        {/each}
                    </div>
                {:else if viewMode === "list"}
                    <div class="rg-list">
                        {#each group.items as r (r.id)}
                            <div class="rg-list__row">
                                <button type="button" class="rg-list__item" on:click={() => onOpenReview(r)}>
                                    <span class="rg-list__score" style="color:{scoreColor(r)}">{pct(r).toFixed(0)}</span
                                    >
                                    <span class="rg-list__title">{r.title}</span>
                                    <span class="rg-list__meta">{t("result.qCount", String(r.questionCount))}</span>
                                    <span class="rg-list__time">{timeStr(r.timestamp)}</span>
                                </button>
                                <button
                                    type="button"
                                    class="rg-list__del"
                                    title={t("history.deleteOne")}
                                    aria-label={t("history.deleteOne")}
                                    on:click={(e) => removeRecord(r, e)}>✕</button
                                >
                            </div>
                        {/each}
                    </div>
                {:else}
                    <table class="rg-table">
                        <thead>
                            <tr
                                ><th>{t("history.colTitle")}</th><th>{t("history.colScore")}</th><th
                                    >{t("history.colCount")}</th
                                ><th>{t("history.colTime")}</th><th class="rg-table__op"></th></tr
                            >
                        </thead>
                        <tbody>
                            {#each group.items as r (r.id)}
                                <tr>
                                    <td
                                        ><button type="button" class="rg-table__link" on:click={() => onOpenReview(r)}
                                            >{r.title}</button
                                        ></td
                                    >
                                    <td style="color:{scoreColor(r)}">{pct(r).toFixed(0)} / 100</td>
                                    <td>{r.questionCount}</td>
                                    <td>{timeStr(r.timestamp)}</td>
                                    <td class="rg-table__op"
                                        ><button
                                            type="button"
                                            class="rg-table__del"
                                            title={t("history.deleteOne")}
                                            aria-label={t("history.deleteOne")}
                                            on:click={(e) => removeRecord(r, e)}>✕</button
                                        ></td
                                    >
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                {/if}
            </section>
        {/each}
    {/if}
</div>

<style>
    .rg-history {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px 24px;
        max-width: 1200px;
        margin: 0 auto;
        width: 100%;
        box-sizing: border-box;
    }
    .rg-history__bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
    }
    .rg-history__title {
        font-size: 18px;
        font-weight: 600;
        margin: 0;
    }
    .rg-history__controls {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
    }
    .rg-history__group {
        display: flex;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius);
        overflow: hidden;
    }
    .rg-history__seg {
        padding: 4px 12px;
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 13px;
        color: var(--b3-theme-on-surface-light);
        border-radius: 0;
    }
    .rg-history__seg.active {
        background: var(--b3-theme-primary);
        color: #fff;
    }
    .rg-history__seg:hover:not(.active) {
        background: var(--b3-list-hover);
    }
    .rg-history__empty {
        text-align: center;
        padding: 48px;
        color: var(--b3-theme-on-surface-light);
        font-size: 14px;
    }
    .rg-history__group-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .rg-history__group-title {
        font-size: 14px;
        font-weight: 600;
        margin: 0;
        color: var(--b3-theme-on-background);
        border-bottom: 1px solid var(--b3-border-color);
        padding-bottom: 4px;
    }
    .rg-history__count {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        font-weight: 400;
    }
    /* thumbnail */
    .rg-thumb-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 12px;
    }
    .rg-thumb {
        position: relative;
        border: 1px solid var(--b3-border-color);
        border-radius: var(--b3-border-radius);
        background: var(--b3-theme-background);
        transition:
            border-color 0.12s,
            box-shadow 0.12s;
    }
    .rg-thumb__open {
        appearance: none;
        -webkit-appearance: none;
        font: inherit;
        color: inherit;
        text-align: left;
        width: 100%;
        padding: 12px;
        border: none;
        background: transparent;
        border-radius: var(--b3-border-radius);
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .rg-thumb__open:focus-visible {
        outline: 2px solid var(--b3-theme-primary);
        outline-offset: -2px;
    }
    .rg-thumb:hover {
        border-color: var(--b3-theme-primary);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }
    .rg-thumb__score {
        font-size: 28px;
        font-weight: 700;
        line-height: 1;
    }
    .rg-thumb__unit {
        font-size: 13px;
        font-weight: 400;
        margin-left: 2px;
    }
    .rg-thumb__info {
        flex: 1;
        display: flex;
        flex-direction: column;
    }
    .rg-thumb__score,
    .rg-thumb__title,
    .rg-thumb__meta {
        display: block;
    }
    .rg-thumb__bar {
        display: block;
    }
    .rg-thumb__title {
        font-size: 13px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .rg-thumb__meta {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        margin-top: 2px;
    }
    .rg-thumb__bar {
        height: 4px;
        border-radius: 2px;
        background: var(--b3-theme-surface);
        overflow: hidden;
    }
    .rg-thumb__bar-fill {
        height: 100%;
        border-radius: 2px;
        transition: width 0.3s;
    }
    /* list */
    .rg-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .rg-list__row {
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .rg-list__row .rg-list__item {
        flex: 1;
        min-width: 0;
    }
    .rg-list__item {
        appearance: none;
        -webkit-appearance: none;
        font: inherit;
        color: inherit;
        text-align: left;
        width: 100%;
        background: transparent;
        border: none;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        border-radius: var(--b3-border-radius);
        cursor: pointer;
        transition: background 0.12s;
    }
    .rg-list__item:hover {
        background: var(--b3-list-hover);
    }
    .rg-list__score {
        font-size: 18px;
        font-weight: 700;
        min-width: 40px;
        text-align: right;
    }
    .rg-list__title {
        flex: 1;
        font-size: 13px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .rg-list__meta {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
    }
    .rg-list__time {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
    }
    /* table */
    .rg-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
    }
    .rg-table th {
        text-align: left;
        padding: 6px 12px;
        font-weight: 600;
        border-bottom: 1px solid var(--b3-border-color);
        color: var(--b3-theme-on-surface-light);
    }
    .rg-table td {
        padding: 8px 12px;
        border-bottom: 1px solid var(--b3-border-color);
    }
    .rg-table tr:hover td {
        background: var(--b3-list-hover);
    }
    .rg-table__link {
        appearance: none;
        -webkit-appearance: none;
        font: inherit;
        color: inherit;
        text-align: left;
        padding: 0;
        border: none;
        background: transparent;
        cursor: pointer;
        text-decoration: underline;
        text-decoration-color: transparent;
        transition: text-decoration-color 0.12s;
    }
    .rg-table__link:hover {
        text-decoration-color: currentColor;
    }
    .rg-table__link:focus-visible {
        outline: 2px solid var(--b3-theme-primary);
        outline-offset: 2px;
    }

    /* 删除按钮：默认半透明，悬停/聚焦时高亮 */
    .rg-thumb__del,
    .rg-list__del,
    .rg-table__del {
        appearance: none;
        -webkit-appearance: none;
        padding: 0;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--b3-theme-on-surface-light);
        line-height: 1;
        cursor: pointer;
        flex-shrink: 0;
        transition:
            opacity 0.12s,
            background 0.12s,
            color 0.12s;
    }
    .rg-thumb__del {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 22px;
        height: 22px;
        font-size: 12px;
        opacity: 0;
    }
    .rg-list__del,
    .rg-table__del {
        width: 24px;
        height: 24px;
        font-size: 12px;
        opacity: 0.45;
    }
    .rg-thumb:hover .rg-thumb__del {
        opacity: 1;
    }
    .rg-thumb__del:hover,
    .rg-list__del:hover,
    .rg-table__del:hover,
    .rg-thumb__del:focus-visible,
    .rg-list__del:focus-visible,
    .rg-table__del:focus-visible {
        background: var(--b3-card-error, #d23f31);
        color: #fff;
        opacity: 1;
        outline: none;
    }
    .rg-table__op {
        width: 40px;
        text-align: center;
    }
    @media (max-width: 640px) {
        .rg-history {
            padding: 12px;
        }
        .rg-thumb-grid {
            grid-template-columns: 1fr;
        }
        .rg-list__item {
            flex-wrap: wrap;
        }
    }
</style>
