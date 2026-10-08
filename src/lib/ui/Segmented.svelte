<script lang="ts">
    import { cn } from "@/lib/utils";

    /**
     * 分段选择器。
     *
     * 用来替掉目前三类各写一遍、样式还互不一致的东西：
     * 结果页与历史页的「列表/网格/表格」切换、主观题的「编辑/预览」、
     * 以及设置页里的几处二选一。
     *
     * 语义用 role="group" + aria-pressed 的按钮组，而不是 tablist：
     * 这些控件大多是「筛掉一部分内容」或「换一种呈现」，不是切换互斥面板；
     * 按 tab 语义标注会让读屏软件承诺一个并不存在的 tabpanel 关系。
     */
    type Item = {
        value: string;
        label: string;
        /** 右侧计数，用于结果页筛选这类带数量的场景 */
        count?: number;
        /** 计数用警告色标出（例如未答题） */
        alert?: boolean;
    };

    let {
        items,
        value,
        onchange,
        ariaLabel,
        size = "md",
        grow = false,
    }: {
        items: Item[];
        value: string;
        onchange: (value: string) => void;
        ariaLabel: string;
        size?: "sm" | "md";
        /** 是否平分容器宽度（窄屏上更整齐） */
        grow?: boolean;
    } = $props();
</script>

<div
    class={cn(
        "border-border bg-muted/60 rg-hscroll inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md border p-0.5",
        size === "sm" ? "text-xs" : "text-sm",
        grow && "flex w-full"
    )}
    role="group"
    aria-label={ariaLabel}
>
    {#each items as item (item.value)}
        <button
            type="button"
            class={cn(
                "shrink-0 rounded-sm px-2.5 whitespace-nowrap transition-colors",
                size === "sm" ? "py-0.5" : "py-1",
                grow && "flex-1",
                value === item.value
                    ? "bg-background text-foreground shadow-rg-sm font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
            aria-pressed={value === item.value}
            onclick={() => onchange(item.value)}
        >
            <span>{item.label}</span>
            {#if item.count !== undefined}
                <span
                    class={cn(
                        "ml-1 text-2xs tabular-nums",
                        item.alert && item.count > 0 ? "text-destructive font-semibold" : "text-muted-foreground"
                    )}>{item.count}</span
                >
            {/if}
        </button>
    {/each}
</div>
