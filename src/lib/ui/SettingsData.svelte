<script lang="ts">
    import { button, card } from "./components";

    export let onClearScores: () => Promise<void> = async () => {};
    export let onClearProgress: () => Promise<void> = async () => {};
</script>

<div class={card.root}>
    <div class={card.header}>
        <h3 class={card.title}>数据管理</h3>
        <p class={card.description}>清除本地存储的记录</p>
    </div>
    <div class="rg-data-actions">
        <button class={button({ variant: "outline" })} on:click={onClearScores}>清空成绩记录</button>
        <button class={button({ variant: "destructive" })} on:click={onClearProgress}>清空答题进度</button>
    </div>
</div>

<style>
    .rg-data-actions { display: flex; gap: 12px; flex-wrap: wrap; padding: 0 16px 16px; }
</style>
