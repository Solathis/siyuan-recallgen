<script lang="ts">
    import { writable, type Writable } from "svelte/store";
    import { getContext } from "svelte";
    import { tabs as t, TABS_KEY } from "./index";

    export let value: string = "";

    const active = getContext<Writable<string>>(TABS_KEY) ?? writable(value);
    let show = false;
    $: show = value === $active;
</script>

{#if show}
    <div class={t.content} role="tabpanel">
        <slot />
    </div>
{/if}
