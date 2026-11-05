// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import PromptWorkbench from "./PromptWorkbench.svelte";
import { ReviewWorkflowStore } from "../quiz/review-workflow";
import { getDefaultConfig } from "@/types/config";
import type { QuizService } from "../quiz/service";
it("branches, saves without activating, activates and refreshes the active version", async () => {
    let disk: unknown;
    const store = new ReviewWorkflowStore({
        loadData: async () => disk,
        saveData: async (_name, value) => {
            disk = structuredClone(value);
        },
    });
    const version = await store.capture(getDefaultConfig().prompts);
    const activate = vi.fn(async (id: string) => {
        await store.transact((s) => {
            s.activeId = id;
        });
    });
    const service = {
        getConfig: () => getDefaultConfig(),
        workflow: {
            snapshot: () => store.snapshot(),
            capture: async () => version,
            saveVersion: async (v: typeof version) => {
                await store.transact((s) => {
                    s.versions.push(v);
                });
            },
            activate,
        },
    } as unknown as QuizService;
    const host = document.createElement("div");
    document.body.append(host);
    const app = mount(PromptWorkbench, { target: host, props: { service } });
    flushSync();
    await vi.waitFor(() => expect(host.querySelectorAll("button").length).toBeGreaterThan(0));
    expect(host.querySelector('[aria-label="版本 generate"]')).toBeNull();
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("保存当前"))!.click();
    flushSync();
    await vi.waitFor(() => expect(host.querySelector('[aria-label="版本 generate"]')).not.toBeNull());
    await vi.waitFor(() =>
        expect(host.querySelector<HTMLTextAreaElement>('[aria-label="版本 generate"]')!.value).toBe(
            version.prompts.generate
        )
    );
    const summary = host.querySelector<HTMLInputElement>('[aria-label="变更摘要"]')!;
    summary.value = "experiment";
    summary.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    await vi.waitFor(() =>
        expect([...host.querySelectorAll("button")].find((b) => b.textContent?.includes("存为新版本"))!.disabled).toBe(
            false
        )
    );
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("存为新版本"))!.click();
    await vi.waitFor(async () => expect((await store.snapshot()).versions).toHaveLength(2));
    expect((await store.snapshot()).activeId).toBe("");
    await vi.waitFor(() =>
        expect([...host.querySelectorAll("button")].filter((b) => b.textContent?.includes("使用 / 回滚"))).toHaveLength(
            1
        )
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    [...host.querySelectorAll("button")].filter((b) => b.textContent?.includes("使用 / 回滚"))[0].click();
    await vi.waitFor(() => expect(activate).toHaveBeenCalled());
    await vi.waitFor(async () =>
        expect(
            (await new ReviewWorkflowStore({ loadData: async () => disk, saveData: async () => {} }).snapshot())
                .activeId
        ).not.toBe(version.id)
    );
    await unmount(app);
    host.remove();
});
