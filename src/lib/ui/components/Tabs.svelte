<script lang="ts">
    import { writable, type Writable } from "svelte/store";
    import { getContext, setContext } from "svelte";
    import { tabs as t } from "./index";

    const KEY = Symbol("rg-tabs");

    export let value: string = "";

    function store(): Writable<string> {
        let s = getContext<Writable<string>>(KEY);
        if (!s) {
            s = writable(value);
            setContext(KEY, s);
        }
        return s;
    }

    const active = store();
    $: active.set(value);
</script>

<div class={t.root}>
    <slot {active} />
</div>
