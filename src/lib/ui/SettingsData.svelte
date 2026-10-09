<script lang="ts">
    import { showMessage } from "siyuan";
    import * as AlertDialog from "@/lib/components/ui/alert-dialog";
    import { Button } from "@/lib/components/ui/button";
    import { Checkbox } from "@/lib/components/ui/checkbox";
    import { Label } from "@/lib/components/ui/label";
    import * as Card from "@/lib/components/ui/card";
    import { Input } from "@/lib/components/ui/input";
    import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/lib/components/ui/field";
    import { t } from "../i18n";
    import { downloadText, exportStamp } from "./download";
    import { buildBankBackup, parseBankBackup } from "../quiz/bank-backup";
    import { buildConfigExport, mergeImportedConfig, type ImportResult } from "../quiz/config-io";
    import { buildScoreBackup, parseScoreBackup, planBackupImport } from "../quiz/export";
    import type { RecallGenConfig } from "@/types/config";

    let {
        onClearScores = async () => {},
        onClearProgress = async () => {},
        onClearBank = async () => {},
        config,
        onImportConfig = () => {},
        onExportScores = async () => ({ entries: [], details: {} }),
        onImportScores = async () => ({ added: 0, skipped: 0 }),
        onExportBank = async () => [],
        onImportBank = async () => ({ added: 0, skipped: 0 }),
        existingScoreIds = [],
        scoreCount = 0,
        bankSize = 0,
        bankDue = 0,
    }: {
        onClearScores?: () => Promise<void>;
        onClearProgress?: () => Promise<void>;
        onClearBank?: () => Promise<void>;
        /** 当前配置，用于导出与导入合并 */
        config?: RecallGenConfig;
        /** 导入合并后的配置回调 */
        onImportConfig?: (next: RecallGenConfig, result: ImportResult) => void;
        /** 取出全部成绩（索引 + 明细）用于打包备份 */
        onExportScores?: () => Promise<{
            entries: import("@/types/quiz").ScoreIndexEntry[];
            details: Record<string, import("@/types/quiz").ScoreDetail>;
        }>;
        /** 写入导入的成绩 */
        onExportBank?: () => Promise<import("@/lib/quiz/bank").BankItem[]>;
        onImportBank?: (items: import("@/lib/quiz/bank").BankItem[]) => Promise<{ added: number; skipped: number }>;
        onImportScores?: (
            items: {
                entry: import("@/types/quiz").ScoreIndexEntry;
                detail: import("@/types/quiz").ScoreDetail | null;
            }[]
        ) => Promise<{ added: number; skipped: number }>;
        /** 已存在的成绩 id，用于导入时跳过重复项 */
        existingScoreIds?: string[];
        scoreCount?: number;
        bankSize?: number;
        bankDue?: number;
    } = $props();

    /** 正在执行的清理动作，用于禁用按钮 */
    let busy = $state<"scores" | "progress" | "bank" | null>(null);
    /** 导出是否包含 API Key；默认不包含，避免分享配置时泄露密钥 */
    let includeSecrets = $state(false);
    let fileInput: HTMLInputElement | null = $state(null);
    let backupInput: HTMLInputElement | null = $state(null);
    let backupBusy = $state(false);
    let bankInput: HTMLInputElement | null = $state(null);
    let bankBusy = $state(false);

    /**
     * 导出完整备份（含题目与判分明细），与「报表导出」不同：
     * 报表用于阅读与分享，备份用于换机器或恢复数据。
     */
    async function exportBackup() {
        backupBusy = true;
        try {
            const { entries, details } = await onExportScores();
            downloadText(
                `recallgen-backup-${exportStamp()}.json`,
                buildScoreBackup(entries, details),
                "application/json"
            );
            showMessage(t("settings.data.backupExported", String(entries.length)), 4000);
        } catch (e) {
            showMessage(t("settings.data.backupExportFailed", (e as Error).message), 7000, "error");
        } finally {
            backupBusy = false;
        }
    }

    async function importBackup(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;

        backupBusy = true;
        try {
            const backup = parseScoreBackup(await file.text());
            const plan = planBackupImport(backup, existingScoreIds);
            if (plan.items.length === 0) {
                showMessage(t("settings.data.backupNothingNew", String(plan.skipped)), 6000);
                return;
            }
            const result = await onImportScores(plan.items);
            showMessage(t("settings.data.backupImported", String(result.added), String(result.skipped)), 6000);
            for (const warning of plan.warnings.slice(0, 3)) showMessage(warning, 8000);
        } catch (e) {
            showMessage(t("settings.data.backupImportFailed", (e as Error).message), 7000, "error");
        } finally {
            backupBusy = false;
        }
    }

    async function exportBank() {
        bankBusy = true;
        try {
            const items = await onExportBank();
            if (items.length === 0) {
                showMessage(t("settings.data.bankBackupEmpty"), 4000);
                return;
            }
            downloadText(`recallgen-bank-${exportStamp()}.json`, buildBankBackup(items), "application/json");
            showMessage(t("settings.data.bankBackupExported", String(items.length)), 4000);
        } catch (e) {
            showMessage(t("settings.data.bankBackupExportFailed", (e as Error).message), 7000, "error");
        } finally {
            bankBusy = false;
        }
    }

    async function importBankBackup(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        // 清空 value，使同一个文件再次选择时仍会触发 change
        input.value = "";
        if (!file) return;

        bankBusy = true;
        try {
            const parsed = parseBankBackup(await file.text());
            if (parsed.file.items.length === 0) {
                showMessage(t("settings.data.bankBackupEmptyFile"), 6000);
                return;
            }
            const result = await onImportBank(parsed.file.items);
            showMessage(t("settings.data.bankBackupImported", String(result.added), String(result.skipped)), 6000);
            // 解析阶段的问题逐条提示（最多 3 条，其余只计数）
            for (const warning of parsed.warnings.slice(0, 3)) showMessage(warning, 8000);
        } catch (e) {
            showMessage(t("settings.data.bankBackupImportFailed", (e as Error).message), 7000, "error");
        } finally {
            bankBusy = false;
        }
    }

    function exportConfig() {
        if (!config) return;
        try {
            downloadText(
                `recallgen-config-${exportStamp()}.json`,
                buildConfigExport(config, includeSecrets),
                "application/json"
            );
            showMessage(t("settings.data.configExported"), 4000);
        } catch (e) {
            showMessage(t("settings.data.configExportFailed", (e as Error).message), 7000, "error");
        }
    }

    async function importConfig(event: Event) {
        const input = event.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        // 清空 value，使同一个文件再次选择时仍会触发 change
        input.value = "";
        if (!file || !config) return;

        try {
            const text = await file.text();
            const result = mergeImportedConfig(config, text);
            onImportConfig(result.config, result);
            showMessage(
                result.warnings.length > 0
                    ? t("settings.data.configImportedWithWarnings", String(result.warnings.length))
                    : t("settings.data.configImported"),
                result.warnings.length > 0 ? 8000 : 4000
            );
            // 逐条提示最多 3 条，其余仅计数，避免一次导入刷出一屏通知
            for (const warning of result.warnings.slice(0, 3)) showMessage(warning, 8000);
            if (result.warnings.length > 3) {
                console.info("[RecallGen] 导入配置的其余提示", result.warnings.slice(3));
            }
        } catch (e) {
            showMessage(t("settings.data.configImportFailed", (e as Error).message), 7000, "error");
        }
    }

    async function run(kind: "scores" | "progress" | "bank", action: () => Promise<void>) {
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

<div class="flex flex-col gap-4">
    <!--
        两张卡：可逆的备份/迁移与不可逆的清空分开。
        原先六项操作平铺在同一张卡里，两个「清空」夹在导出按钮之间，
        点错就是永久丢失；现在危险操作单独一张卡并加破坏色边框。
    -->
    <Card.Root>
        <Card.Header>
            <Card.Title>{t("settings.data.title")}</Card.Title>
            <Card.Description>{t("settings.data.desc")}</Card.Description>
        </Card.Header>
        <Card.Content>
            <FieldGroup>
                <!--
                每行用 Field（横向）：左侧标签与说明、右侧操作按钮。
                窄容器下 Field 自己折成上下两段，不再靠 flex-wrap 手工凑。
            -->
                <Field orientation="responsive">
                    <div class="flex flex-col gap-0.5">
                        <FieldLabel>{t("settings.data.backup")}</FieldLabel>
                        <FieldDescription>{t("settings.data.backupDesc")}</FieldDescription>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <Button
                            variant="outline"
                            onclick={() => void exportBackup()}
                            disabled={backupBusy || scoreCount === 0}
                        >
                            {t("settings.data.backupExport")}
                        </Button>
                        <Button variant="outline" onclick={() => backupInput?.click()} disabled={backupBusy}>
                            {t("settings.data.backupImport")}
                        </Button>
                        <!-- 隐藏在按钮背后的文件选择器：没有可见外观，保留原生 input 即可 -->
                        <Input
                            bind:ref={backupInput}
                            type="file"
                            accept="application/json,.json"
                            class="hidden"
                            aria-label={t("settings.data.backupImport")}
                            onchange={importBackup}
                        />
                    </div>
                </Field>

                <Field orientation="responsive">
                    <div class="flex flex-col gap-0.5">
                        <FieldLabel>{t("settings.data.config")}</FieldLabel>
                        <FieldDescription>{t("settings.data.configDesc")}</FieldDescription>
                        <Label class="mt-1 flex items-center gap-2 text-xs font-normal">
                            <Checkbox
                                class="size-3.5"
                                checked={includeSecrets}
                                onCheckedChange={(checked) => (includeSecrets = checked === true)}
                            />
                            {t("settings.data.configIncludeSecrets")}
                        </Label>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <Button variant="outline" onclick={exportConfig} disabled={!config}>
                            {t("settings.data.configExport")}
                        </Button>
                        <Button variant="outline" onclick={() => fileInput?.click()} disabled={!config}>
                            {t("settings.data.configImport")}
                        </Button>
                        <!-- 隐藏的文件选择器：思源环境没有可用的原生文件对话框 API -->
                        <Input
                            bind:ref={fileInput}
                            type="file"
                            accept="application/json,.json"
                            class="hidden"
                            aria-label={t("settings.data.configImport")}
                            onchange={importConfig}
                        />
                    </div>
                </Field>

                <Field orientation="responsive">
                    <div class="flex flex-col gap-0.5">
                        <FieldLabel>{t("settings.data.bank")}</FieldLabel>
                        <FieldDescription>
                            {t("settings.data.bankDesc", String(bankSize), String(bankDue))}
                        </FieldDescription>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <Button
                            variant="outline"
                            onclick={() => void exportBank()}
                            disabled={bankBusy || bankSize === 0}
                        >
                            {t("settings.data.bankExport")}
                        </Button>
                        <Button variant="outline" onclick={() => bankInput?.click()} disabled={bankBusy}>
                            {t("settings.data.bankImport")}
                        </Button>
                        <Input
                            bind:ref={bankInput}
                            type="file"
                            accept="application/json,.json"
                            class="hidden"
                            aria-label={t("settings.data.bankImport")}
                            onchange={importBankBackup}
                        />
                    </div>
                </Field>
            </FieldGroup>
        </Card.Content>
    </Card.Root>

    <Card.Root class="border-destructive/40">
        <Card.Header>
            <Card.Title class="text-destructive">{t("settings.data.dangerTitle")}</Card.Title>
            <Card.Description>{t("settings.data.dangerDesc")}</Card.Description>
        </Card.Header>
        <Card.Content>
            <FieldGroup>
                <Field orientation="responsive">
                    <div class="flex flex-col gap-0.5">
                        <FieldLabel>{t("settings.data.clearScores")}</FieldLabel>
                        <FieldDescription>{t("settings.data.clearScoresDesc", String(scoreCount))}</FieldDescription>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
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
                                    <AlertDialog.Action
                                        variant="destructive"
                                        onclick={() => void run("scores", onClearScores)}
                                    >
                                        {t("settings.data.confirmClear")}
                                    </AlertDialog.Action>
                                </AlertDialog.Footer>
                            </AlertDialog.Content>
                        </AlertDialog.Root>
                    </div>
                </Field>

                <Field orientation="responsive">
                    <div class="flex flex-col gap-0.5">
                        <FieldLabel>{t("settings.data.clearProgress")}</FieldLabel>
                        <FieldDescription>{t("settings.data.clearProgressDesc")}</FieldDescription>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
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
                                    <AlertDialog.Title>{t("settings.data.clearProgressConfirmTitle")}</AlertDialog.Title
                                    >
                                    <AlertDialog.Description
                                        >{t("settings.data.clearProgressConfirmDesc")}</AlertDialog.Description
                                    >
                                </AlertDialog.Header>
                                <AlertDialog.Footer>
                                    <AlertDialog.Cancel>{t("common.cancel")}</AlertDialog.Cancel>
                                    <AlertDialog.Action
                                        variant="destructive"
                                        onclick={() => void run("progress", onClearProgress)}
                                    >
                                        {t("settings.data.confirmClear")}
                                    </AlertDialog.Action>
                                </AlertDialog.Footer>
                            </AlertDialog.Content>
                        </AlertDialog.Root>
                    </div>
                </Field>

                <Field orientation="responsive">
                    <div class="flex flex-col gap-0.5">
                        <FieldLabel>{t("settings.data.clearBank")}</FieldLabel>
                        <FieldDescription>
                            {t("settings.data.clearBankConfirmDesc", String(bankSize))}
                        </FieldDescription>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <AlertDialog.Root>
                            <AlertDialog.Trigger>
                                {#snippet child({ props })}
                                    <Button {...props} variant="outline" disabled={busy !== null || bankSize === 0}>
                                        {t("settings.data.clearBank")}
                                    </Button>
                                {/snippet}
                            </AlertDialog.Trigger>
                            <AlertDialog.Content>
                                <AlertDialog.Header>
                                    <AlertDialog.Title>{t("settings.data.clearBankConfirmTitle")}</AlertDialog.Title>
                                    <AlertDialog.Description>
                                        {t("settings.data.clearBankConfirmDesc", String(bankSize))}
                                    </AlertDialog.Description>
                                </AlertDialog.Header>
                                <AlertDialog.Footer>
                                    <AlertDialog.Cancel>{t("common.cancel")}</AlertDialog.Cancel>
                                    <AlertDialog.Action
                                        variant="destructive"
                                        onclick={() => void run("bank", onClearBank)}
                                    >
                                        {t("settings.data.confirmClear")}
                                    </AlertDialog.Action>
                                </AlertDialog.Footer>
                            </AlertDialog.Content>
                        </AlertDialog.Root>
                    </div>
                </Field>
            </FieldGroup>
        </Card.Content>
    </Card.Root>
</div>
