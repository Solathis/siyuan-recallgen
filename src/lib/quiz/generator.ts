import PromiseLimitPool from "@/libs/promise-pool";
import { t } from "@/lib/i18n";
import { dedupeQuestions, planBatches, renumberQuestions, scaleDistribution } from "./batching";
import { callLLM, isAbortError, resolveAI, AIError, type ChatMessage, type ResolvedAIConfig } from "../ai/client";
import { activePrompts, buildGenerateMessages, buildReviewMessages, buildRegenerateMessages } from "../ai/prompts";
import {
    QUIZ_SCHEMA,
    REVIEW_SCHEMA,
    buildTools,
    buildToolChoice,
    buildJsonObjectResponseFormat,
    describeJsonShape,
    extractQuestionArray,
    parseJsonDetailed,
    parseJsonLoose,
} from "../ai/schema";
import type { GeneralConfig, PromptConfig, RecallGenConfig } from "@/types/config";
import type { DifficultyDistribution } from "@/types/quiz";
import type { Difficulty, Question, QuestionType } from "@/types/quiz";

/**
 * 生成进度回调：phase=当前阶段, round=当前轮次(1-based), detail=描述。
 * stats 是本轮的实时快照，供生成页展示「已收集/批次/丢弃」这类信息。
 */
export type GenProgressCallback = (phase: GenPhase, round: number, detail: string, stats?: GenStats) => void;

export type GenPhase = "generating" | "reviewing" | "regenerating";

/** 生成过程的实时快照（用于界面展示，不参与逻辑） */
export interface GenStats {
    phase: GenPhase;
    /** 本轮配置要求的总题量 */
    target: number;
    /** 已成功收集的题目数 */
    collected: number;
    /** 当前批次序号（1-based） */
    batch: number;
    /** 批次数 */
    batches: number;
    /** 因格式不合格被丢弃的题目数 */
    dropped: number;
    /** 附加说明（例如某批失败已跳过） */
    note?: string;
}

/** 审题结果 */
interface ReviewItem {
    index: number;
    passed: boolean;
    reason?: string;
}

/**
 * 从审题结果里挑出未通过的题目下标与原因。
 *
 * 输入是模型输出，任何字段都不可信：元素可能不是对象、index 可能是
 * 小数/字符串/越界值、同一题可能被报多次。这里全部过滤掉，
 * 只返回可用于 questions[i] 的合法下标（去重且升序稳定）。
 */
export function collectFailedReviews(
    reviews: unknown[],
    questionCount: number
): { indices: number[]; reasons: string[] } {
    const indices: number[] = [];
    const reasons: string[] = [];

    for (const raw of reviews) {
        const item = raw as Partial<ReviewItem> | null;
        if (!item || typeof item !== "object" || item.passed) continue;
        const index = item.index;
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= questionCount) {
            continue;
        }
        if (indices.includes(index)) continue;
        indices.push(index);
        reasons.push(typeof item.reason === "string" && item.reason ? item.reason : t("gen.reviewNoReason"));
    }

    return { indices, reasons };
}

/**
 * 并发出题批次数上限。
 * 太高容易撞服务端的速率限制（429），把「快」变成「重试更慢」；
 * 3 批已经能让 30 题的等待时间从「三批之和」降到接近单批。
 */
const MAX_CONCURRENT_BATCHES = 3;

const MAX_REVIEW_ROUNDS = 3;

/** 单批请求所需的上下文（参数较多，收成一个对象避免位置参数错配） */
interface BatchContext {
    prompts: PromptConfig;
    general: GeneralConfig;
    content: string;
    types: QuestionType[];
    genAI: ResolvedAIConfig;
    callOpts: { tools?: unknown[]; toolChoice?: unknown; responseFormat?: unknown };
    signal?: AbortSignal;
}

/** 原始返回最多保留多少字符给用户查看（够看出模型给了什么，又不至于撑爆界面） */
const RAW_SNIPPET_LIMIT = 4000;

/**
 * 一批请求没能给出可用题目数组时的诊断信息。
 *
 * 关键是区分「模型没说完」和「模型给的形状不对」：
 * 前者要调大 Max Tokens，后者是别名/嵌套问题，两者的处置办法完全不同。
 */
