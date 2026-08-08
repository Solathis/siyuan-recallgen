<script lang="ts">
    import { onMount } from "svelte";
    import { button, badge, card, separator, cn } from "./components";
    import type { QuizService } from "../quiz/service";
    import type { ScoreRecord } from "@/types/quiz";

    export let service: QuizService;
    export let onOpenReview: (record: ScoreRecord) => void;

    let records: ScoreRecord[] = [];
    let loading = true;
    let groupBy: "date" | "notebook" = "date";
    let viewMode: "thumbnail" | "list" | "table" = "thumbnail";

    onMount(async () => {
        records = await service.listScores();
        records.sort((a, b) => b.timestamp - a.timestamp);
        loading = false;
    });

    $: grouped = groupRecords(records, groupBy);

    function groupRecords(recs: ScoreRecord[], mode: "date" | "notebook") {
        const map = new Map<string, { key: string; items: ScoreRecord[] }>();
        for (const r of recs) {
            let key: string;
            if (mode === "date") {
                const d = new Date(r.timestamp);
                key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            } else {
                key = r.sourceTitle?.replace(/·.*$/, "") || r.title.replace(/·.*$/, "") || "其他";
            }
            if (!map.has(key)) map.set(key, { key, items: [] });
            map.get(key)!.items.push(r);
        }
        return Array.from(map.values());
    }

    function pct(r: ScoreRecord): number {
        return r.maxScore > 0 ? (r.totalScore / r.maxScore) * 100 : 0;
    }
    function timeStr(ts: number): string {
        const d = new Date(ts);
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    function scoreColor(r: ScoreRecord): string {
        const p = pct(r);
        if (p >= 80) return "var(--b3-card-success, #65a84c)";
        if (p >= 60) return "var(--b3-theme-primary)";
        if (p >= 30) return "var(--b3-card-warning, #d97706)";
        return "var(--b3-card-error, #d23f31)";
    }
</script>

<div class="rg-history">
    <header class="rg-history__bar">
        <h2 class="rg-history__title">📋 答题记录</h2>
        <div class="rg-history__controls">
            <div class="rg-history__group">
                <button class="rg-history__seg" class:active={groupBy === "date"} on:click={() => groupBy = "date"}>按日期</button>
                <button class="rg-history__seg" class:active={groupBy === "notebook"} on:click={() => groupBy = "notebook"}>按来源</button>
            </div>
            <div class="rg-history__group">
                <button class="rg-history__seg" class:active={viewMode === "thumbnail"} on:click={() => viewMode = "thumbnail"} title="缩略图">▦</button>
                <button class="rg-history__seg" class:active={viewMode === "list"} on:click={() => viewMode = "list"} title="列表">☰</button>
                <button class="rg-history__seg" class:active={viewMode === "table"} on:click={() => viewMode = "table"} title="表格">⊏</button>
            </div>
        </div>
    </header>

    {#if loading}
        <div class="rg-history__empty">加载中…</div>
    {:else if records.length === 0}
        <div class="rg-history__empty">暂无答题记录</div>
    {:else}
        {#each grouped as group}
            <section class="rg-history__group-section">
                <h3 class="rg-history__group-title">{group.key} <span class="rg-history__count">({group.items.length})</span></h3>

                {#if viewMode === "thumbnail"}
                    <div class="rg-thumb-grid">
                        {#each group.items as r}
                            <div class="rg-thumb" on:click={() => onOpenReview(r)} role="button" tabindex="0">
                                <div class="rg-thumb__score" style="color:{scoreColor(r)}">
                                    {pct(r).toFixed(0)}<span class="rg-thumb__unit">分</span>
                                </div>
                                <div class="rg-thumb__info">
                                    <div class="rg-thumb__title">{r.title}</div>
                                    <div class="rg-thumb__meta">{r.questionCount} 题 · {timeStr(r.timestamp)}</div>
                                </div>
                                <div class="rg-thumb__bar">
                                    <div class="rg-thumb__bar-fill" style="width:{pct(r)}%;background:{scoreColor(r)}"></div>
                                </div>
                            </div>
                        {/each}
                    </div>
                {:else if viewMode === "list"}
                    <div class="rg-list">
                        {#each group.items as r}
                            <div class="rg-list__item" on:click={() => onOpenReview(r)} role="button" tabindex="0">
                                <span class="rg-list__score" style="color:{scoreColor(r)}">{pct(r).toFixed(0)}</span>
                                <span class="rg-list__title">{r.title}</span>
                                <span class="rg-list__meta">{r.questionCount} 题</span>
                                <span class="rg-list__time">{timeStr(r.timestamp)}</span>
                            </div>
                        {/each}
                    </div>
                {:else}
                    <table class="rg-table">
                        <thead>
                            <tr><th>标题</th><th>分数</th><th>题数</th><th>时间</th></tr>
                        </thead>
                        <tbody>
                            {#each group.items as r}
                                <tr on:click={() => onOpenReview(r)} style="cursor:pointer">
                                    <td>{r.title}</td>
                                    <td style="color:{scoreColor(r)}">{pct(r).toFixed(0)} / 100</td>
                                    <td>{r.questionCount}</td>
                                    <td>{timeStr(r.timestamp)}</td>
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
    .rg-history { display: flex; flex-direction: column; gap: 16px; padding: 16px 24px; max-width: 1200px; margin: 0 auto; width: 100%; box-sizing: border-box; }
    .rg-history__bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .rg-history__title { font-size: 18px; font-weight: 600; margin: 0; }
    .rg-history__controls { display: flex; gap: 12px; flex-wrap: wrap; }
    .rg-history__group { display: flex; border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); overflow: hidden; }
    .rg-history__seg { padding: 4px 12px; border: none; background: transparent; cursor: pointer; font-size: 13px; color: var(--b3-theme-on-surface-light); border-radius: 0; }
    .rg-history__seg.active { background: var(--b3-theme-primary); color: #fff; }
    .rg-history__seg:hover:not(.active) { background: var(--b3-list-hover); }
    .rg-history__empty { text-align: center; padding: 48px; color: var(--b3-theme-on-surface-light); font-size: 14px; }
    .rg-history__group-section { display: flex; flex-direction: column; gap: 8px; }
    .rg-history__group-title { font-size: 14px; font-weight: 600; margin: 0; color: var(--b3-theme-on-background); border-bottom: 1px solid var(--b3-border-color); padding-bottom: 4px; }
    .rg-history__count { font-size: 12px; color: var(--b3-theme-on-surface-light); font-weight: 400; }
    /* thumbnail */
    .rg-thumb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
    .rg-thumb { border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius); padding: 12px; cursor: pointer; display: flex; flex-direction: column; gap: 8px; transition: border-color .12s, box-shadow .12s; background: var(--b3-theme-background); }
    .rg-thumb:hover { border-color: var(--b3-theme-primary); box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    .rg-thumb__score { font-size: 28px; font-weight: 700; line-height: 1; }
    .rg-thumb__unit { font-size: 13px; font-weight: 400; margin-left: 2px; }
    .rg-thumb__info { flex: 1; }
    .rg-thumb__title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rg-thumb__meta { font-size: 12px; color: var(--b3-theme-on-surface-light); margin-top: 2px; }
    .rg-thumb__bar { height: 4px; border-radius: 2px; background: var(--b3-theme-surface); overflow: hidden; }
    .rg-thumb__bar-fill { height: 100%; border-radius: 2px; transition: width .3s; }
    /* list */
    .rg-list { display: flex; flex-direction: column; gap: 4px; }
    .rg-list__item { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-radius: var(--b3-border-radius); cursor: pointer; transition: background .12s; }
    .rg-list__item:hover { background: var(--b3-list-hover); }
    .rg-list__score { font-size: 18px; font-weight: 700; min-width: 40px; text-align: right; }
    .rg-list__title { flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rg-list__meta { font-size: 12px; color: var(--b3-theme-on-surface-light); }
    .rg-list__time { font-size: 12px; color: var(--b3-theme-on-surface-light); }
    /* table */
    .rg-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .rg-table th { text-align: left; padding: 6px 12px; font-weight: 600; border-bottom: 1px solid var(--b3-border-color); color: var(--b3-theme-on-surface-light); }
    .rg-table td { padding: 8px 12px; border-bottom: 1px solid var(--b3-border-color); }
    .rg-table tr:hover td { background: var(--b3-list-hover); }
    @media (max-width: 640px) {
        .rg-history { padding: 12px; }
        .rg-thumb-grid { grid-template-columns: 1fr; }
        .rg-list__item { flex-wrap: wrap; }
    }
</style>
