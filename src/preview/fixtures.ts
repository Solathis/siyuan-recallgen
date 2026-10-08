/**
 * 预览台的种子数据。
 *
 * 目标不是「随便塞点假数据」，而是让每一处界面分支都真的能出现：
 * 六种题型各一道（含两道编程题，其中一道是可直接执行的 JavaScript）、
 * 已答/未答/标记混合、判分的正确/部分正确/错误/未答四种状态、
 * 题库里四种到期状态、以及够铺满热力图与折线图的成绩历史。
 *
 * 时间基准取 Date.now()，这样「到期」这类相对时间在什么时候打开预览都合理；
 * 随机部分用固定的 LCG 种子，保证每次打开看到的是同一组数据。
 */

import { buildIndexEntry } from "@/lib/quiz/stats";
import { newCardState, questionFingerprint, scheduleReview, type BankAttempt, type BankItem } from "@/lib/quiz/bank";
import { getDefaultConfig, type RecallGenConfig } from "@/types/config";
import type { GradingResult, Question, QuizSession, ScoreIndexEntry, ScoreRecord, UserAnswer } from "@/types/quiz";

const DAY = 86_400_000;

/** 固定种子的线性同余发生器：同一份数据每次打开都一样，便于对比截图 */
function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x1_0000_0000;
    };
}

/** 题目来源文档 */
export const PREVIEW_DOC_ID = "20261008120000-rgpreview";
export const PREVIEW_DOC_TITLE = "Svelte 5 响应式系统";

/* ── 配置 ──────────────────────────────────────────────────────── */

/**
 * 预览用的配置。
 * apiKey 必须非空，否则 QuizPanel 的 checkAiConfig 会直接拦下出题流程，
 * 预览里就永远看不到「生成中」这一屏了。
 */
export function previewConfig(): RecallGenConfig {
    const config = getDefaultConfig();
    config.ai.endpoints[0].apiKey = "sk-preview-not-a-real-key";
    config.ai.endpoints[0].baseUrl = "https://api.example.com/v1";
    config.ai.models = [
        {
            id: "m-fast",
            endpointId: config.ai.endpoints[0].id,
            name: "gpt-4o-mini",
            temperature: 0.4,
            maxTokens: 16384,
        },
        {
            id: "m-strong",
            endpointId: config.ai.endpoints[0].id,
            name: "claude-3-7-sonnet",
            temperature: 0.7,
            maxTokens: 32768,
        },
    ];
    config.ai.roles = { generator: "m-fast", reviewer: "m-strong", grader: "m-strong" };
    config.ai.jsonSchemaEnabled = true;
    config.general.difficulty = { total: 8, easy: 3, medium: 3, hard: 2 };
    config.general.countdownEnabled = true;
    config.general.countdownMinutes = 25;
    config.general.language = "zh";
    return config;
}

export const previewNotebooks = [
    { id: "20260101000000-nbnote01", name: "学习笔记" },
    { id: "20260101000000-nbwork02", name: "工作笔记" },
];

/* ── 题目 ──────────────────────────────────────────────────────── */