interface BatchProblem {
    /** 解析结果的类型：object / string / null … */
    rawType: string;
    /** 解析结果的顶层字段（数组则显示 [n]） */
    keys: string[];
    /** JSON 未闭合，典型是输出被截断 */
    truncated: boolean;
    /** 靠 jsonrepair 才解析成功（说明模型没给严格 JSON） */
    repaired: boolean;
    /** 原始返回长度 */
    chars: number;
    /** 原始返回片段，供用户在界面上查看与复制 */
    raw: string;
}

/** 一批的请求结果；problem 表示模型没给出可用的 questions 数组 */
interface BatchOutcome {
    questions: Question[];
    dropped: number;
    problem?: BatchProblem;
}

/** 把诊断信息翻成可操作的错误 */
function problemError(problem: BatchProblem): AIError {
    if (problem.truncated) {
        return new AIError(t("gen.truncatedQuestions"), undefined, "truncated", problem.raw);
    }
    const keys = problem.keys.length > 0 ? problem.keys.join("、") : t("gen.noKeys");
    return new AIError(t("gen.missingQuestions", keys, String(problem.chars)), undefined, "parse", problem.raw);
}

/** 进度文案：常规批次显示「第 i/n 批」，补题批次显示「还差 N 题」 */
function batchLabel(index: number, count: number, total: number, toppingUp: boolean): string {
    if (count > 1) return t("gen.batchProgress", String(index + 1), String(count), String(total));
    return toppingUp ? t("gen.toppingUp", String(total)) : t("quiz.generating");
}

/** 请求并解析一批题目（不含「缺题是否容忍」的决策，留给调用方） */
async function requestBatch(ctx: BatchContext, counts: DifficultyDistribution): Promise<BatchOutcome> {
    const messages = buildGenerateMessages(ctx.prompts, ctx.general, ctx.content, ctx.types, counts);
    const result = await callLLM(ctx.genAI, messages as ChatMessage[], { ...ctx.callOpts, signal: ctx.signal });
    const diag = parseJsonDetailed(result.content);
    const hit = extractQuestionArray(diag.value);

    if (!hit) {
        const shape = describeJsonShape(diag.value);
        return {
            questions: [],
            dropped: 0,
            problem: {
                rawType: shape.type,
                keys: shape.keys,
                truncated: diag.truncated,
                repaired: diag.repaired,
                chars: result.content.length,
                raw: result.content.slice(0, RAW_SNIPPET_LIMIT),
            },
        };
    }

    let dropped = 0;
    let questions: Question[];
    try {
        questions = validateQuestions(hit.items, ctx.types, () => {
            dropped++;
        });
    } catch (e) {
        // 全部校验失败时，如果原文本来就是截断的，真正的原因就是「模型没说完」：
        // 修复后的残缺 JSON 恰好能凑出一个字段不全的题目，
        // 若按「校验失败」上报，用户会去怀疑模型能力而不是 Max Tokens。
        if (diag.truncated) {
            const shape = describeJsonShape(diag.value);
            return {
                questions: [],
                dropped: 0,
                problem: {
                    rawType: shape.type,
                    keys: shape.keys,
                    truncated: true,
                    repaired: diag.repaired,
                    chars: result.content.length,
                    raw: result.content.slice(0, RAW_SNIPPET_LIMIT),
                },
            };
        }
        throw e;
    }
    return { questions, dropped };
}

/** 已取消时抛出统一的取消错误（与 client 层同一类别，便于上层静默忽略） */
function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AIError(t("ai.aborted"), undefined, "aborted");
}

/**
 * 调用 AI 生成题目，可选审题循环。
 * 流程：生成 → 审题 → (失败题重新生成 → 再审) × max 3 rounds。
 * onProgress 回调报告各阶段进度。
 */
