import type { DifficultyDistribution, HeatmapConfig, QuestionType } from "./quiz";

/** AI 服务提供商（仅影响认证行为：ollama 无 key 时跳过认证头） */
export type AIProvider = "openai" | "ollama";

/** API 协议：决定端点路径、请求体格式、响应解析、认证头格式 */
export type AIProtocol = "chat" | "responses" | "messages";

/** 题目存储位置策略 */
export type StorageLocation = "sibling" | "notebook";

// ── 多端点多模型架构 ────────────────────────────────────────────────

/** API 端点：一个服务商连接配置 */
export interface AIEndpoint {
    id: string;
    name: string;
    provider: AIProvider;
    protocol: AIProtocol;
    baseUrl: string;
    apiKey: string;
}

/** AI 模型：绑定到某个端点，携带独立温度/token 参数 */
export interface AIModel {
    id: string;
    name: string;
    endpointId: string;
    temperature: number;
    maxTokens: number;
}

/** AI 角色：出题者 / 审题者 / 判题者，各指向一个模型 ID */
export interface AIRoles {
    generator: string;
    reviewer: string;
    grader: string;
}

/** AI 接口配置（多端点 + 多模型 + 三角色） */
export interface AIConfig {
    endpoints: AIEndpoint[];
    models: AIModel[];
    roles: AIRoles;
    /** forwardProxy 超时毫秒 */
    timeout: number;
    /** JSON Schema 严格模式开关 */
    jsonSchemaEnabled: boolean;
    /** 测试连接使用的模型 ID */
    testModelId: string;
    /** 测试连接的自定义提示词 */
    testPrompt: string;
}

