// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import ReviewQueue from "./ReviewQueue.svelte";
import type { QuizService } from "../quiz/service";
import type { ReviewDraft } from "../quiz/review-workflow";
it("renders batch editing, submits changed question and reason through the service", async () => {
    const question = {
        id: "q",
        type: "subjective" as const,
        question: "old",
        reference_answer: "answer",
        difficulty: "medium" as const,
    };
    const draft: ReviewDraft = {
        id: "draft",
        versionId: "v",
        original: question,
        question: structuredClone(question),
        action: "pass",
        reason: "",
        source: { sourceDocId: "", sourceTitle: "" },
    };
    const commit = vi.fn(async (_drafts: ReviewDraft[]) => [question]);
    const done = vi.fn();
    const service = { workflow: { commit, snapshot: async () => ({ pending: [] }) } } as unknown as QuizService;
    const host = document.createElement("div");
    document.body.append(host);
    const app = mount(ReviewQueue, { target: host, props: { service, initial: [draft], ondone: done } });
    flushSync();
    const stem = host.querySelector<HTMLTextAreaElement>('[aria-label="题干"]')!;
    stem.value = "new";
    stem.dispatchEvent(new Event("input", { bubbles: true }));
    const reason = host.querySelector<HTMLTextAreaElement>('[aria-label="审核理由"]')!;
    reason.value = "clarify";
    reason.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("确认审核"))!.click();
    await vi.waitFor(() => expect(done).toHaveBeenCalled());
    expect(commit.mock.calls[0][0][0].question.question).toBe("new");
    expect(commit.mock.calls[0][0][0].reason).toBe("clarify");
    await unmount(app);
    host.remove();
});
