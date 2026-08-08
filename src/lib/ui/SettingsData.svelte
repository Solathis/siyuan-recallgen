<script lang="ts">
    import { button, card } from "./components";
    import { t } from "../i18n";

    export let onClearScores: () => Promise<void> = async () => {};
    export let onClearProgress: () => Promise<void> = async () => {};
</script>

<div class={card.root}>
    <div class={card.header}>
        <h3 class={card.title}>{t("settings.data.title")}</h3>
        <p class={card.description}>{t("settings.data.desc")}</p>
    </div>
    <div class="rg-data-actions">
        <button class={button({ variant: "outline" })} on:click={onClearScores}>{t("settings.data.clearScores")}</button>
        <button class={button({ variant: "destructive" })} on:click={onClearProgress}>{t("settings.data.clearProgress")}</button>
    </div>
</div>

<style>
    .rg-data-actions { display: flex; gap: 12px; flex-wrap: wrap; padding: 0 16px 16px; }
</style>
