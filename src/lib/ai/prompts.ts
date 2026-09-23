import type { AIConfig, GeneralConfig, PromptConfig } from "@/types/config";
import type { DifficultyDistribution, GradingResult, Question, QuestionType, UserAnswer } from "@/types/quiz";
import { PASS_SCORE } from "@/types/quiz";
import { fill, scaffoldOf, type PromptLang, type PromptScaffold } from "./scaffold";

export type { AIConfig };

/** 生成题目的消息序列 */
export function buildGenerateMessages(
    prompts: PromptConfig,
    general: GeneralConfig,
    content: string,
    types: QuestionType[],
    difficulty: DifficultyDistribution
): Array<{ role: "system" | "user"; content: string }> {
    const s = scaffoldOf(general.language);

    const system = [prompts.generate, s.jsonOnly, s.topLevelQuestions];

    const user = [
        s.noteContent,
        "----",
        content,
        "----",
        fill(s.allowedTypes, types.join(", ")),
        fill(s.difficultyDist, difficulty.easy, difficulty.medium, difficulty.hard, difficulty.total),
        s.difficultyHint,
        s.exactCount,
        fill(s.extraScope, general.extraScopePct),
        fill(s.outputLang, s.langLabel),
        s.jsonAgain,
        s.fields,
        s.answerFormat,
        s.tagsInstruction,
        s.codingInstruction,
    ].join("\n");

    return [
        { role: "system", content: system.join("\n\n") },
        { role: "user", content: user },
    ];
}

/** 主观题/编程题统一判分消息 */
export function buildGradeSubjectiveMessages(
    prompts: PromptConfig,
    question: Question,
    userAnswer: string,
    lang: PromptLang
): Array<{ role: "system" | "user"; content: string }> {
    const s = scaffoldOf(lang);
    const userParts: string[] = [fill(s.questionLabel, question.question)];

    if (question.type === "coding") {
        const cases =
            question.test_cases?.map((tc) => fill(s.testCaseLine, tc.input ?? "", tc.expected)).join("\n") ?? "";
        userParts.push(fill(s.refAnswerLabel, question.answer ?? ""));
        userParts.push(fill(s.testCasesLabel, cases));
        userParts.push(s.studentCodeLabel);
        userParts.push("----");
        userParts.push(userAnswer);
        userParts.push("----");
    } else {
        const reference = "reference_answer" in question ? question.reference_answer : "";
        userParts.push(fill(s.refPointsLabel, reference));
        userParts.push(fill(s.studentAnswerLabel, userAnswer));
    }
    userParts.push(s.jsonScore);

    return [
        { role: "system", content: prompts.gradeSubjective },
        { role: "user", content: userParts.join("\n") },
    ];
}

/**
 * 格式化学生答案。
 * 按题型转换（选项索引 → 字母、布尔 → 本地化文案），
 * 而不是直接输出原始 value——否则选项索引 0 会显示成「0」、false 会显示成「false」。
 */
export function formatAnswer(ua: UserAnswer, s: PromptScaffold): string {
    switch (ua.type) {
        case "single_choice":
            return String.fromCharCode(65 + ua.value);
        case "multiple_choice":
            return ua.value
                .map((i) => String.fromCharCode(65 + i))
                .sort()
                .join(s.listSeparator);
        case "true_false":
            return ua.value ? s.trueLabel : s.falseLabel;
        case "fill_blank":
            return ua.value.join(s.blankSeparator);
        case "subjective":
        case "coding":
            return ua.value;
    }
}

/** 格式化正确答案 */
export function formatCorrect(q: Question, s: PromptScaffold): string {
    switch (q.type) {
        case "single_choice":
            return String.fromCharCode(65 + q.answer);
        case "multiple_choice":
            return q.answer
                .map((i) => String.fromCharCode(65 + i))
                .sort()
                .join(s.listSeparator);
        case "true_false":
            return q.answer ? s.trueLabel : s.falseLabel;
        case "fill_blank":
            return q.answer.map((opts) => opts.join(" / ")).join(s.blankSeparator);
        case "subjective":
            return q.reference_answer;
        case "coding":
            return q.reference_answer ?? q.answer;
    }
}

/** 选项列表：A. xxx | B. yyy */
function formatOptions(options: string[]): string {
    return options.map((o, j) => `${String.fromCharCode(65 + j)}. ${o}`).join(" | ");
}

