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
    const system = [prompts.generate];
    if (types.includes("coding")) {
        system.push(prompts.coding);
    }
    system.push("严格按 JSON Schema 输出，禁止输出多余文本或代码围栏。");

    const user = [
        `笔记内容：`,
        "----",
        content,
        "----",
        `允许的题型：${types.join(", ")}`,
        `难度分布：初级 ${difficulty.easy} 题、中级 ${difficulty.medium} 题、高级 ${difficulty.hard} 题（共 ${difficulty.total} 题）。`,
        `各题总数严格等于上述分布，不得超出。`,
        `输出语言：${general.language === "zh" ? "中文" : "English"}`,
        `按以下 JSON 结构输出：{"questions":[{type,difficulty,question,options?,answer?,reference_answer?,language?,starter_code?,test_cases?,explanation?}]}。`,
        `single_choice/multiple_choice 的 answer 为选项索引（number 或 number[]）；true_false 为 boolean；fill_blank 的 answer 为每空可接受答案的二维数组；coding 的 answer 为参考答案代码。`,
    ].join("\n");

    return [
        { role: "system", content: system.join("\n\n") },
        { role: "user", content: user },
    ];
}

/** 主观题判分消息 */
export function buildGradeSubjectiveMessages(
    prompts: PromptConfig,
    question: Question,
    userAnswer: string,
): Array<{ role: "system" | "user"; content: string }> {
    const reference = "reference_answer" in question ? question.reference_answer : "";
    const user = [
        `题目：${question.question}`,
        `参考答案要点：${reference}`,
        `学生作答：${userAnswer}`,
        `请以 JSON 输出：{"score":0-100,"comment":"评语"}`,
    ].join("\n");
    return [
        { role: "system", content: prompts.gradeSubjective },
        { role: "user", content: user },
    ];
}

/** 编程题判分消息 */
export function buildGradeCodingMessages(
    prompts: PromptConfig,
    question: Question,
    userAnswer: string,
): Array<{ role: "system" | "user"; content: string }> {
    const coding = question as Extract<Question, { type: "coding" }>;
    const cases = coding.test_cases?.map((t) => `输入:${t.input ?? ""} 期望:${t.expected}`).join("\n") ?? "";
    const user = [
        `题目：${question.question}`,
        `参考答案：${coding.answer ?? ""}`,
        `测试用例：${cases}`,
        `学生代码：`,
        "----",
        userAnswer,
        "----",
        `请以 JSON 输出：{"score":0-100,"comment":"评语"}`,
    ].join("\n");
    return [
        { role: "system", content: prompts.gradeCoding },
        { role: "user", content: user },
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