export const previewQuestions: Question[] = [
    {
        id: "q-1",
        type: "single_choice",
        difficulty: "easy",
        tags: ["runes", "state"],
        question: "关于 Svelte 5 的 `$state`，下列说法正确的是？",
        options: [
            "它只能用于组件顶层，不能放在函数或模块里",
            "对象/数组用 `$state` 声明后，对其属性的读写在模板与副作用中都会被追踪",
            "它返回的是一个只读快照，必须配合 `$derived` 才能读取",
            "它在服务端渲染时不可用",
        ],
        answer: 1,
        explanation:
            "`$state` 会返回一个响应式代理，深层属性的读写都会被追踪；因此对象内部的字段变更同样能触发依赖它的界面更新。",
    },
    {
        id: "q-2",
        type: "multiple_choice",
        difficulty: "medium",
        tags: ["runes"],
        question: "下列哪些是 Svelte 5 中真正存在的 rune？（多选）",
        options: ["`$state`", "`$derived`", "`$effect`", "`$props`", "`$watch`", "`$computed`"],
        answer: [0, 1, 2, 3],
        explanation:
            "`$watch` 与 `$computed` 并不存在，它们分别对应 `$effect` 与 `$derived`；这类命名最容易凭直觉选错。",
    },
    {
        id: "q-3",
        type: "fill_blank",
        difficulty: "easy",
        tags: ["runes", "derived"],
        question: "在 Svelte 5 中，声明派生值用的是 ______，声明副作用用的是 ______。",
        answer: [
            ["$derived", "派生值", "计算值"],
            ["$effect", "副作用"],
        ],
        explanation: "前者由依赖计算得出、不产生副作用；后者用于在依赖变化时执行有副作用的动作。",
    },
    {
        id: "q-4",
        type: "true_false",
        difficulty: "medium",
        tags: ["state", "snapshot"],
        question: "把 `$state` 的响应式代理直接传给第三方库（例如图表库）是安全的，因为代理与普通对象行为一致。",
        answer: false,
        explanation:
            "代理会拦截读写并与组件的响应式系统耦合；传给外部库应使用 `$state.snapshot(...)` 取回纯对象，否则可能出现意外的重渲染与调试困难。",
    },
    {
        id: "q-5",
        type: "subjective",
        difficulty: "hard",
        tags: ["snapshot", "state"],
        question: "说明 `$state.snapshot` 的用途，并举一个不使用它会出问题的场景。",
        reference_answer:
            "`$state.snapshot` 把响应式代理转成普通对象/数组的快照。典型场景：把状态交给外部库（图表、结构化克隆、postMessage、JSON.stringify 之外需要纯对象的 API）时，代理会带着拦截器泄漏出去，导致外部库读到的是代理、或者外部库的写入意外触发组件更新。另一个场景是 `structuredClone` / `postMessage`：代理无法被结构化克隆，会直接抛错。",
        explanation:
            "要点：一是「取回纯值」，二是「跨边界时避免代理泄漏」，三是可举 structuredClone/postMessage 抛错的例子。",
    },
    {
        id: "q-6",
        type: "coding",
        difficulty: "medium",
        tags: ["python", "算法"],
        question:
            "实现 `dedupe_by(items, key=None)`：按 `key(item)` 的结果去重并保持首次出现的顺序；`key` 为 `None` 时按元素本身去重。",
        language: "python",
        entry_point: "dedupe_by",
        starter_code: `def dedupe_by(items, key=None):
    """按 key(item) 去重并保持首次出现的顺序。"""
    # 在此实现
    pass
`,
        test_cases: [
            {
                input: "dedupe_by([1, 1, 2, 3, 3])",
                args: [[1, 1, 2, 3, 3]],
                expected: "[1, 2, 3]",
                description: "基础去重并保持顺序",
            },
            {
                input: 'dedupe_by([{"id": 1}, {"id": 2}, {"id": 1}], key=lambda x: x["id"])',
                args: [[{ id: 1 }, { id: 2 }, { id: 1 }]],
                expected: '[{"id": 1}, {"id": 2}]',
                description: "按自定义 key 去重",
            },
            {
                input: "dedupe_by([])",
                args: [[]],
                expected: "[]",
                description: "空输入",
            },
        ],
        answer: `def dedupe_by(items, key=None):
    """按 key(item) 去重并保持首次出现的顺序。"""
    seen = set()
    result = []
    for item in items:
        token = key(item) if key is not None else item
        if token in seen:
            continue
        seen.add(token)
        result.append(item)
    return result
`,
        explanation:
            "关键是「先查再写」：用 set 记录出现过的 token，命中就跳过，否则加入结果并登记。注意不能先 add 再判断，否则每个元素都会被跳过。",
    },
    {
        id: "q-7",
        type: "coding",
        difficulty: "hard",
        tags: ["javascript", "算法"],
        question:
            "实现 `chunk(list, size)`：把数组按 `size` 切成若干块，返回结果数组；最后一块可以不满。`size` 不是正整数时返回空数组，且不得死循环。",
        language: "javascript",
        entry_point: "chunk",
        starter_code: `function chunk(list, size) {
    // 在此实现
}
`,
        test_cases: [
            {
                input: "chunk([1, 2, 3, 4, 5], 2)",
                args: [[1, 2, 3, 4, 5], 2],
                expected: "[[1,2],[3,4],[5]]",
                description: "最后一块可以不满",
            },
            { input: "chunk([], 3)", args: [[], 3], expected: "[]", description: "空数组" },
            {
                input: "chunk([1, 2, 3], 0)",
                args: [[1, 2, 3], 0],
                expected: "[]",
                description: "size 非正数时不得死循环",
            },
        ],
        answer: `function chunk(list, size) {
    if (!Number.isInteger(size) || size <= 0) return [];
    const out = [];
    for (let i = 0; i < list.length; i += size) {
        out.push(list.slice(i, i + size));
    }
    return out;
}
`,
        explanation: "步长非正会让 `i += size` 永不前进而死循环，必须先挡掉；`slice` 天然容忍末块不足，无需额外分支。",
    },
    {
        id: "q-8",
        type: "single_choice",
        difficulty: "easy",
        tags: ["算法", "复杂度"],
        question: "归并排序的时间复杂度是 $O(n\\log n)$，其原因是：",
        options: [
            "每一层合并都是线性扫描，而递归共 $\\log n$ 层",
            "递归深度恒为常数，与 $n$ 无关",
            "它的额外空间复杂度是 $O(1)$，省下的时间换来了这个复杂度",
            "元素比较次数与输入数据分布无关，因此恒为 $n\\log n$",
        ],
        answer: 0,
        explanation:
            "每层合并需要线性时间，递归把规模减半因此共 $\\log n$ 层，两者相乘即 $O(n\\log n)$。它的额外空间是 $O(n)$，并非 $O(1)$。",
    },
];

