<script lang="ts">
    import type { Snippet } from "svelte";
    import { cn } from "@/lib/utils";
    import { rise } from "./motion";

    /**
     * 空态 / 加载态 / 错误态的统一容器。
     *
     * 这三种状态此前在每个面板里各写一遍：有的居中、有的左对齐，有的有图标
     * 有的没有，「恢复到一个空会话」这种还可能整屏空白（什么都不渲染）。
     * 统一成一处之后，至少保证每种状态都是「有图标或骨架 + 一句说明 + 一个出路」。
     */
    let {
        kind = "empty",
        title,
        description = "",
        icon,
        tone = "muted",
        action,
    }: {
        kind?: "empty" | "error" | "loading";
        title: string;
        description?: string;
        /** 一个 emoji 或单个字符；用文本而不是组件，避免三十处各引一个图标库 */
        icon?: string;
        tone?: "muted" | "danger";
        /** 出路：重试、关闭、去设置 */
        action?: Snippet;
    } = $props();

    const toneClass = $derived(tone === "danger" ? "text-destructive" : "text-muted-foreground");
</script>

<div class="flex min-h-40 flex-col items-center justify-center gap-2 px-4 py-10 text-center" in:rise={{ y: 4 }}>
    {#if kind === "loading"}
        <!-- 骨架而不是旋转图标：加载态该提示「将要出现什么形状的内容」 -->
        <div class="flex w-full max-w-2xl flex-col gap-2" aria-hidden="true">
            <div class="bg-muted h-3 w-1/3 animate-pulse rounded-full"></div>
            <div class="bg-muted h-3 w-full animate-pulse rounded-full"></div>
            <div class="bg-muted h-3 w-4/5 animate-pulse rounded-full"></div>
        </div>
        <span class="text-muted-foreground text-xs">{title}</span>
    {:else}
        {#if icon}
            <span class="text-2xl opacity-70" aria-hidden="true">{icon}</span>
        {/if}
        <p class={cn("text-sm font-medium", toneClass)}>{title}</p>
        {#if description}
            <p class="text-muted-foreground max-w-md text-xs leading-relaxed">{description}</p>
        {/if}
        {#if action}
            <div class="mt-1">
                {@render action()}
            </div>
        {/if}
    {/if}
</div>