/** 薄弱点分析消息 */
export function buildAnalysisMessages(
    prompts: PromptConfig,
    results: GradingResult[],
    questions: Question[],
    lang: PromptLang
): Array<{ role: "system" | "user"; content: string }> {
    const s = scaffoldOf(lang);
    const byId = new Map(questions.map((q) => [q.id, q]));
    // 用统一的通过线筛选，而不是看 correct 字段：
    // 客观题支持部分得分后，correct 表示「完全正确」，
    // 若按它筛选会把「多数选对的题」也报成薄弱点，与统计口径不一致。
    const wrong = results.filter((r) => r.score < PASS_SCORE);

    if (wrong.length === 0) {
        return [
            { role: "system", content: prompts.analysis },
            { role: "user", content: s.allCorrect },
        ];
    }

    const items = wrong.map((r) => {
        const q = byId.get(r.questionId);
        if (!q) return "";
        const parts = [
            fill(s.itemQuestion, q.question),
            fill(s.itemType, q.type),
            fill(s.itemScore, r.score, r.maxScore),
            fill(s.itemComment, r.comment ?? ""),
            r.userAnswer ? fill(s.itemStudentAnswer, formatAnswer(r.userAnswer, s)) : s.itemUnanswered,
            fill(s.itemCorrectAnswer, formatCorrect(q, s)),
        ];
        if (q.explanation) parts.push(fill(s.itemExplanation, q.explanation));
        return parts.join("\n");
    });

    return [
        { role: "system", content: prompts.analysis },
        { role: "user", content: fill(s.wrongIntro, items.join("\n")) },
    ];
}

/** 审题消息：让审题者审核题目列表 */
export function buildReviewMessages(
    prompts: PromptConfig,
    questions: Question[],
    lang: PromptLang
): Array<{ role: "system" | "user"; content: string }> {
    const s = scaffoldOf(lang);

    const items = questions.map((q, i) => {
        const parts = [
            fill(s.reviewItemHeader, i + 1),
            fill(s.reviewType, q.type),
            fill(s.reviewDifficulty, q.difficulty),
            fill(s.reviewStem, q.question),
        ];
        if (q.explanation) parts.push(fill(s.reviewExplanation, q.explanation));

        switch (q.type) {
            case "single_choice":
                parts.push(fill(s.reviewOptions, formatOptions(q.options)));
                parts.push(fill(s.reviewAnswer, String.fromCharCode(65 + q.answer)));
                break;
            case "multiple_choice":
                parts.push(fill(s.reviewOptions, formatOptions(q.options)));
                parts.push(
                    fill(
                        s.reviewAnswer,
                        q.answer
                            .map((j) => String.fromCharCode(65 + j))
                            .sort()
                            .join("")
                    )
                );
                break;
            case "true_false":
                parts.push(fill(s.reviewAnswer, q.answer ? s.trueLabel : s.falseLabel));
                break;
            case "fill_blank":
                parts.push(fill(s.reviewAnswer, q.answer.map((o) => o.join(" / ")).join(s.blankSeparator)));
                break;
            case "subjective":
                parts.push(fill(s.reviewRefAnswer, q.reference_answer));
                break;
            case "coding":
                parts.push(fill(s.reviewRefAnswer, q.answer ?? ""));
                if (q.test_cases) {
                    parts.push(
                        fill(
                            s.reviewTestCases,
                            q.test_cases.map((tc) => fill(s.testCaseLine, tc.input ?? "", tc.expected)).join("; ")
                        )
                    );
                }
                break;
        }
        return parts.join("\n");
    });

    return [
        { role: "system", content: prompts.review },
        { role: "user", content: fill(s.reviewIntro, questions.length, items.join("\n\n")) },
    ];
}