/* ── 一次进行中的答题会话 ──────────────────────────────────────── */

const previewAnswers: Record<string, UserAnswer> = {
    "q-1": { type: "single_choice", value: 1 },
    "q-2": { type: "multiple_choice", value: [0, 1] },
    "q-3": { type: "fill_blank", value: ["派生值", ""] },
    "q-5": {
        type: "subjective",
        value: "`$state.snapshot` 用来把响应式代理转回普通对象。比如要把状态交给图表库，或者要用 structuredClone/postMessage 传出去时，代理会带着拦截器泄漏出去，甚至直接抛错，所以要先取快照。",
    },
    "q-6": {
        type: "coding",
        value: `def dedupe_by(items, key=None):
    seen = set()
    result = []
    for item in items:
        token = key(item) if key else item
        seen.add(token)
        result.append(item)
    return result
`,
    },
    "q-8": { type: "single_choice", value: 2 },
};

export function previewSession(): QuizSession {
    const now = Date.now();
    return {
        id: "preview-session",
        sourceDocId: PREVIEW_DOC_ID,
        sourceTitle: PREVIEW_DOC_TITLE,
        questions: previewQuestions,
        createdAt: now - 3 * 3600_000,
        answers: { ...previewAnswers },
        flagged: { "q-4": true, "q-7": true },
        timings: { "q-1": 38, "q-2": 96, "q-3": 141, "q-4": 12, "q-5": 233, "q-6": 402, "q-7": 8, "q-8": 55 },
    };
}

/** 空会话：用于预览「整屏空态」 */
export function previewEmptySession(): QuizSession {
    const now = Date.now();
    return {
        id: "preview-empty",
        sourceDocId: PREVIEW_DOC_ID,
        sourceTitle: PREVIEW_DOC_TITLE,
        questions: [],
        createdAt: now,
        answers: {},
    };
}

/* ── 判分结果 ──────────────────────────────────────────────────── */