export async function generateQuestions(
    config: RecallGenConfig,
    content: string,
    onProgress?: GenProgressCallback,
    /** 取消信号：用户点取消后不再发起后续批次与审题轮次 */
    signal?: AbortSignal
): Promise<Question[]> {
    const { general, ai } = config;
    // 提示词默认值分中英两套：未自定义时跟随输出语言，自定义过则原样尊重
    const prompts = activePrompts(config.prompts, general.language);
    const types = general.allowedTypes;
    const difficulty = general.difficulty;

    // 1. 生成：题量超过单次上限时拆成多批，避免输出过长导致截断或超时
    const genAI = resolveAI(ai, ai.roles.generator);
    const callOpts = pickCallOpts(ai.jsonSchemaEnabled, "recallgen_quiz", "生成复习题目", QUIZ_SCHEMA as object);
    const batches = planBatches(difficulty);

    const collected: Question[] = [];
    let skipped = 0;
    const ctx: BatchContext = { prompts, general, content, types, genAI, callOpts, signal };
    /** 本轮要求的题目总量（补题轮会改写成差额），仅用于进度展示 */
    let targetTotal = Math.max(0, Math.round(difficulty.total));
    /** 界面展示用的实时快照 */
    let stats: GenStats = {
        phase: "generating",
        target: targetTotal,
        collected: 0,
        batch: 1,
        batches: Math.max(1, batches.length),
        dropped: 0,
    };
    const report = (detail: string, patch: Partial<GenStats> = {}): void => {
        stats = { ...stats, target: targetTotal, collected: collected.length, dropped: skipped, ...patch };
        onProgress?.(stats.phase, Math.max(1, stats.batch), detail, stats);
    };

    /**
     * 并发请求多批并收集结果。
     *
     * 各批之间互不依赖（每批只是题目总量的一个切片），串行发等于把等待时间叠加：
     * 30 题要 3 批、再加一轮补题就是 4~6 个来回，按每次十几秒算要等一分多钟。
     * 这里用与判分、导出同一套 PromiseLimitPool 限并发。
     *
     * allowPartial：部分批次失败时是否保留已成功的批次
     * toppingUp：仅用于进度文案，区分「首次生成」与「补齐差额」
     */
    const runBatches = async (
        group: DifficultyDistribution[],
        options: { allowPartial: boolean; toppingUp: boolean }
    ): Promise<void> => {
        const { allowPartial, toppingUp } = options;
        const total = group.length;
        if (total === 0) return;

        // 保序：第 i 批的结果放回第 i 个槽位，最后按槽位顺序合并。
        // 直接按完成顺序 push 会让每次生成的题目顺序都不一样。
        const slots: Question[][] = Array.from({ length: total }, () => []);
        const problems: Array<{ index: number; problem: BatchProblem }> = [];
        const errors: unknown[] = [];
        let finished = 0;

        const parallel = total > 1;
        if (parallel) {
            const grandTotal = group.reduce((sum, item) => sum + item.total, 0);
            // 补题轮沿用「还差 N 题」的既有说法，用户才知道这是在补齐差额
            report(
                toppingUp
                    ? t("gen.toppingUp", String(grandTotal))
                    : t("gen.parallelBatches", String(total), String(grandTotal)),
                { phase: "generating", batch: 1, batches: total }
            );
        } else {
            report(batchLabel(0, 1, group[0].total, toppingUp), {
                phase: "generating",
                batch: 1,
                batches: 1,
            });
        }

        const pool = new PromiseLimitPool<void>(Math.min(total, MAX_CONCURRENT_BATCHES));
        for (let i = 0; i < total; i++) {
            pool.add(async () => {
                try {
                    // 取消后不再发新请求（在途的无法撤回）
                    throwIfAborted(signal);
                    const outcome = await requestBatch(ctx, group[i]);
                    if (outcome.problem) {
                        problems.push({ index: i, problem: outcome.problem });
                        return;
                    }
                    slots[i] = outcome.questions;
                    skipped += outcome.dropped;
                    finished++;
                    report(
                        parallel
                            ? t("gen.parallelProgress", String(finished), String(total), String(collected.length))
                            : batchLabel(0, 1, group[0].total, toppingUp),
                        {
                            phase: "generating",
                            batch: Math.min(finished + 1, total),
                            batches: total,
                        }
                    );
                } catch (e) {
                    errors.push(e);
                }
            });
        }
        await pool.awaitAll();

        // 取消优先透传：用户点了取消，其余批次的失败都不重要
        const aborted = errors.find((e) => isAbortError(e));
        if (aborted) throw aborted;
        // 网络/HTTP 这类硬失败仍然冒泡（与串行时一致）
        if (errors.length > 0) throw errors[0];

        if (problems.length > 0) {
            const succeeded = slots.filter((slot) => slot.length > 0).length;
            const failedAt = problems.map((p) => p.index + 1).join("、");
            if (!allowPartial || succeeded === 0) throw problemError(problems[0].problem);
            console.warn("[RecallGen] 部分批次出题失败，保留已成功的批次", failedAt);
            const note = t("gen.batchSkipped", failedAt);
            report(note, { note });
        }

        for (const slot of slots) collected.push(...slot);
    };

    await runBatches(batches, { allowPartial: true, toppingUp: false });

    // 2. 模型常少给题：按差额补一轮，让实际题量尽量贴近用户设置。
    //    只补一次——模型持续少给时反复请求既费额度又拖时间。
    const shortfall = Math.max(0, Math.round(difficulty.total) - collected.length);
    if (shortfall > 0) {
        throwIfAborted(signal);
        targetTotal = shortfall;
        try {
            await runBatches(planBatches(scaleDistribution(difficulty, shortfall)), {
                allowPartial: true,
                toppingUp: true,
            });
        } catch (e) {
            // 取消要透传；补题本身失败不该作废已经拿到的题目
            if (isAbortError(e)) throw e;
            console.warn("[RecallGen] 补题失败，保留已有题目", e);
        }
    }

    // 跨批也可能重复，去重后重新连续编号
    let questions = renumberQuestions(dedupeQuestions(collected));
    const discarded = skipped + (collected.length - questions.length);
    if (discarded > 0) {
        targetTotal = Math.max(0, Math.round(difficulty.total));
        report(t("gen.dropped", String(questions.length), String(discarded)), {
            phase: "generating",
            collected: questions.length,
        });
    }

    // 3. 审题循环（仅当审题者模型存在时执行）
    if (ai.roles.reviewer && ai.models.some((m) => m.id === ai.roles.reviewer)) {
        throwIfAborted(signal);
        questions = await reviewLoop(config, questions, content, report, signal);
    }

    return questions;
}

