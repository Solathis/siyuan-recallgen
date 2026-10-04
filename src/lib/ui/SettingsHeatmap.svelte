<script lang="ts">
    import { Button } from "@/lib/components/ui/button";
    import * as Card from "@/lib/components/ui/card";
    import { Input } from "@/lib/components/ui/input";
    import { Label } from "@/lib/components/ui/label";
    import * as Select from "@/lib/components/ui/select";
    import { t } from "../i18n";
    import type { RecallGenConfig } from "@/types/config";
    import type { HeatmapConfig, ScoreIndexEntry, ScoreRange } from "@/types/quiz";
    import Heatmap from "./Heatmap.svelte";

    let {
        config,
        scores = [],
        onsave,
    }: {
        config: RecallGenConfig;
        scores?: ScoreIndexEntry[];
        onsave: (config: RecallGenConfig) => void;
    } = $props();

    function patchHeatmap(patch: Partial<HeatmapConfig>) {
        onsave({ ...config, heatmap: { ...config.heatmap, ...patch } });
    }

    function patchRange(index: number, patch: Partial<ScoreRange>) {
        const ranges = config.heatmap.ranges.map((r, i) => (i === index ? { ...r, ...patch } : r));
        patchHeatmap({ ranges });
    }

    function removeRange(index: number) {
        patchHeatmap({ ranges: config.heatmap.ranges.filter((_, i) => i !== index) });
    }

    /** 新增区间默认接在现有区间上方，避免与已有区间重叠 */
    function addRange() {
        const mins = config.heatmap.ranges.map((r) => r.min);
        const nextMin = mins.length > 0 ? Math.min(100, Math.max(...mins) + 1) : 0;
        patchHeatmap({ ranges: [...config.heatmap.ranges, { min: nextMin, max: 100, color: "#93c5fd" }] });
    }
</script>

<Card.Root>
    <Card.Header>
        <Card.Title>{t("settings.heatmap.title")}</Card.Title>
        <Card.Description>{t("settings.heatmap.desc")}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
        <Heatmap records={scores} config={config.heatmap} lang={config.general.language} showRangePicker={false} />

        <div class="flex flex-col gap-1.5">
            <Label for="rg-heatmap-metric">{t("settings.heatmap.metric")}</Label>
            <Select.Root
                type="single"
                value={config.heatmap.metric}
                onValueChange={(v) => patchHeatmap({ metric: v as HeatmapConfig["metric"] })}
            >
                <Select.Trigger id="rg-heatmap-metric" class="w-full sm:w-48">
                    {config.heatmap.metric === "max"
                        ? t("settings.heatmap.metricMax")
                        : t("settings.heatmap.metricAvg")}
                </Select.Trigger>
                <Select.Content>
                    <Select.Item value="max">{t("settings.heatmap.metricMax")}</Select.Item>
                    <Select.Item value="avg">{t("settings.heatmap.metricAvg")}</Select.Item>
                </Select.Content>
            </Select.Root>
        </div>

        <div class="flex flex-col gap-2">
            <span class="text-sm font-medium">{t("settings.heatmap.colorRanges")}</span>
            <p class="text-muted-foreground text-xs">{t("settings.heatmap.colorRangesHint")}</p>
            {#each config.heatmap.ranges as range, i (i)}
                <div class="flex flex-wrap items-center gap-2">
                    <Input
                        type="number"
                        class="w-20 text-center"
                        aria-label={t("settings.heatmap.rangeMin")}
                        value={range.min}
                        onchange={(e) =>
                            patchRange(i, { min: Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)) })}
                    />
                    <span class="text-muted-foreground text-xs">—</span>
                    <Input
                        type="number"
                        class="w-20 text-center"
                        aria-label={t("settings.heatmap.rangeMax")}
                        value={range.max}
                        onchange={(e) =>
                            patchRange(i, { max: Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)) })}
                    />
                    <input
                        type="color"
                        class="border-border h-8 w-10 cursor-pointer rounded-sm border bg-transparent p-0.5"
                        aria-label={t("settings.heatmap.rangeColor")}
                        value={range.color}
                        oninput={(e) => patchRange(i, { color: e.currentTarget.value })}
                    />
                    <Button variant="ghost" size="sm" onclick={() => removeRange(i)} aria-label={t("common.delete")}>
                        ✕
                    </Button>
                </div>
            {/each}
            <Button variant="outline" size="sm" class="self-start" onclick={addRange}>
                {t("settings.heatmap.addRange")}
            </Button>
        </div>
    </Card.Content>
</Card.Root>