export const previewResults: GradingResult[] = [
    {
        questionId: "q-1",
        type: "single_choice",
        method: "local",
        correct: true,
        score: 100,
        maxScore: 100,
        userAnswer: previewAnswers["q-1"],
        seconds: 38,
    },
    {
        questionId: "q-2",
        type: "multiple_choice",
        method: "local",
        correct: false,
        score: 50,
        maxScore: 100,
        comment: "漏选 1 项",
        userAnswer: previewAnswers["q-2"],
        seconds: 96,
    },
    {
        questionId: "q-3",
        type: "fill_blank",
        method: "local",
        correct: false,
        score: 50,
        maxScore: 100,
        userAnswer: previewAnswers["q-3"],
        seconds: 141,
    },
    {
        questionId: "q-4",
        type: "true_false",
        method: "local",
        correct: false,
        score: 0,
        maxScore: 100,
        seconds: 12,
    },
    {
        questionId: "q-5",
        type: "subjective",
        method: "ai",
        correct: null,
        score: 78,
        maxScore: 100,
        comment:
            "要点基本覆盖：把它交给外部库、以及跨线程/克隆时不能传代理都提到了。缺一处具体的失败例子（例如 structuredClone 直接抛错），可再补一句。",
        userAnswer: previewAnswers["q-5"],
        seconds: 233,
    },
    {
        questionId: "q-6",
        type: "coding",
        method: "ai",
        correct: null,
        score: 55,
        maxScore: 100,
        comment:
            "`seen.add(token)` 写在判断之前，等于每个元素都被跳过、去重结果恒为空——测试用例 1、2 会失败。思路对，边界条件（key 为 None 时）也考虑到了，扣在这一点上。",
        userAnswer: previewAnswers["q-6"],
        seconds: 402,
    },
    {
        questionId: "q-7",
        type: "coding",
        method: "local",
        correct: false,
        score: 0,
        maxScore: 100,
        comment: "未作答",
        seconds: 8,
    },
    {
        questionId: "q-8",
        type: "single_choice",
        method: "local",
        correct: false,
        score: 0,
        maxScore: 100,
        userAnswer: previewAnswers["q-8"],
        seconds: 55,
    },
];

export const previewAnalysis = `## 本次薄弱点

- **编程题（去重保序）**：核心思路正确，但把「加入已见集合」放在了判断之前，逻辑上等于全部跳过。这是典型的顺序错误，不是理解问题，改一行即可。
- **填空题**：第二个空没有作答。「$derived 与 $effect 的分工」是本单元最基础的一组概念，建议重读一遍。
- **多选**：漏选一项。多选题按选项计分，拿不准时不要空着——部分得分好过零分。

## 建议的复习顺序

1. 重写一遍 \`dedupe_by\`，并自己补一个「空列表」用例。
2. 把 runes 那一节的例子逐个在编辑器里跑一遍，观察哪些写法会报错。
3. 下次练习时留 10 分钟做多选题的专项，重点练「哪些选项一定错」的排除法。

> 整体达标率 48%，还没到 60% 的通过线。本轮共 8 题，其中 2 题未作答。`;

/** 各角色对话时的固定回复，避免预览里出现空白 */
export const previewChatReply =
    "这一题的关键在于「先判断再写入」的顺序：\n\n1. 先算出这个元素用来去重的标识 token；\n2. 如果 token 已经在集合里，直接跳过；\n3. 否则加入集合，同时把元素追加到结果。\n\n原答案把第 2、3 步写反了，所以每个元素都被当成「已出现过」而跳过，结果恒为空数组。";

/* ── 题库 ──────────────────────────────────────────────────────── */

/** 题库里额外补几道题，让四种到期状态都有样本 */
const extraBankQuestions: Question[] = [
    {
        id: "b-1",
        type: "true_false",
        difficulty: "easy",
        tags: ["runes"],
        question: "`$derived` 的表达式里可以包含副作用，例如直接改另一个状态变量。",
        answer: false,
        explanation: "`$derived` 应保持纯函数语义；需要副作用应使用 `$effect`。",
    },
    {
        id: "b-2",
        type: "fill_blank",
        difficulty: "medium",
        tags: ["props"],
        question: "在 Svelte 5 中，子组件通过 `______` 接收父组件传入的属性。",
        answer: [["$props()", "$props"]],
        explanation: "`let { value } = $props();` 是新的属性声明方式。",
    },
    {
        id: "b-3",
        type: "single_choice",
        difficulty: "medium",
        tags: ["effect"],
        question: "关于 `$effect` 的执行时机，正确的是：",
        options: [
            "在组件首次渲染之前同步执行",
            "在 DOM 更新后异步执行，且会自动收集依赖",
            "每个 tick 固定执行一次，与依赖无关",
            "只能通过 `bind:this` 触发",
        ],
        answer: 1,
        explanation: "`$effect` 在 DOM 更新之后运行（微任务），并自动追踪其中读取的响应式值。",
    },
    {
        id: "b-4",
        type: "subjective",
        difficulty: "hard",
        tags: ["组件通信"],
        question: "简述 Svelte 5 中父组件调用子组件内部方法的主流做法。",
        reference_answer:
            "在子组件里 `export function reset() {...}`，父组件用 `bind:this` 拿到组件实例引用后直接调用；也可以用 callback 属性把动作从父传下去，或在子组件里把方法通过回调暴露。",
        explanation: "要点是「通过 `bind:this` 拿实例 + `export function` 暴露方法」。",
    },
];

