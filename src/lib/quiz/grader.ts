import { t } from "@/lib/i18n";
import PromiseLimitPool from "@/libs/promise-pool";
import { callLLM, resolveAI, AIError, type ChatMessage } from "../ai/client";
import { buildGradeSubjectiveMessages } from "../ai/prompts";
import {
    GRADING_SCHEMA,
    buildTools,
    buildToolChoice,
    buildJsonObjectResponseFormat,
    parseJsonLoose,
} from "../ai/schema";
import type { RecallGenConfig } from "@/types/config";
import type { GradingResult, Question, UserAnswer } from "@/types/quiz";

const MAX_CONCURRENT = 4;

/**
 * 全量判分：客观题本地比对，主观/编程题调 AI（并发 ≤4）。
 * onProgress 回调用于驱动进度条。单个 AI 判分失败不影响其余。
 */
export async function gradeAll(
    config: RecallGenConfig,
    questions: Question[],
    answers: Record<string, UserAnswer>,
    onProgress?: (done: number, total: number) => void
): Promise<GradingResult[]> {
    const results: GradingResult[] = [];
    const pool = new PromiseLimitPool<GradingResult>(MAX_CONCURRENT);
    let done = 0;
    const total = questions.length;

    for (const q of questions) {
        const ua = answers[q.id];
        if (isObjective(q.type)) {
            results.push(gradeObjective(q, ua));
            done++;
            onProgress?.(done, total);
        } else {
            pool.add(async () => {
                const r = await gradeAI(config, q, ua).catch((e): GradingResult => ({
                    questionId: q.id,
                    type: q.type,
                    method: "ai",
                    correct: null,
                    score: 0,
                    maxScore: 100,
                    comment: t("grade.failed", (e as Error).message),
                    userAnswer: ua,
                }));
                results.push(r);
                done++;
                onProgress?.(done, total);
                return r;
            });
        }
    }
    await pool.awaitAll();
    // 按原题序返回，避免依赖 questionId 的字符串排序（id 格式一旦变化就会错位）
    const byId = new Map(results.map((r) => [r.questionId, r]));
    return questions.map((q) => byId.get(q.id)).filter((r): r is GradingResult => r !== undefined);
}

export function isObjective(type: Question["type"]): boolean {
    return type === "single_choice" || type === "multiple_choice" || type === "fill_blank" || type === "true_false";
}

/** 客观题本地判分 */
export function gradeObjective(q: Question, ua: UserAnswer | undefined): GradingResult {
    const base: GradingResult = {
        questionId: q.id,
        type: q.type,
        method: "local",
        correct: false,
        score: 0,
        maxScore: 100,
        userAnswer: ua,
    };
    if (!ua) {
        return base;
    }
    const ok = checkObjective(q, ua);
    return { ...base, correct: ok, score: ok ? 100 : 0 };
}

export function checkObjective(q: Question, ua: UserAnswer): boolean {
    switch (q.type) {
        case "single_choice":
            return ua.type === "single_choice" && ua.value === q.answer;
        case "multiple_choice":
            return ua.type === "multiple_choice" && setEqual(ua.value, q.answer);
        case "true_false":
            return ua.type === "true_false" && ua.value === q.answer;
        case "fill_blank":
            return ua.type === "fill_blank" && checkFillBlank(q.answer, ua.value);
        default:
            return false;
    }
}

export function setEqual(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    const sa = [...a].sort((x, y) => x - y);
    const sb = [...b].sort((x, y) => x - y);
    return sa.every((v, i) => v === sb[i]);
}

/** 填空题：每空答案 trim 后大小写不敏感匹配任一可接受值 */
export function checkFillBlank(accepted: string[][], user: string[]): boolean {
    if (user.length !== accepted.length) return false;
    return accepted.every((opts, i) => {
        const u = (user[i] ?? "").trim().toLowerCase();
        return opts.some((o) => o.trim().toLowerCase() === u);
    });
}

/** 主观/编程题 AI 判分 */
async function gradeAI(config: RecallGenConfig, q: Question, ua: UserAnswer | undefined): Promise<GradingResult> {
    const userText = ua?.type === "subjective" || ua?.type === "coding" ? ua.value : "";
    const messages = buildGradeSubjectiveMessages(config.prompts, q, userText, config.general.language);
    const callOpts = pickGradingOpts(config.ai.jsonSchemaEnabled);
    const rc = resolveAI(config.ai, config.ai.roles.grader);
    const result = await callLLM(rc, messages as ChatMessage[], {
        ...callOpts,
        temperature: 0,
        maxTokens: 512,
    });
    const parsed = parseJsonLoose(result.content) as { score?: unknown; comment?: unknown } | null;
    if (!parsed || typeof parsed !== "object") {
        throw new AIError(t("grade.notObject"), undefined, "parse");
    }
    const score = clampScore(parsed.score);
    return {
        questionId: q.id,
        type: q.type,
        method: "ai",
        correct: null,
        score,
        maxScore: 100,
        comment: typeof parsed.comment === "string" ? parsed.comment : "",
        userAnswer: ua,
    };
}

/**
 * 按 jsonSchemaEnabled 选择判分调用选项：
 * true → tools/function calling
 * false → response_format: json_object
 */
function pickGradingOpts(jsonSchemaEnabled: boolean): {
    tools?: unknown[];
    toolChoice?: unknown;
    responseFormat?: unknown;
} {
    if (jsonSchemaEnabled) {
        return {
            tools: buildTools("recallgen_grading", t("grade.toolDescription"), GRADING_SCHEMA as object),
            toolChoice: buildToolChoice("recallgen_grading"),
        };
    }
    return { responseFormat: buildJsonObjectResponseFormat() };
}

/**
 * 收敛分数到 0-100。
 * 只接受数字与可解析的数字字符串；null/undefined/空串/NaN 一律视为缺失并抛错，
 * 避免 Number(null) === 0 把「模型没给分」静默记成 0 分。
 */
export function clampScore(v: unknown): number {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
    if (!Number.isFinite(n)) {
        throw new AIError(t("grade.noScore"), undefined, "parse");
    }
    return Math.max(0, Math.min(100, n));
}
