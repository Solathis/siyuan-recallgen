<script lang="ts">
    import { showMessage } from "siyuan";
    import * as AlertDialog from "@/lib/components/ui/alert-dialog";
    import { Button } from "@/lib/components/ui/button";
    import * as Card from "@/lib/components/ui/card";
    import { t } from "../i18n";

    let {
        onClearScores = async () => {},
        onClearProgress = async () => {},
        scoreCount = 0,
    }: {
        onClearScores?: () => Promise<void>;
        onClearProgress?: () => Promise<void>;
        scoreCount?: number;
    } = $props();

    /** 正在执行的清理动作，用于禁用按钮 */
    let busy = $state<"scores" | "progress" | null>(null);

    async function run(kind: "scores" | "progress", action: () => Promise<void>) {
        busy = kind;
        try {
            await action();
            showMessage(t("settings.data.cleared"), 4000);
        } catch (e) {
            console.error("[RecallGen] 清理数据失败", e);
            showMessage(t("settings.data.clearFailed", (e as Error).message), 7000, "error");
        } finally {
            busy = null;
        }
    }
</script>

<Card.Root>
    <Card.Header>
        <Card.Title>{t("settings.data.title")}</Card.Title>
        <Card.Description>{t("settings.data.desc")}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col gap-4">
        <!--
            清空类操作此前没有任何确认，点一下就永久丢失全部成绩；
            现统一走 AlertDialog 二次确认，并在按钮旁标出影响范围。
        -->
        <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-col">
                <span class="text-sm font-medium">{t("settings.data.clearScores")}</span>
                <span class="text-muted-foreground text-xs">
                    {t("settings.data.clearScoresDesc", String(scoreCount))}
                </span>
            </div>
            <AlertDialog.Root>
                <AlertDialog.Trigger>
                    {#snippet child({ props })}
                        <Button {...props} variant="outline" disabled={busy !== null}>
                            {t("settings.data.clearScores")}
                        </Button>
                    {/snippet}
                </AlertDialog.Trigger>
                <AlertDialog.Content>
                    <AlertDialog.Header>
                        <AlertDialog.Title>{t("settings.data.clearScoresConfirmTitle")}</AlertDialog.Title>
                        <AlertDialog.Description>
                            {t("settings.data.clearScoresConfirmDesc", String(scoreCount))}
                        </AlertDialog.Description>
                    </AlertDialog.Header>
                    <AlertDialog.Footer>
                        <AlertDialog.Cancel>{t("common.cancel")}</AlertDialog.Cancel>
                        <AlertDialog.Action variant="destructive" onclick={() => void run("scores", onClearScores)}>
                            {t("settings.data.confirmClear")}
                        </AlertDialog.Action>
                    </AlertDialog.Footer>
                </AlertDialog.Content>
            </AlertDialog.Root>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-col">
                <span class="text-sm font-medium">{t("settings.data.clearProgress")}</span>
                <span class="text-muted-foreground text-xs">{t("settings.data.clearProgressDesc")}</span>
            </div>
            <AlertDialog.Root>
                <AlertDialog.Trigger>
                    {#snippet child({ props })}
                        <Button {...props} variant="outline" disabled={busy !== null}>
                            {t("settings.data.clearProgress")}
                        </Button>
                    {/snippet}
                </AlertDialog.Trigger>
                <AlertDialog.Content>
                    <AlertDialog.Header>
                        <AlertDialog.Title>{t("settings.data.clearProgressConfirmTitle")}</AlertDialog.Title>
                        <AlertDialog.Description>{t("settings.data.clearProgressConfirmDesc")}</AlertDialog.Description>
                    </AlertDialog.Header>
                    <AlertDialog.Footer>
                        <AlertDialog.Cancel>{t("common.cancel")}</AlertDialog.Cancel>
                        <AlertDialog.Action variant="destructive" onclick={() => void run("progress", onClearProgress)}>
                            {t("settings.data.confirmClear")}
                        </AlertDialog.Action>
                    </AlertDialog.Footer>
                </AlertDialog.Content>
            </AlertDialog.Root>
        </div>
    </Card.Content>
</Card.Root>