function makeBankItem(question: Question, index: number, rand: () => number, now: number): BankItem {
    const createdAt = now - Math.floor(4 + rand() * 55) * DAY;
    const timesSeen = 1 + Math.floor(rand() * 6);
    const timesPassed = Math.max(0, timesSeen - Math.floor(rand() * 3));

    let card = newCardState(createdAt);
    const history: BankAttempt[] = [];
    for (let i = 0; i < timesSeen; i++) {
        const at = Math.min(createdAt + (i + 1) * 3 * DAY, now - 3600_000);
        const percent = [0, 50, 80, 100][Math.floor(rand() * 4)];
        card = scheduleReview(card, percent, at);
        history.push({ at, percent });
    }

    /*
     * 刻意把到期时间岔开：每四项分别落在「已逾期 / 今天到期 / 近期 / 远期」，
     * 否则题库页的到期筛选与「下次复习」文案只有一种状态可看。
     */
    const offsets = [-2 * DAY, 3 * 3600_000, 5 * DAY, 21 * DAY];
    card = { ...card, due: now + offsets[index % offsets.length] };

    return {
        id: questionFingerprint(question),
        question,
        sourceDocId: index % 3 === 0 ? PREVIEW_DOC_ID : "20260915093000-rgother",
        sourceTitle: index % 3 === 0 ? PREVIEW_DOC_TITLE : "TypeScript 泛型笔记",
        createdAt,
        updatedAt: history.length ? history[history.length - 1].at : createdAt,
        card,
        timesSeen,
        timesPassed,
        lastPercent: history.length ? history[history.length - 1].percent : undefined,
        history,
    };
}

export function previewBankItems(): BankItem[] {
    const rand = lcg(0x5eed_1234);
    const now = Date.now();
    const pool = [...previewQuestions, ...extraBankQuestions];
    return pool.map((question, index) => makeBankItem(question, index, rand, now));
}

/* ── 成绩历史（热力图 / 折线 / 环形 / 分布都靠它）───────────────── */

/**
 * 为历史成绩合成一份作答值。
 *
 * 不能只造判分结果：结果页会用 hasAnswer(userAnswer) 区分「答错」与「未答」，
 * 缺了这个字段每道题都会被算成未答（界面显示成「0 错 · 全未答」），
 * 看上去像是结果页的设计出了问题，实际只是种子数据不完整。
 */
function syntheticAnswer(question: Question, score: number, answered: boolean): UserAnswer | undefined {
    if (!answered) return undefined;
    const right = score >= 100;

    switch (question.type) {
        case "single_choice": {
            const next = (question.answer + 1) % question.options.length;
            return { type: "single_choice", value: right ? question.answer : next };
        }
        case "multiple_choice": {
            const picked = right
                ? [...question.answer]
                : question.answer.slice(0, Math.max(1, question.answer.length - 1));
            return { type: "multiple_choice", value: picked };
        }
        case "fill_blank":
            return {
                type: "fill_blank",
                value: question.answer.map((accepted, index) => (right || index > 0 ? (accepted[0] ?? "") : "写错了")),
            };
        case "true_false":
            return { type: "true_false", value: right ? question.answer : !question.answer };
        case "subjective":
            return {
                type: "subjective",
                value: right ? question.reference_answer.slice(0, 60) : "只写了个大概，要点没有覆盖全。",
            };
        case "coding":
            return {
                type: "coding",
                value: right ? question.answer : `${question.language === "python" ? "#" : "//"} 思路对，边界没处理\n`,
            };
    }
}