/** 审题循环：生成→审核→重新生成失败题→再审，最多 MAX_REVIEW_ROUNDS 轮 */
async function reviewLoop(
    config: RecallGenConfig,
    questions: Question[],
    content: string,
    report: (detail: string, patch?: Partial<GenStats>) => void,
    signal?: AbortSignal
): Promise<Question[]> {
    const { ai } = config;
    const prompts = activePrompts(config.prompts, config.general.language);
    const reviewAI = resolveAI(ai, ai.roles.reviewer);
    const genAI = resolveAI(ai, ai.roles.generator);
    const reviewOpts = pickCallOpts(ai.jsonSchemaEnabled, "recallgen_review", "审核题目质量", REVIEW_SCHEMA as object);
    const genOpts = pickCallOpts(ai.jsonSchemaEnabled, "recallgen_quiz", "生成复习题目", QUIZ_SCHEMA as object);
    const types = config.general.allowedTypes;

    for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
        throwIfAborted(signal);
        const canvas = {
            phase: "reviewing" as GenPhase,
            batch: round,
            batches: MAX_REVIEW_ROUNDS,
            collected: questions.length,
        };
        report(t("gen.reviewing", String(round)), canvas);

        const reviewMessages = buildReviewMessages(prompts, questions, config.general.language);
        const reviewResult = await callLLM(reviewAI, reviewMessages as ChatMessage[], {
            ...reviewOpts,
            temperature: 0.3,
            signal,
        });

        const reviewParsed = parseJsonLoose(reviewResult.content) as { reviews?: unknown } | null;
        const reviews = reviewParsed?.reviews;
        if (!Array.isArray(reviews)) {
            // 审题结果解析失败，跳过审题（提示一下，否则用户只看到「审题中」就没有下文）
            report(t("gen.reviewSkipped"), canvas);
            break;
        }

        // 筛选未通过的题。
        // 审题结果是模型输出，必须逐项校验：null 元素、非整数下标或越界下标
        // 都会让后面的 questions[i] 取到 undefined，进而崩掉整轮生成。
        const { indices: failedIndices, reasons } = collectFailedReviews(reviews, questions.length);

        if (failedIndices.length === 0) {
            report(t("gen.reviewPassed", String(round), String(questions.length)), canvas);
            break;
        }

        if (round === MAX_REVIEW_ROUNDS) {
            report(t("gen.reviewMaxRounds", String(failedIndices.length)), canvas);
            break;
        }

        // 重新生成失败题
        report(t("gen.regenerating", String(round), String(failedIndices.length)), {
            ...canvas,
            phase: "regenerating",
        });
        const failedQuestions = failedIndices.map((i) => questions[i]);
        const regenMessages = buildRegenerateMessages(prompts, config.general, failedQuestions, reasons, content);
        const regenResult = await callLLM(genAI, regenMessages as ChatMessage[], { ...genOpts, signal });

        // 与生成路径同样宽容：模型可能换个键名装这批重做的题目
        const regenHit = extractQuestionArray(parseJsonLoose(regenResult.content));
        if (!regenHit || regenHit.items.length === 0) {
            report(t("gen.regenFailed"), { ...canvas, phase: "regenerating" });
            break; // 重新生成失败，保留原题
        }

        // 逐题替换失败题；单题校验失败则保留原题
        let replaced = 0;
        for (let i = 0; i < failedIndices.length; i++) {
            const target = failedIndices[i];
            const current = questions[target];
            if (!current) continue;
            const result = coerceQuestion(regenHit.items[i], current.id, types);
            if (!result.ok || !result.question) continue;
            questions[target] = result.question;
            replaced++;
        }
        report(t("gen.regenerated", String(round), String(replaced), String(failedIndices.length)), {
            ...canvas,
            phase: "regenerating",
        });
    }

    return questions;
}

