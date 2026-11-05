import { expect, it, vi } from "vitest";
import { ReviewWorkflowStore, type ReviewDraft } from "./review-workflow";

it("accepts proxied questions at the UI persistence boundary", async () => {
    const { store } = setup();
    const version = await store.capture(new Proxy(getDefaultConfig().prompts, {}));
    const proxied = new Proxy(structuredClone(question), {});
    expect(() => structuredClone(proxied)).toThrow();
    const drafts = await store.enqueue([proxied], version.id, { sourceDocId: "doc", sourceTitle: "source" });
    expect(drafts[0].question.question).toBe(question.question);
    drafts[0].reason = "reviewed";
    const accepted = await store.commit([new Proxy(drafts[0], {})], async () => {});
    expect(accepted).toHaveLength(1);
    expect((await store.snapshot()).records).toHaveLength(1);
});
import { getDefaultConfig } from "@/types/config";
import type { Question } from "@/types/quiz";
const question: Question = {
    id: "q1",
    type: "subjective",
    difficulty: "medium",
    question: "old",
    reference_answer: "answer",
};
function setup() {
    let disk: unknown;
    const plugin = {
        loadData: vi.fn(async () => disk),
        saveData: vi.fn(async (_name: string, data: unknown) => {
            disk = structuredClone(data);
        }),
    };
    return { plugin, store: new ReviewWorkflowStore(plugin) };
}
it("persists drafts before approval; only approved questions are admitted and reasons create records", async () => {
    const { store, plugin } = setup();
    const version = await store.capture(getDefaultConfig().prompts);
    const drafts = await store.enqueue([question, question, question], version.id, {
        sourceDocId: "doc",
        sourceTitle: "source",
    });
    expect((await new ReviewWorkflowStore(plugin).snapshot()).pending).toHaveLength(3);
    drafts[0].question.question = "edited";
    drafts[0].reason = "too vague";
    drafts[1].action = "skip";
    drafts[1].reason = "later";
    drafts[2].action = "delete";
    const admit = vi.fn(async (_drafts: ReviewDraft[]) => {});
    const accepted = await store.commit(drafts, admit);
    expect(accepted.map((q) => q.question)).toEqual(["edited"]);
    expect(admit.mock.calls[0][0]).toHaveLength(1);
    const state = await store.snapshot();
    expect(state.pending).toHaveLength(1);
    expect(state.records).toHaveLength(2);
    expect(state.records[0].original.question).toBe("old");
    expect(state.records[0].versionId).toBe(version.id);
    await store.commit([drafts[0], drafts[2]], admit);
    expect((await store.snapshot()).records).toHaveLength(2);
});
it("serializes concurrent drafts and does not lose them on admission failure", async () => {
    const { store } = setup();
    const v = await store.capture(getDefaultConfig().prompts);
    await Promise.all([
        store.enqueue([question], v.id, { sourceDocId: "", sourceTitle: "a" }),
        store.enqueue([question], v.id, { sourceDocId: "", sourceTitle: "b" }),
    ]);
    const state = await store.snapshot();
    expect(state.pending).toHaveLength(2);
    await expect(
        store.commit(state.pending, async () => {
            throw new Error("disk failed");
        })
    ).rejects.toThrow("disk failed");
    expect((await store.snapshot()).pending).toHaveLength(2);
});
