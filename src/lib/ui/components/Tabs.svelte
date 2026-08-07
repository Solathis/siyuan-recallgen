<script lang="ts">
    import { writable, type Writable } from "svelte/store";
    import { getContext, setContext } from "svelte";
    import { tabs as t, TABS_KEY } from "./index";

    export let value: string = "";

    function store(): Writable<string> {
        let s = getContext<Writable<string>>(TABS_KEY);
        if (!s) {
            s = writable(value);
            setContext(TABS_KEY, s);
        }
        return s;
    }

    const active = store();
    $: active.set(value);
</script>

<div class={t.root}>
    <slot {active} />
</div>