/** 提示词配置 */
export interface PromptConfig {
    /** 生成系统提示词（含编程题指令） */
    generate: string;
    /** 审题提示词 */
    review: string;
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
    storageLocation: StorageLocation;
    /** 指定笔记本 ID（storageLocation=notebook 时生效） */
    notebookId: string;
    /** 超纲比例（0-100） */
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

// ── 默认值 ──────────────────────────────────────────────────────────

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

const DEFAULT_ENDPOINT_NAME_ZH = "默认端点";
const DEFAULT_ENDPOINT_NAME_EN = "Default";

const DEFAULT_ENDPOINT: AIEndpoint = {
    id: "ep-default",
    name: DEFAULT_ENDPOINT_NAME_ZH,
    provider: "openai",
    protocol: "chat",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
};

/** 默认单模型，三个角色共用 */
function defaultModels(): AIModel[] {
    const base = { endpointId: DEFAULT_ENDPOINT.id };
    return [{ ...base, id: "m-default", name: "gpt-4o-mini", temperature: 0.7, maxTokens: 16384 }];
}

export const DEFAULT_AI_CONFIG: AIConfig = {
    endpoints: [{ ...DEFAULT_ENDPOINT }],
    models: defaultModels(),
    roles: { generator: "m-default", reviewer: "m-default", grader: "m-default" },
    timeout: 120000,
    jsonSchemaEnabled: true,
    testModelId: "m-default",
    testPrompt: "请用一句话简要介绍你自己",
};

/** 语言相关的默认值 */
export function defaultEndpointName(lang: "zh" | "en"): string {
    return lang === "en" ? DEFAULT_ENDPOINT_NAME_EN : DEFAULT_ENDPOINT_NAME_ZH;
}
export function defaultTestPrompt(lang: "zh" | "en"): string {
    return lang === "en" ? "Briefly introduce yourself in one sentence." : "请用一句话简要介绍你自己";
}

const DEFAULT_PROMPTS_ZH: PromptConfig = {
    generate: `你是一位资深的出题专家。根据用户提供的笔记内容，按照指定的题型、难度分布生成复习题目。
要求：
1. 题目必须紧扣笔记内容，不得编造笔记中未涉及的知识点。
2. 每道题必须自包含：题干中须给出解题所需的全部信息（代码、数据、定义等），禁止用「笔记示例中」「上述代码」「上文提到的」等指代笔记内容。如果题目涉及笔记中的特定代码，必须在题干中完整复现该代码。
3. 每道题的解析要简明扼要，说明正确答案的依据。
4. 选项之间要有区分度，避免模棱两可。
5. 严格按 JSON Schema 输出，不要输出任何多余文本。
6. 难度说明：初级（基础概念识记与直接应用）、中级（综合理解与多步推理）、高级（深层原理、边缘情况与综合分析）。

【编程题指令】若选中内容含代码或涉及编程，可生成编程题（编写函数、修复代码、预测输出）。编程题必须包含：题目描述、初始代码模板（可选）、测试用例（输入/期望输出）、参考答案与解析。编程题题干中必须包含完整的代码上下文，不得引用笔记中的代码片段。`,
    review: `你是一位严谨的审题专家。审查题目是否严谨、正确、无歧义。
审查维度：
1. 题干是否自包含，不依赖外部上下文或笔记原文。
2. 答案是否正确且唯一（选择题）。
3. 选项之间是否有区分度，避免模棱两可。
4. 解析是否准确说明答案依据。
5. 难度是否与标注匹配（初级/中级/高级）。
6. 编程题是否有完整测试用例。

如果题目不通过，请在 reason 中说明具体问题。
对每道题给出审核结论，以 JSON 输出：{"reviews":[{"index":0,"passed":true,"reason":""}]}`,
    gradeSubjective: `你是一名严格但公正的阅卷老师。根据题目、参考答案要点和学生作答，给出 0-100 的评分，并附上简要评语。
评分维度：知识正确性、逻辑完整性、表述清晰度。以 JSON 格式返回：{"score": 85, "comment": "评语"}

【编程题判分】当题目为编程题时，还需综合评估：代码正确性（能否通过测试用例）、边界处理、代码效率与可读性。若学生代码未通过测试用例，应根据其逻辑正确程度酌情给分，而非直接 0 分。`,
    analysis: `你是一位学习顾问。基于学生本次答题的错误题目和涉及的知识点，生成一段复习指导意见。
指出薄弱知识点，给出针对性的复习建议和练习方向。以纯文本输出，不超过 300 字。`,
};

export const DEFAULT_PROMPTS: PromptConfig = DEFAULT_PROMPTS_ZH;

export const DEFAULT_PROMPTS_EN: PromptConfig = {
    generate: `You are an experienced exam question author. Based on the user's note content, generate review questions according to the specified question types and difficulty distribution.
Requirements:
1. Questions must closely follow the note content; do not fabricate knowledge points not covered in the notes.
2. Each question must be self-contained: the question stem must include all information needed to solve it (code, data, definitions, etc.). Do not use references like "in the example above," "the aforementioned code," or "mentioned above." If a question involves specific code from the notes, the full code must be reproduced in the question stem.
3. Each question's explanation should be concise, explaining the basis for the correct answer.
4. Options should be distinguishable, avoiding ambiguity.
5. Output strictly according to JSON Schema, with no extra text.
6. Difficulty levels: Easy (basic concept recall and direct application), Medium (comprehensive understanding and multi-step reasoning), Hard (deep principles, edge cases, and comprehensive analysis).

[Coding Questions] If the selected content contains code or involves programming, coding questions may be generated (write functions, fix code, predict output). Coding questions must include: problem description, optional starter code template, test cases (input/expected output), reference answer and explanation. The question stem must include complete code context, not reference code snippets from the notes.`,
    review: `You are a rigorous question reviewer. Review whether questions are rigorous, correct, and unambiguous.
Review dimensions:
1. Whether the question stem is self-contained, not relying on external context or the original notes.
2. Whether the answer is correct and unique (for choice questions).
3. Whether options are distinguishable, avoiding ambiguity.
4. Whether the explanation accurately explains the answer basis.
5. Whether the difficulty matches the label (Easy/Medium/Hard).
6. Whether coding questions have complete test cases.

If a question fails review, explain the specific issue in the reason field.
Provide review results for each question in JSON format: {"reviews":[{"index":0,"passed":true,"reason":""}]}`,
    gradeSubjective: `You are a strict but fair grader. Based on the question, reference answer key points, and the student's response, provide a score from 0-100 with a brief comment.
Grading dimensions: knowledge correctness, logical completeness, clarity of expression. Return in JSON format: {"score": 85, "comment": "comment"}

[Coding Grading] When the question is a coding question, also comprehensively evaluate: code correctness (can it pass test cases), boundary handling, code efficiency and readability. If the student's code fails test cases, score based on logical correctness rather than giving a direct 0.`,
    analysis: `You are a learning advisor. Based on the student's incorrect questions and related knowledge points from this quiz, generate a study guide.
Identify weak knowledge points, provide targeted review suggestions and practice directions. Output as plain text, no more than 200 words.`,
};

export function getDefaultPrompts(lang: "zh" | "en"): PromptConfig {
    return lang === "en" ? { ...DEFAULT_PROMPTS_EN } : { ...DEFAULT_PROMPTS_ZH };
}

export const DEFAULT_GENERAL_CONFIG: GeneralConfig = {
    allowedTypes: ["single_choice", "multiple_choice", "fill_blank", "true_false", "subjective", "coding"],
    difficulty: { total: 15, easy: 6, medium: 6, hard: 3 },
    language: "zh",
    countdownEnabled: true,
    countdownMinutes: 30,
    storageLocation: "sibling",
    notebookId: "",
    extraScopePct: 20,
    panelWidth: 1100,
};

export function getDefaultConfig(): RecallGenConfig {
    return {
        ai: {
            endpoints: DEFAULT_AI_CONFIG.endpoints.map((e) => ({ ...e })),
            models: DEFAULT_AI_CONFIG.models.map((m) => ({ ...m })),
            roles: { ...DEFAULT_AI_CONFIG.roles },
            timeout: DEFAULT_AI_CONFIG.timeout,
            jsonSchemaEnabled: DEFAULT_AI_CONFIG.jsonSchemaEnabled,
            testModelId: DEFAULT_AI_CONFIG.testModelId,
            testPrompt: DEFAULT_AI_CONFIG.testPrompt,
        },
        prompts: { ...DEFAULT_PROMPTS },
        general: { ...DEFAULT_GENERAL_CONFIG, difficulty: { ...DEFAULT_GENERAL_CONFIG.difficulty } },
        heatmap: {
            ...DEFAULT_HEATMAP,
            ranges: DEFAULT_HEATMAP.ranges.map((r) => ({ ...r })),
        },
    };
}

/**
 * 将旧版单端点 AIConfig 迁移到多端点格式。
 * 兼容 endpoints 数组已存在的新格式。
 */
export function migrateAIConfig(old: Partial<AIConfig> | undefined | null): AIConfig {
    const def = DEFAULT_AI_CONFIG;
    if (!old)
        return {
            ...def,
            endpoints: def.endpoints.map((e) => ({ ...e })),
            models: def.models.map((m) => ({ ...m })),
            roles: { ...def.roles },
        };

    // 新格式：已有 endpoints 数组
    if (Array.isArray(old.endpoints) && old.endpoints.length > 0) {
        return {
            endpoints: old.endpoints,
            models: old.models ?? def.models,
            roles: { ...def.roles, ...old.roles },
            timeout: old.timeout ?? def.timeout,
            jsonSchemaEnabled: old.jsonSchemaEnabled ?? def.jsonSchemaEnabled,
            testModelId: old.testModelId ?? def.testModelId,
            testPrompt: old.testPrompt ?? def.testPrompt,
        };
    }

    // 旧格式迁移：provider/protocol/baseUrl/apiKey/model/temperature/maxTokens → 单端点三模型
    const provider = (old as Record<string, unknown>).provider as AIProvider | undefined;
    const protocol = (old as Record<string, unknown>).protocol as AIProtocol | undefined;
    const baseUrl = (old as Record<string, unknown>).baseUrl as string | undefined;
    const apiKey = (old as Record<string, unknown>).apiKey as string | undefined;
    const model = (old as Record<string, unknown>).model as string | undefined;
    const temperature = (old as Record<string, unknown>).temperature as number | undefined;
    const maxTokens = (old as Record<string, unknown>).maxTokens as number | undefined;

    const endpoint: AIEndpoint = {
        id: "ep-default",
        name: DEFAULT_ENDPOINT_NAME_ZH,
        provider: provider ?? "openai",
        protocol: protocol ?? "chat",
        baseUrl: baseUrl ?? "https://api.openai.com/v1",
        apiKey: apiKey ?? "",
    };
    const mName = model ?? "gpt-4o-mini";
    const mTemp = temperature ?? 0.7;
    const mTok = maxTokens ?? 16384;
    const models: AIModel[] = [
        { id: "m-default", name: mName, endpointId: "ep-default", temperature: mTemp, maxTokens: mTok },
    ];

    return {
        endpoints: [endpoint],
        models,
        roles: { generator: "m-default", reviewer: "m-default", grader: "m-default" },
        timeout: ((old as Record<string, unknown>).timeout as number | undefined) ?? def.timeout,
        jsonSchemaEnabled:
            ((old as Record<string, unknown>).jsonSchemaEnabled as boolean | undefined) ?? def.jsonSchemaEnabled,
        testModelId: "m-default",
        testPrompt: ((old as Record<string, unknown>).testPrompt as string | undefined) ?? def.testPrompt,
    };
}
