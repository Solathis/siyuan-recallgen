import { AsyncStore, type StoragePlugin } from "../storage/store";
import type { Question } from "@/types/quiz";
import type { PromptConfig } from "@/types/config";
import { coerceQuestion } from "./generator";

/** Workflow payloads are persisted JSON; serialize proxies before cloning them. */
export function cloneWorkflowData<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export interface PromptVersion {
    deleted?: boolean;
    automatic?: boolean;
    id: string;
    parentId?: string;
    createdAt: number;
    source: "manual" | "analysis" | "derived";
    scenarios: string[];
    summary: string;
    prompts: PromptConfig;
}
export interface ReviewDraft {
    id: string;
    versionId: string;
    original: Question;
    question: Question;
    action: "pass" | "skip" | "delete";
    reason: string;
    source: { sourceDocId: string; sourceTitle: string };
}
export interface ReviewRecord extends ReviewDraft {
    recordedAt: number;
}
export interface PromptSuggestion {
    id: string;
    pattern: string;
    evidenceIds: string[];
    frequency: number;
    target: keyof PromptConfig;
    before: string;
    after: string;
}
export interface WorkflowState {
    versions: PromptVersion[];
    activeId: string;
    pending: ReviewDraft[];
    records: ReviewRecord[];
    suggestions: PromptSuggestion[];
}
const empty = (): WorkflowState => ({ versions: [], activeId: "", pending: [], records: [], suggestions: [] });
export const workflowId = () => crypto.randomUUID();
export function validateReviewQuestion(q: Question): Question {
    const result = coerceQuestion(q, q.id, [q.type]);
    if (!result.ok || !result.question) throw new Error(result.reason ?? "题目格式无效");
    return result.question;
}

/** One serialized transaction queue across all tabs. Never expose cached mutable objects. */
export class ReviewWorkflowStore extends AsyncStore {
    private queue: Promise<unknown> = Promise.resolve();
    constructor(plugin: StoragePlugin) {
        super(plugin, "recallgen-review-workflow.json");
    }
    async snapshot(): Promise<WorkflowState> {
        await this.queue;
        return cloneWorkflowData(await this.read(empty()));
    }
    transact<T>(change: (state: WorkflowState) => T | Promise<T>): Promise<T> {
        const run = this.queue.then(async () => {
            const state = cloneWorkflowData(await this.read(empty()));
            const result = await change(state);
            await this.write(state);
            return result;
        });
        this.queue = run.catch(() => {});
        return run;
    }
    async capture(prompts: PromptConfig): Promise<PromptVersion> {
        return this.transact((state) => {
            const active = state.versions.find((v) => JSON.stringify(v.prompts) === JSON.stringify(prompts));
            if (active && JSON.stringify(active.prompts) === JSON.stringify(prompts)) return active;
            const version: PromptVersion = {
                id: workflowId(),
                parentId: active?.id,
                createdAt: Date.now(),
                source: "manual",
                scenarios: [],
                summary: "当前设置快照",
                automatic: true,
                prompts: cloneWorkflowData(prompts),
            };
            state.versions.push(version);
            return version;
        });
    }
    async deleteVersion(id: string): Promise<void> {
        return this.transact((state) => {
            const version = state.versions.find((v) => v.id === id);
            if (!version) throw new Error("版本不存在");
            // Retain the immutable snapshot for review evidence and descendant ancestry.
            version.deleted = true;
            if (state.activeId === id) state.activeId = "";
        });
    }
    async enqueue(questions: Question[], versionId: string, source: ReviewDraft["source"]): Promise<ReviewDraft[]> {
        return this.transact((state) => {
            const drafts = questions.map((question) => ({
                id: workflowId(),
                versionId,
                original: cloneWorkflowData(question),
                question: cloneWorkflowData(question),
                action: "pass" as const,
                reason: "",
                source,
            }));
            state.pending.push(...drafts);
            return cloneWorkflowData(drafts);
        });
    }
    async commit(drafts: ReviewDraft[], admit: (drafts: ReviewDraft[]) => Promise<void>): Promise<Question[]> {
        return this.transact(async (state) => {
            const seen = new Set<string>();
            const selected = drafts.flatMap((d) => {
                const stored = state.pending.find((p) => p.id === d.id);
                if (!stored || seen.has(d.id)) return [];
                seen.add(d.id);
                if (!["pass", "skip", "delete"].includes(d.action)) throw new Error("无效审核操作");
                return [{ ...stored, question: d.question, action: d.action, reason: d.reason }];
            });
            const passed = selected
                .filter((d) => d.action === "pass")
                .map((d) => ({ ...d, question: validateReviewQuestion(d.question) }));
            // Bank writes are idempotent by fingerprint; retry after a workflow save failure is safe.
            await admit(passed);
            for (const draft of selected) {
                if (draft.reason.trim())
                    state.records.push({ ...cloneWorkflowData(draft), id: workflowId(), recordedAt: Date.now() });
                state.pending = state.pending.filter((p) => p.id !== draft.id);
                if (draft.action === "skip") state.pending.push({ ...cloneWorkflowData(draft), reason: "" });
            }
            return passed.map((d, index) => ({ ...d.question, id: `q-${index + 1}` }));
        });
    }
}
