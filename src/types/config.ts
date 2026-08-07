import type { DifficultyDistribution, HeatmapConfig, QuestionType } from "./quiz";

/** AI 服务提供商 */
export type AIProvider = "openai" | "ollama" | "custom";

/** 题目存储位置策略 */
export type StorageLocation = "sibling" | "notebook";

/** AI 接口配置 */
export interface AIConfig {
    provider: AIProvider;
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
    /** forwardProxy 超时毫秒 */
    timeout: number;
}

/** 提示词配置 */
export interface PromptConfig {
    /** 生成系统提示词 */
    generate: string;
    /** 编程题附加指令 */
    coding: string;
    /** 主观题判分提示词 */
    gradeSubjective: string;
    /** 编程题判分提示词 */
    gradeCoding: string;
    /** 薄弱点分析提示词 */
    analysis: string;
}

/** 通用设置 */
export interface GeneralConfig {
    allowedTypes: QuestionType[];
    difficulty: DifficultyDistribution;
    language: "zh" | "en";
    countdownEnabled: boolean;
    countdownMinutes: number;
    editorTheme: "auto" | "light" | "dark";
    storageLocation: StorageLocation;
    /** 指定笔记本 ID（storageLocation=notebook 时生效） */
    notebookId: string;
}

/** 完整配置 */
export interface RecallGenConfig {
    ai: AIConfig;
    prompts: PromptConfig;
    general: GeneralConfig;
    heatmap: HeatmapConfig;
}

export const DEFAULT_HEATMAP: HeatmapConfig = {
    enabled: true,
    metric: "max",
    ranges: [
        { min: 90, max: 100, color: "#196127" },
        { min: 80, max: 89, color: "#40c463" },
        { min: 60, max: 79, color: "#9be9a8" },
        { min: 30, max: 59, color: "#d9730d" },
        { min: 0, max: 29, color: "#ebedf0" },
    ],
};

export const DEFAULT_AI_CONFIG: AIConfig = {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxTokens: 8192,
    timeout: 120000,
};

export const DEFAULT_PROMPTS: PromptConfig = {
    generate: `你是一位资深的出题专家。根据用户提供的笔记内容，按照指定的题型、难度分布生成复习题目。
要求：
1. 题目必须紧扣笔记内容，不得编造笔记中未涉及的知识点。
2. 每道题的解析要简明扼要，说明正确答案的依据。
3. 选项之间要有区分度，避免模棱两可。
4. 严格按 JSON Schema 输出，不要输出任何多余文本。`,
    coding: `若选中内容包含代码块，优先针对该代码语言生成编程题。
编程题类型包括：根据需求编写函数、找出并修复代码错误、预测代码输出结果。
必须包含：题目描述、初始代码模板（可选）、测试用例（输入/期望输出）、参考答案与解析。`,
    gradeSubjective: `你是一名严格但公正的阅卷老师。根据题目、参考答案要点和学生作答，给出 0-100 的评分，并附上简要评语。
评分维度：知识正确性、逻辑完整性、表述清晰度。以 JSON 格式返回：{"score": 85, "comment": "评语"}`,
    gradeCoding: `你是一名资深编程阅卷老师。根据题目描述、测试用例、参考答案和学生代码，分析代码正确性、效率和可读性，给出 0-100 分。
以 JSON 格式返回：{"score": 85, "comment": "评语"}`,
    analysis: `你是一位学习顾问。基于学生本次答题的错误题目和涉及的知识点，生成一段复习指导意见。
指出薄弱知识点，给出针对性的复习建议和练习方向。以纯文本输出，不超过 300 字。`,
};

export const DEFAULT_GENERAL_CONFIG: GeneralConfig = {
    allowedTypes: ["single_choice", "multiple_choice", "fill_blank", "true_false", "subjective", "coding"],
    difficulty: { total: 10, easy: 4, medium: 4, hard: 2 },
    language: "zh",
    countdownEnabled: false,
    countdownMinutes: 30,
    editorTheme: "auto",
    storageLocation: "sibling",
    notebookId: "",
};

export function getDefaultConfig(): RecallGenConfig {
    return {
        ai: { ...DEFAULT_AI_CONFIG },
        prompts: { ...DEFAULT_PROMPTS },
        general: { ...DEFAULT_GENERAL_CONFIG, difficulty: { ...DEFAULT_GENERAL_CONFIG.difficulty } },
        heatmap: {
            ...DEFAULT_HEATMAP,
            ranges: DEFAULT_HEATMAP.ranges.map((r) => ({ ...r })),
        },
    };
}