function makeScoreRecords(): ScoreRecord[] {
    const rand = lcg(0x2026_1008);
    const now = Date.now();
    const records: ScoreRecord[] = [];

    for (let i = 0; i < 46; i++) {
        // 平方分布让近期记录更密集，更像是练习频率在提升
        const daysAgo = Math.floor(rand() ** 1.7 * 118);
        const timestamp = now - daysAgo * DAY - Math.floor(rand() * 9) * 3600_000;
        if (timestamp > now) continue;

        // 越近越熟练，但保留波动，让折线不是一条直线
        const skill = 0.5 + (1 - daysAgo / 118) * 0.4 + (rand() - 0.5) * 0.15;
        const count = 5 + Math.floor(rand() * 6);
        const detail: GradingResult[] = [];
        const questions: Question[] = [];

        for (let k = 0; k < count; k++) {
            const source = previewQuestions[(i + k) % previewQuestions.length];
            questions.push(source);
            // 先决定有没有作答，再决定得分：两者独立，才会出现「答错」而不是清一色「未答」
            const answered = rand() > 0.18;
            const roll = rand();
            const score = !answered
                ? 0
                : roll > 0.72
                  ? 100
                  : roll > 0.45
                    ? Math.round(60 * skill + rand() * 30)
                    : Math.round(40 * skill);
            const objective = !["subjective", "coding"].includes(source.type);

            detail.push({
                questionId: `${source.id}#${i}-${k}`,
                type: source.type,
                method: objective ? "local" : "ai",
                correct: objective ? score >= 100 : null,
                score,
                maxScore: 100,
                userAnswer: syntheticAnswer(source, score, answered),
                seconds: answered ? Math.round(20 + rand() * 180) : 6,
            });
        }

        records.push({
            id: `preview-score-${String(i).padStart(3, "0")}`,
            quizId: `preview-quiz-${i}`,
            title: i === 0 ? "Svelte 5 响应式系统 · 第 11 次" : `练习 #${46 - i}`,
            timestamp,
            totalScore: detail.reduce((sum, r) => sum + r.score, 0),
            maxScore: detail.length * 100,
            questionCount: detail.length,
            detail,
            questions,
            sourceDocId: i % 3 === 0 ? PREVIEW_DOC_ID : "20260915093000-rgother",
            sourceTitle: i % 3 === 0 ? PREVIEW_DOC_TITLE : "TypeScript 泛型笔记",
            duration: detail.reduce((sum, r) => sum + (r.seconds ?? 0), 0),
            analysis: i === 0 ? previewAnalysis : undefined,
        });
    }

    return records.sort((a, b) => b.timestamp - a.timestamp);
}

export const previewScoreRecords: ScoreRecord[] = makeScoreRecords();
export const previewScoreIndex: ScoreIndexEntry[] = previewScoreRecords.map(buildIndexEntry);

/** 结果页预览用：带薄弱点分析的那次成绩（分析文本只在它上面） */
export const previewLatestRecord: ScoreRecord =
    previewScoreRecords.find((record) => record.analysis) ?? previewScoreRecords[0];

/* ── 失败态 ────────────────────────────────────────────────────── */

/**
 * 模型输出被截断时的诊断信息（与真实解析失败的形状一致）。
 * 样例里刻意不出现反引号：这段是嵌在模板字符串里的 JSON 片段，
 * 混进反引号既容易看错转义、也会让编辑器的语法高亮与体检脚本误判。
 */
export const previewTruncatedError = {
    title: "模型输出解析失败",
    detail: "AI 输出被截断：JSON 在字符串中途结束",
    hint: "可以调大该模型的 Max Tokens 后重试，或减少本次题量让每批更小。",
    raw:
        '{"questions":[{"id":"q-1","type":"single_choice","difficulty":"easy",' +
        '"question":"关于 Svelte 5 的 $state，下列说法正确的是？",' +
        '"options":["它只能用于组件顶层","对象/数组用 $state 声明后，对其属性的读写在模板与副作用中都会被追踪",' +
        '"它返回的是一个只读快照","它在服务端渲染时不可用"],"answer":1,' +
        '"explanation":"$state 会返回一个响应式代理，深层属性的读写都会被追踪。"},' +
        '{"id":"q-2","type":"multiple_choice","difficulty":"medium",' +
        '"question":"下列哪些是 Svelte 5 中真正存在的 rune？（多选）",' +
        '"options":["$state","$derived","$effect","$props","$watc',
};

/** 配置不完整时的拦截信息 */
export const previewConfigError = {
    title: "AI 配置不完整",
    detail: "生成模型未选择",
    hint: "在设置 → AI 中为「出题」角色选择模型后重试。",
};
