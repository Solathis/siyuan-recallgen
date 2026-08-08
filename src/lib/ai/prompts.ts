import type { AIConfig, GeneralConfig, PromptConfig } from "@/types/config";
import type { DifficultyDistribution, GradingResult, Question, QuestionType, UserAnswer } from "@/types/quiz";

// 重新导出 AIConfig 类型供 generator/grader 使用
export type { AIConfig };

/** 生成题目的消息序列 */
export function buildGenerateMessages(
    prompts: PromptConfig,
    general: GeneralConfig,
    content: string,
    types: QuestionType[],
    difficulty: DifficultyDistribution,
): Array<{ role: "system" | "user"; content: string }> {
    const system = [
        prompts.generate,
        "严格按 JSON Schema 输出，禁止输出多余文本或代码围栏。",
    ];

    const user = [
        `笔记内容：`,
        "----",
        content,
        "----",
        `允许的题型：${types.join(", ")}`,
        `难度分布：初级 ${difficulty.easy} 题、中级 ${difficulty.medium} 题、高级 ${difficulty.hard} 题（共 ${difficulty.total} 题）。`,
        `初级=基础概念识记与直接应用；中级=综合理解与多步推理；高级=深层原理、边缘情况与综合分析。`,
        `各题总数严格等于上述分布，不得超出。`,
        `超纲范围：允许 ${general.extraScopePct}% 的题目超出笔记内容，扩展到相关知识点`,
        `输出语言：${general.language === "zh" ? "中文" : "English"}`,
        `按以下 JSON 结构输出：{"questions":[{type,difficulty,question,options?,answer?,reference_answer?,language?,starter_code?,test_cases?,explanation?}]}。`,
        `single_choice/multiple_choice 的 answer 为选项索引（number 或 number[]）；true_false 为 boolean；fill_blank 的 answer 为每空可接受答案的二维数组；coding 的 answer 为参考答案代码。`,
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
): Array<{ role: "system" | "user"; content: string }> {
    const userParts: string[] = [`题目：${question.question}`];

    if (question.type === "coding") {
        const coding = question as Extract<Question, { type: "coding" }>;
        const cases = coding.test_cases?.map((t) => `输入:${t.input ?? ""} 期望:${t.expected}`).join("\n") ?? "";
        userParts.push(`参考答案：${coding.answer ?? ""}`);
        userParts.push(`测试用例：${cases}`);
        userParts.push(`学生代码：`);
        userParts.push("----");
        userParts.push(userAnswer);
        userParts.push("----");
    } else {
        const reference = "reference_answer" in question ? question.reference_answer : "";
        userParts.push(`参考答案要点：${reference}`);
        userParts.push(`学生作答：${userAnswer}`);
    }
    userParts.push(`请以 JSON 输出：{"score":0-100,"comment":"评语"}`);

    const systemPrompt = prompts.gradeSubjective;

    return [
        { role: "system", content: systemPrompt },
        { role: "user", content: userParts.join("\n") },
    ];
}

/** 格式化学生答案 */
function formatAnswer(_q: Question, ua: UserAnswer): string {
    switch (ua.type) {
        case "single_choice": return String.fromCharCode(65 + ua.value);
        case "multiple_choice": return ua.value.map((i) => String.fromCharCode(65 + i)).sort().join("、");
        case "true_false": return ua.value ? "正确" : "错误";
        case "fill_blank": return ua.value.join("；");
        case "subjective":
        case "coding": return ua.value;
    }
    return "";
}

/** 格式化正确答案 */
function formatCorrect(q: Question): string {
    switch (q.type) {
        case "single_choice": return String.fromCharCode(65 + q.answer);
        case "multiple_choice": return q.answer.map((i) => String.fromCharCode(65 + i)).sort().join("、");
        case "true_false": return q.answer ? "正确" : "错误";
        case "fill_blank": return q.answer.map((o) => o.join(" / ")).join("；");
        case "subjective":
        case "coding": return q.reference_answer;
    }
    return "";
}

/** 薄弱点分析消息 */
export function buildAnalysisMessages(
    prompts: PromptConfig,
    results: GradingResult[],
    questions: Question[],
): Array<{ role: "system" | "user"; content: string }> {
    const wrong = results.filter((r) => r.correct === false || (r.method === "ai" && r.score < 60));
    if (wrong.length === 0) {
        return [
            { role: "system", content: prompts.analysis },
            { role: "user", content: "学生本次全部正确，请简短鼓励即可。" },
        ];
    }
    const items = wrong.map((r) => {
        const q = questions.find((x) => x.id === r.questionId);
        if (!q) return "";
        const parts = [
            `- 题目：${q.question}`,
            `  题型：${q.type}`,
            `  得分：${r.score}/${r.maxScore}`,
            `  评语：${r.comment ?? ""}`,
        ];
        // 学生答案
        const ua = r.userAnswer;
        if (ua) {
            parts.push(`  学生答案：${formatAnswer(q, ua)}`);
        } else {
            parts.push(`  学生答案：（未作答）`);
        }
        // 正确答案（非主观/编程题）
        parts.push(`  正确答案：${formatCorrect(q)}`);
        if (q.explanation) parts.push(`  解析：${q.explanation}`);
        return parts.join("\n");
    });
    return [
        { role: "system", content: prompts.analysis },
        { role: "user", content: `学生本次答题错误/低分题目如下：\n${items.join("\n")}` },
    ];
}

/** 审题消息：让审题者审核题目列表 */
export function buildReviewMessages(
    prompts: PromptConfig,
    questions: Question[],
): Array<{ role: "system" | "user"; content: string }> {
    const items = questions.map((q, i) => {
        const parts = [`【第${i + 1}题】`, `题型: ${q.type}`, `难度: ${q.difficulty}`, `题干: ${q.question}`];
        if (q.explanation) parts.push(`解析: ${q.explanation}`);
        switch (q.type) {
            case "single_choice":
                parts.push(`选项: ${q.options.map((o, j) => String.fromCharCode(65 + j) + ". " + o).join(" | ")}`);
                parts.push(`答案: ${String.fromCharCode(65 + q.answer)}`);
                break;
            case "multiple_choice":
                parts.push(`选项: ${q.options.map((o, j) => String.fromCharCode(65 + j) + ". " + o).join(" | ")}`);
                parts.push(`答案: ${q.answer.map((j) => String.fromCharCode(65 + j)).sort().join("")}`);
                break;
            case "true_false":
                parts.push(`答案: ${q.answer ? "正确" : "错误"}`);
                break;
            case "fill_blank":
                parts.push(`答案: ${q.answer.map((o) => o.join(" / ")).join("；")}`);
                break;
            case "subjective":
                parts.push(`参考答案: ${q.reference_answer}`);
                break;
            case "coding":
                parts.push(`参考答案: ${q.answer ?? ""}`);
                if (q.test_cases) parts.push(`测试用例: ${q.test_cases.map((t) => `输入:${t.input ?? ""} 期望:${t.expected}`).join("; ")}`);
                break;
        }
        return parts.join("\n");
    });
    return [
        { role: "system", content: prompts.review },
        { role: "user", content: `请审核以下 ${questions.length} 道题目：\n\n${items.join("\n\n")}` },
    ];
}

/** 重新生成失败题目的消息：让出题者只重新生成被拒的题目 */
export function buildRegenerateMessages(
    prompts: PromptConfig,
    general: GeneralConfig,
    failedQuestions: Question[],
    reasons: string[],
    content: string,
): Array<{ role: "system" | "user"; content: string }> {
    const system = [
        prompts.generate,
        "严格按 JSON Schema 输出，禁止输出多余文本或代码围栏。",
        "你之前生成的部分题目未通过审题，请根据审题意见重新生成这些题目。",
    ];
    const items = failedQuestions.map((q, i) => {
        return `【第${i + 1}题（需重新生成）】\n原题型: ${q.type}\n原难度: ${q.difficulty}\n原题: ${q.question}\n审题意见: ${reasons[i] ?? "未通过"}`;
    });
    const user = [
        `原始笔记内容：`,
        "----",
        content,
        "----",
        `以下题目未通过审核，请重新生成：\n\n${items.join("\n\n")}`,
        `要求重新生成 ${failedQuestions.length} 道题，每道题的题型和难度必须与上方对应的原题型和原难度完全一致。`,
        `输出语言：${general.language === "zh" ? "中文" : "English"}`,
        `按以下 JSON 结构输出：{"questions":[{type,difficulty,question,options?,answer?,reference_answer?,language?,starter_code?,test_cases?,explanation?}]}。`,
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
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
    const ctx = `题目：${question.question}\n` +
        `题型：${question.type}\n` +
        `你的答案：${result.userAnswer?.value ?? "未答"}\n` +
        `得分：${result.score}/${result.maxScore}\n` +
        `评语：${result.comment ?? ""}`;
    const correctParts: string[] = [];
    switch (question.type) {
        case "single_choice": correctParts.push(`正确答案：${String.fromCharCode(65 + question.answer)}`); break;
        case "multiple_choice": correctParts.push(`正确答案：${question.answer.map((i) => String.fromCharCode(65 + i)).sort().join("、")}`); break;
        case "true_false": correctParts.push(`正确答案：${question.answer ? "正确" : "错误"}`); break;
        case "fill_blank": correctParts.push(`正确答案：${question.answer.map((o) => o.join(" / ")).join("；")}`); break;
        case "subjective": correctParts.push(`参考答案：${question.reference_answer}`); break;
        case "coding": correctParts.push(`参考答案：${question.reference_answer ?? question.answer}`); break;
    }
    if (question.explanation) correctParts.push(`解析：${question.explanation}`);
    const system = [
        prompts.analysis,
        `以下是学生该题的答题情况：\n${ctx}\n\n${correctParts.join("\n")}`,
        `整体薄弱点分析：${analysis}`,
        "请针对这道题回答学生的问题。如涉及相关概念可以适当延伸，但需围绕本题。",
    ];
    return [
        { role: "system", content: system.join("\n\n") },
        ...history,
        { role: "user", content: userMessage },
    ];
}


