import type { AIConfig, GeneralConfig, PromptConfig } from "@/types/config";
import type { DifficultyDistribution, GradingResult, Question, QuestionType } from "@/types/quiz";

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
        return `- 题目：${q?.question ?? ""}\n  得分：${r.score}/100\n  评语：${r.comment ?? ""}`;
    });
    return [
        { role: "system", content: prompts.analysis },
        { role: "user", content: `学生本次答题错误/低分题目如下：\n${items.join("\n")}` },
    ];
}

/** 取 AI 调用所需的 AIConfig 子集（仅类型层面复用） */
export type { AIConfig };