/**
 * 按 jsonSchemaEnabled 选择调用选项：
 * true → tools/function calling（严格 Schema 约束）
 * false → response_format: json_object（宽松兼容）
 */
function pickCallOpts(
    jsonSchemaEnabled: boolean,
    name: string,
    description: string,
    schema: object
): { tools?: unknown[]; toolChoice?: unknown; responseFormat?: unknown } {
    if (jsonSchemaEnabled) {
        return {
            tools: buildTools(name, description, schema),
            toolChoice: buildToolChoice(name),
        };
    }
    return { responseFormat: buildJsonObjectResponseFormat() };
}

// ── 题目校验与类型收敛 ──────────────────────────────────────────────

export interface CoerceResult {
    ok: boolean;
    question?: Question;
    reason?: string;
}

/**
 * 单题宽松校验：任何字段问题都通过返回值上报，不抛异常。
 * 单题不合格只应被丢弃，而不应让整批生成作废。
 */
export function coerceQuestion(raw: unknown, id: string, allowedTypes: QuestionType[]): CoerceResult {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, reason: t("validate.notObject") };
    }
    const item = raw as Record<string, unknown>;
    const type = item.type as QuestionType;
    if (!allowedTypes.includes(type)) {
        return { ok: false, reason: t("validate.typeDisabled", String(item.type)) };
    }
    const question = String(item.question ?? "").trim();
    if (!question) {
        return { ok: false, reason: t("validate.emptyQuestion") };
    }
    const base = {
        id,
        type,
        difficulty: toDifficulty(item.difficulty),
        question,
        explanation: item.explanation ? String(item.explanation) : undefined,
        tags: toTags(item.tags),
    };
    try {
        return { ok: true, question: coerceByType(base, type, item) };
    } catch (e) {
        return { ok: false, reason: (e as Error).message };
    }
}

/**
 * 批量校验：逐题丢弃不合格题目，并按输出顺序重新编号为 q-1..q-n。
 * 仅当一道题都没通过时才抛错。
 */
export function validateQuestions(
    raw: unknown[],
    allowedTypes: QuestionType[],
    onSkip?: (reason: string) => void
): Question[] {
    const out: Question[] = [];
    const reasons: string[] = [];

    for (const item of raw) {
        const result = coerceQuestion(item, `q-${out.length + 1}`, allowedTypes);
        if (result.ok && result.question) {
            out.push(result.question);
        } else {
            const reason = result.reason ?? t("gen.unknownReason");
            reasons.push(reason);
            onSkip?.(reason);
        }
    }

    if (out.length === 0) {
        // kind 必须是 parse：默认值 http 会让错误页按「网络/服务端」给出建议，
        // 而这其实是模型返回内容的问题，提示方向完全相反
        throw new AIError(
            raw.length === 0
                ? t("gen.emptyQuestions")
                : t("gen.allInvalid", String(raw.length), reasons.slice(0, 3).join("; ")),
            undefined,
            "parse"
        );
    }
    return out;
}

/** 单题知识点标签数量上限 */
const MAX_TAGS = 3;
/** 单个标签长度上限 */
const MAX_TAG_LENGTH = 24;

/**
 * 归一化知识点标签：去空白、截断长度、按大小写不敏感去重，最多保留 MAX_TAGS 个。
 * 全部无效时返回 undefined，避免索引里出现空标签。
 */
export function toTags(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of value) {
        if (typeof raw !== "string" && typeof raw !== "number") continue;
        const tag = String(raw).trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
        if (!tag) continue;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(tag);
        if (out.length >= MAX_TAGS) break;
    }
    return out.length > 0 ? out : undefined;
}

function toDifficulty(value: unknown): Difficulty {
    const s = String(value ?? "").toLowerCase();
    return s === "easy" || s === "medium" || s === "hard" ? s : "medium";
}

