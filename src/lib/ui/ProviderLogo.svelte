<script lang="ts">
    /**
     * 服务商 logo：shadcn Avatar 组合成的方块。
     * 底板固定浅色（--rg-logo-tile）：品牌 logo 按浅底设计，单色的还是纯黑，深色主题的卡片上会看不见。
     * 图标加载失败时显示名称首字。
     */
    import * as Avatar from "@/lib/components/ui/avatar";
    import { cn } from "@/lib/utils";
    import { PROVIDER_ICONS } from "./provider-icons";

    let { icon, name, class: className = "" }: { icon: string; name: string; class?: string } = $props();
</script>

<Avatar.Root class={cn("bg-rg-logo-tile size-9 rounded-lg border p-1.5 after:hidden", className)}>
    {#if PROVIDER_ICONS[icon]}
        <Avatar.Image src={PROVIDER_ICONS[icon]} alt="" class="object-contain" />
    {/if}
    <Avatar.Fallback class="bg-rg-logo-tile text-rg-logo-ink rounded-md text-sm font-semibold"
        >{name.slice(0, 1)}</Avatar.Fallback
    >
</Avatar.Root>