/** 重新生成失败题目的消息：让出题者只重新生成被拒的题目 */
export function buildRegenerateMessages(
    prompts: PromptConfig,
    general: GeneralConfig,
    failedQuestions: Question[],
    reasons: string[],
    content: string
): Array<{ role: "system" | "user"; content: string }> {
    const s = scaffoldOf(general.language);

    const system = [prompts.generate, s.jsonOnly, s.regenIntro];

    const items = failedQuestions.map((q, i) => {
        const parts = [
            fill(s.regenItemHeader, i + 1),
            fill(s.regenOrigType, q.type),
            fill(s.regenOrigDifficulty, q.difficulty),
            fill(s.regenOrigQuestion, q.question),
        ];
        if (q.type === "single_choice" || q.type === "multiple_choice") {
            parts.push(fill(s.regenOrigOptions, formatOptions(q.options)));
        }
        parts.push(fill(s.regenOrigAnswer, formatCorrect(q, s)));
        if (q.type === "subjective" || q.type === "coding") {
            parts.push(fill(s.regenOrigRef, q.reference_answer ?? ""));
        }
        if (q.explanation) parts.push(fill(s.regenOrigExplanation, q.explanation));
        parts.push(fill(s.regenReviewComment, reasons[i] ?? s.regenDefaultReason));
        return parts.join("\n");
    });

    const user = [
        s.regenOrigContent,
        "----",
        content,
        "----",
        fill(s.regenFailedIntro, items.join("\n\n")),
        fill(s.regenKeepTypeDifficulty, failedQuestions.length),
        fill(s.outputLang, s.langLabel),
        s.tagsInstruction,
        s.codingInstruction,
        s.jsonAgain,
    ].join("\n");

    return [
        { role: "system", content: system.join("\n\n") },
        { role: "user", content: user },
    ];
}

/** AI 对话：针对单道题目回答用户追问 */
export function buildChatMessages(
    prompts: PromptConfig,
    question: Question,
    result: GradingResult,
    analysis: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    userMessage: string,
    lang: PromptLang
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
    const s = scaffoldOf(lang);

    const answerText = result.userAnswer ? formatAnswer(result.userAnswer, s) : s.chatUnanswered;
    const ctx = [
        fill(s.chatQuestion, question.question),
        fill(s.chatType, question.type),
        fill(s.chatYourAnswer, answerText),
        fill(s.chatScore, result.score, result.maxScore),
        fill(s.chatComment, result.comment ?? ""),
    ].join("\n");

    const correctParts: string[] = [];
    switch (question.type) {
        case "single_choice":
            correctParts.push(fill(s.chatCorrectAnswer, String.fromCharCode(65 + question.answer)));
            break;
        case "multiple_choice":
            correctParts.push(
                fill(
                    s.chatCorrectAnswer,
                    question.answer
                        .map((i) => String.fromCharCode(65 + i))
                        .sort()
                        .join(s.listSeparator)
                )
            );
            break;
        case "true_false":
            correctParts.push(fill(s.chatCorrectAnswer, question.answer ? s.trueLabel : s.falseLabel));
            break;
        case "fill_blank":
            correctParts.push(
                fill(s.chatCorrectAnswer, question.answer.map((o) => o.join(" / ")).join(s.blankSeparator))
            );
            break;
        case "subjective":
            correctParts.push(fill(s.chatRefAnswer, question.reference_answer));
            break;
        case "coding":
            correctParts.push(fill(s.chatRefAnswer, question.reference_answer ?? question.answer));
            break;
    }
    if (question.explanation) correctParts.push(fill(s.chatExplanation, question.explanation));

    const system = [
        prompts.analysis,
        fill(s.chatContextIntro, ctx, correctParts.join("\n")),
        fill(s.chatAnalysisLabel, analysis),
        s.chatAskThisQuestion,
    ];

    return [{ role: "system", content: system.join("\n\n") }, ...history, { role: "user", content: userMessage }];
}

/** 全局 AI 答疑消息：针对整套试卷 */
export function buildGlobalChatMessages(
    prompts: PromptConfig,
    questions: Question[],
    results: GradingResult[],
    analysis: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    userMessage: string,
    lang: PromptLang
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
    const s = scaffoldOf(lang);

    // 按 questionId 关联，避免依赖 results 与 questions 的下标一致
    const resultById = new Map(results.map((r) => [r.questionId, r]));

    const summary = questions
        .map((q, i) => {
            const r = resultById.get(q.id);
            const answerText = r?.userAnswer ? formatAnswer(r.userAnswer, s) : s.chatUnanswered;
            return fill(s.chatSummaryLine, i + 1, q.type, q.question, answerText, r?.score ?? 0, r?.maxScore ?? 100);
        })
        .join("\n\n");

    const system = [
        prompts.analysis,
        fill(s.chatOverviewIntro, summary),
        fill(s.chatAnalysisLabel, analysis),
        s.chatAskOverall,
    ];

    return [{ role: "system", content: system.join("\n\n") }, ...history, { role: "user", content: userMessage }];
}
