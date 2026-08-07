<script lang="ts">
    import { writable, type Writable } from "svelte/store";
    import { getContext } from "svelte";
    import { tabs as t, cn } from "./index";

    const KEY = Symbol("rg-tabs");

    export let value: string = "";

    const active = getContext<Writable<string>>(KEY) ?? writable(value);
    const isActive = (v: string) => v === $active;

    function select(v: string) {
        active.set(v);
    }
</script>

<button
    type="button"
    role="tab"
    class={t.trigger(isActive(value))}
    on:click={() => select(value)}
>
    <slot />
</button>