function coerceByType(base: Omit<Question, never>, type: QuestionType, item: Record<string, unknown>): Question {
    switch (type) {
        case "single_choice": {
            const options = toStringArray(item.options);
            const answer = toNumber(item.answer);
            // 越界或负数索引会导致用户永远答不对，必须丢弃
            if (options.length < 2 || answer === null || answer < 0 || answer >= options.length) {
                throw new AIError(t("validate.singleChoice"));
            }
            return { ...base, type, options, answer } as Question;
        }
        case "multiple_choice": {
            const options = toStringArray(item.options);
            const answer = [...new Set(toNumberArray(item.answer))].sort((a, b) => a - b);
            if (options.length < 2 || answer.length === 0 || answer.some((i) => i < 0 || i >= options.length)) {
                throw new AIError(t("validate.multipleChoice"));
            }
            return { ...base, type, options, answer } as Question;
        }
        case "fill_blank": {
            const answer = toAnswerMatrix(item.answer);
            if (answer.length === 0 || answer.some((opts) => opts.length === 0)) {
                throw new AIError(t("validate.blankMissing"));
            }
            return { ...base, type, answer } as Question;
        }
        case "true_false": {
            if (typeof item.answer === "boolean") return { ...base, type, answer: item.answer } as Question;
            if (typeof item.answer === "string") {
                const s = item.answer.trim().toLowerCase();
                if (s === "true" || s === "正确" || s === "对" || s === "1") {
                    return { ...base, type, answer: true } as Question;
                }
                if (s === "false" || s === "错误" || s === "错" || s === "0") {
                    return { ...base, type, answer: false } as Question;
                }
            }
            if (typeof item.answer === "number") return { ...base, type, answer: item.answer !== 0 } as Question;
            throw new AIError(t("validate.notBoolean"));
        }
        case "subjective": {
            const reference_answer = String(item.reference_answer ?? "").trim();
            if (!reference_answer) {
                throw new AIError(t("validate.subjectiveNoRef"));
            }
            return { ...base, type, reference_answer } as Question;
        }
        case "coding": {
            const language = String(item.language ?? "python");
            const answer = String(item.answer ?? "");
            const test_cases = Array.isArray(item.test_cases)
                ? item.test_cases.map((t) => {
                      const raw = t as { input?: unknown; args?: unknown; expected?: unknown; description?: unknown };
                      return {
                          input: raw.input !== undefined ? String(raw.input) : undefined,
                          // args 保持原样：它要被当作实参调用入口函数，不能转成字符串
                          args: Array.isArray(raw.args) ? raw.args : undefined,
                          expected: String(raw.expected ?? ""),
                          description: raw.description !== undefined ? String(raw.description) : undefined,
                      };
                  })
                : undefined;
            // 编程题至少要能对照参考答案或测试用例，否则无从判分
            if (!answer.trim() && !test_cases?.length) {
                throw new AIError(t("validate.codingNoRef"));
            }
            return {
                ...base,
                type,
                language,
                entry_point: item.entry_point !== undefined ? String(item.entry_point).trim() || undefined : undefined,
                starter_code: item.starter_code !== undefined ? String(item.starter_code) : undefined,
                test_cases,
                answer,
                reference_answer: item.reference_answer !== undefined ? String(item.reference_answer) : undefined,
            } as Question;
        }
        default:
            throw new AIError(t("validate.unknownType", String(type)));
    }
}

function toStringArray(v: unknown): string[] {
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

/** 数字或字母索引（A=0, B=1, …）转 0-based 索引 */
function toNumber(v: unknown): number | null {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
        const trimmed = v.trim();
        const n = parseInt(trimmed, 10);
        if (!Number.isNaN(n)) return n;
        const upper = trimmed.toUpperCase();
        if (upper.length === 1 && upper >= "A" && upper <= "Z") return upper.charCodeAt(0) - 65;
    }
    return null;
}

function toNumberArray(v: unknown): number[] {
    if (!Array.isArray(v)) return [];
    return v.map((x) => toNumber(x)).filter((n): n is number => n !== null);
}

/** 填空题 answer: 二维数组 string[][]，单个答案会包成一元数组 */
function toAnswerMatrix(v: unknown): string[][] {
    if (!Array.isArray(v)) return [];
    return v.map((blank) => (Array.isArray(blank) ? blank.map((x) => String(x)) : [String(blank)]));
}
