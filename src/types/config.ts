import type { DifficultyDistribution, HeatmapConfig, QuestionType } from "./quiz";

/** AI 服务提供商（仅影响认证行为：ollama 无 key 时跳过认证头） */
export type AIProvider = "openai" | "ollama";

/** API 协议：决定端点路径、请求体格式、响应解析、认证头格式 */
export type AIProtocol = "chat" | "responses" | "messages";

/** 题目存储位置策略 */
export type StorageLocation = "sibling" | "notebook";

/** AI 接口配置 */
export interface AIConfig {
    provider: AIProvider;
    /** API 协议：chat=OpenAI Chat Completions, responses=OpenAI Responses, messages=Anthropic Messages */
    protocol: AIProtocol;
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
    /** forwardProxy 超时毫秒 */
    timeout: number;
    /** JSON Schema 约束输出开关，默认开启 */
    jsonSchemaEnabled: boolean;
    /** 测试连接的自定义提示词 */
    testPrompt: string;
}

/** 提示词配置 */
export interface PromptConfig {
    /** 生成系统提示词（含编程题指令） */
    generate: string;
    /** 主观题/编程题判分提示词 */
    gradeSubjective: string;
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
    /** 超纲比例（0-100），允许出题涵盖笔记外扩展知识点的百分比 */
    extraScopePct: number;
    /** 答题面板宽度（px） */
    panelWidth: number;
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
    metric: "avg",
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
    protocol: "chat",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4o-mini",
    temperature: 0.7,
    maxTokens: 16384,
    timeout: 120000,
    jsonSchemaEnabled: true,
    testPrompt: "请用一句话简要介绍你自己",
};

export const DEFAULT_PROMPTS: PromptConfig = {
    generate: `你是一位资深的出题专家。根据用户提供的笔记内容，按照指定的题型、难度分布生成复习题目。
要求：
1. 题目必须紧扣笔记内容，不得编造笔记中未涉及的知识点。
2. 每道题必须自包含：题干中须给出解题所需的全部信息（代码、数据、定义等），禁止用「笔记示例中」「上述代码」「上文提到的」等指代笔记内容。如果题目涉及笔记中的特定代码，必须在题干中完整复现该代码。
3. 每道题的解析要简明扼要，说明正确答案的依据。
4. 选项之间要有区分度，避免模棱两可。
5. 严格按 JSON Schema 输出，不要输出任何多余文本。
6. 难度说明：初级（基础概念识记与直接应用）、中级（综合理解与多步推理）、高级（深层原理、边缘情况与综合分析）。

【编程题指令】若选中内容含代码或涉及编程，可生成编程题（编写函数、修复代码、预测输出）。编程题必须包含：题目描述、初始代码模板（可选）、测试用例（输入/期望输出）、参考答案与解析。编程题题干中必须包含完整的代码上下文，不得引用笔记中的代码片段。`,
    gradeSubjective: `你是一名严格但公正的阅卷老师。根据题目、参考答案要点和学生作答，给出 0-100 的评分，并附上简要评语。
评分维度：知识正确性、逻辑完整性、表述清晰度。以 JSON 格式返回：{"score": 85, "comment": "评语"}

【编程题判分】当题目为编程题时，还需综合评估：代码正确性（能否通过测试用例）、边界处理、代码效率与可读性。若学生代码未通过测试用例，应根据其逻辑正确程度酌情给分，而非直接 0 分。`,
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
    extraScopePct: 0,
    panelWidth: 1100,
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
