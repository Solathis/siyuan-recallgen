import { describe, expect, it } from "vitest";
import { AIError } from "@/lib/ai/client";
import { __resetFetchSyncPost, __setFetchSyncPost } from "@/test/siyuan-stub";
import { getDefaultConfig } from "@/types/config";
import type { Question, QuestionType } from "@/types/quiz";
import {
    coerceQuestion,
    collectFailedReviews,
    generateQuestions,
    toTags,
    validateQuestions,
    type GenStats,
} from "./generator";

const ALL: QuestionType[] = ["single_choice", "multiple_choice", "fill_blank", "true_false", "subjective", "coding"];

const reason = (input: unknown, types: QuestionType[] = ALL) => {
    const r = coerceQuestion(input, "q-1", types);
    return r.ok ? "" : r.reason;
};

describe("coerceQuestion - 题干与题型", () => {
    it("接受完整的单选题", () => {
        const r = coerceQuestion(
            { type: "single_choice", difficulty: "easy", question: "1+1=?", options: ["1", "2"], answer: 1 },
            "q-1",
            ALL
        );
        expect(r.ok).toBe(true);
        expect(r.question).toMatchObject({ type: "single_choice", answer: 1, id: "q-1" });
    });

    it("拒绝未启用的题型", () => {
        const r = coerceQuestion({ type: "coding", question: "写代码" }, "q-1", ["single_choice"]);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/未启用/);
    });

    it("拒绝空题干", () => {
        expect(reason({ type: "true_false", question: "   ", answer: true })).toMatch(/题干为空/);
        expect(reason({ type: "true_false", answer: true })).toMatch(/题干为空/);
    });

    it("拒绝非对象输入", () => {
        expect(reason(null)).toMatch(/不是对象/);
        expect(reason("文本")).toMatch(/不是对象/);
        expect(reason([])).toMatch(/不是对象/);
    });

    it("难度缺失或非法时回落为 medium", () => {
        const r = coerceQuestion({ type: "true_false", question: "x", answer: true, difficulty: "很难" }, "q-1", ALL);
        expect(r.question?.difficulty).toBe("medium");
    });

    it("难度大小写不敏感", () => {
        const r = coerceQuestion({ type: "true_false", question: "x", answer: true, difficulty: "HARD" }, "q-1", ALL);
        expect(r.question?.difficulty).toBe("hard");
    });
});

describe("coerceQuestion - 单选题索引边界", () => {
    it("字母答案被转换为索引", () => {
        const r = coerceQuestion(
            { type: "single_choice", question: "x", options: ["a", "b", "c"], answer: "B" },
            "q-1",
            ALL
        );
        expect(r.question).toMatchObject({ answer: 1 });
    });

    it("拒绝越界索引（曾导致用户永远答不对）", () => {
        expect(reason({ type: "single_choice", question: "x", options: ["a", "b"], answer: 5 })).toMatch(/索引不合法/);
    });

    it("拒绝负数索引", () => {
        expect(reason({ type: "single_choice", question: "x", options: ["a", "b"], answer: -1 })).toMatch(/索引不合法/);
    });

    it("拒绝选项不足两个", () => {
        expect(reason({ type: "single_choice", question: "x", options: ["a"], answer: 0 })).toMatch(/索引不合法/);
    });

    it("拒绝答案缺失", () => {
        expect(reason({ type: "single_choice", question: "x", options: ["a", "b"] })).toMatch(/索引不合法/);
    });
});

describe("coerceQuestion - 多选题索引边界", () => {
    it("去重并排序答案索引", () => {
        const r = coerceQuestion(
            { type: "multiple_choice", question: "x", options: ["a", "b", "c"], answer: [2, 0, 2] },
            "q-1",
            ALL
        );
        expect(r.question).toMatchObject({ answer: [0, 2] });
    });

    it("拒绝任一越界索引", () => {
        expect(reason({ type: "multiple_choice", question: "x", options: ["a", "b"], answer: [0, 7] })).toMatch(
            /索引不合法/
        );
    });

    it("拒绝负数索引", () => {
        expect(reason({ type: "multiple_choice", question: "x", options: ["a", "b"], answer: [-1] })).toMatch(
            /索引不合法/
        );
    });

    it("拒绝空答案", () => {
        expect(reason({ type: "multiple_choice", question: "x", options: ["a", "b"], answer: [] })).toMatch(
            /索引不合法/
        );
    });

    it("接受字母数组答案", () => {
        const r = coerceQuestion(
            { type: "multiple_choice", question: "x", options: ["a", "b", "c"], answer: ["A", "C"] },
            "q-1",
            ALL
        );
        expect(r.question).toMatchObject({ answer: [0, 2] });
    });
});

describe("coerceQuestion - 填空题", () => {
    it("接受二维答案数组", () => {
        const r = coerceQuestion({ type: "fill_blank", question: "x", answer: [["巴黎", "Paris"]] }, "q-1", ALL);
        expect(r.question).toMatchObject({ answer: [["巴黎", "Paris"]] });
    });

    it("把一维答案包成二维", () => {
        const r = coerceQuestion({ type: "fill_blank", question: "x", answer: ["甲", "乙"] }, "q-1", ALL);
        expect(r.question).toMatchObject({ answer: [["甲"], ["乙"]] });
    });

    it("拒绝空答案", () => {
        expect(reason({ type: "fill_blank", question: "x", answer: [] })).toMatch(/答案缺失/);
        expect(reason({ type: "fill_blank", question: "x" })).toMatch(/答案缺失/);
    });

    it("拒绝某一空的可接受答案为空的题目", () => {
        expect(reason({ type: "fill_blank", question: "x", answer: [["a"], []] })).toMatch(/答案缺失/);
    });
});

describe("coerceQuestion - 判断题", () => {
    it("接受布尔答案", () => {
        expect(coerceQuestion({ type: "true_false", question: "x", answer: false }, "q-1", ALL).question).toMatchObject(
            { answer: false }
        );
    });

    it("接受中英文与数字字符串答案", () => {
        const cases: Array<[unknown, boolean]> = [
            ["true", true],
            ["正确", true],
            ["对", true],
            ["1", true],
            ["false", false],
            ["错误", false],
            ["错", false],
            ["0", false],
            [1, true],
            [0, false],
        ];
        for (const [input, expected] of cases) {
            const r = coerceQuestion({ type: "true_false", question: "x", answer: input }, "q-1", ALL);
            expect(r.ok, `answer=${JSON.stringify(input)}`).toBe(true);
            expect((r.question as { answer: boolean }).answer, `answer=${JSON.stringify(input)}`).toBe(expected);
        }
    });

    it("拒绝无法识别的答案", () => {
        expect(reason({ type: "true_false", question: "x", answer: "也许" })).toMatch(/不是布尔值/);
    });
});

describe("coerceQuestion - 主观题与编程题", () => {
    it("主观题需要参考答案", () => {
        expect(reason({ type: "subjective", question: "x" })).toMatch(/缺少参考答案/);
        expect(reason({ type: "subjective", question: "x", reference_answer: "  " })).toMatch(/缺少参考答案/);
    });

    it("编程题接受参考答案", () => {
        const r = coerceQuestion({ type: "coding", question: "x", language: "python", answer: "print(1)" }, "q-1", ALL);
        expect(r.question).toMatchObject({ language: "python", answer: "print(1)" });
    });

    it("编程题仅有测试用例时也接受", () => {
        const r = coerceQuestion(
            { type: "coding", question: "x", test_cases: [{ input: "1", expected: "2" }] },
            "q-1",
            ALL
        );
        expect(r.ok).toBe(true);
    });

    it("编程题既无参考答案也无测试用例时拒绝", () => {
        expect(reason({ type: "coding", question: "x", answer: "" })).toMatch(/缺少参考答案与测试用例/);
    });

    it("编程题语言缺省为 python", () => {
        const r = coerceQuestion({ type: "coding", question: "x", answer: "a" }, "q-1", ALL);
        expect(r.question).toMatchObject({ language: "python" });
    });
});

describe("validateQuestions - 容错而不是整批作废", () => {
    it("丢弃不合格题目并保留其余的", () => {
        const raw = [
            { type: "true_false", question: "好的", answer: true },
            { type: "single_choice", question: "坏的", options: ["a", "b"], answer: 9 },
            { type: "subjective", question: "好的2", reference_answer: "参考答案" },
        ];
        const questions = validateQuestions(raw, ALL);
        expect(questions).toHaveLength(2);
    });

    it("跳过项通过回调上报原因", () => {
        const reasons: string[] = [];
        validateQuestions(
            [
                { type: "true_false", question: "好的", answer: true },
                { type: "single_choice", question: "坏的", options: ["a", "b"], answer: 9 },
            ],
            ALL,
            (r) => reasons.push(r)
        );
        expect(reasons).toHaveLength(1);
        expect(reasons[0]).toMatch(/索引不合法/);
    });

    it("丢弃后重新按 q-1..q-n 连续编号", () => {
        const raw = [
            { type: "true_false", question: "a", answer: true },
            { type: "single_choice", question: "坏的", options: ["a", "b"], answer: 9 },
            { type: "true_false", question: "b", answer: false },
            { type: "true_false", question: "c", answer: true },
        ];
        const ids = validateQuestions(raw, ALL).map((q) => q.id);
        expect(ids).toEqual(["q-1", "q-2", "q-3"]);
    });

    it("全部不合格时抛错，并带上前几条原因", () => {
        const raw = [
            { type: "single_choice", question: "a", options: ["x"], answer: 0 },
            { type: "fill_blank", question: "b", answer: [] },
        ];
        expect(() => validateQuestions(raw, ALL)).toThrow(/全部校验失败/);
    });

    it("空数组同样抛错", () => {
        expect(() => validateQuestions([], ALL)).toThrow(/数组为空/);
    });

    it("抛出的错误归类为错误信息可供上层展示", () => {
        try {
            validateQuestions([{ type: "unknown_type", question: "a" }], ALL);
            throw new Error("应当抛错");
        } catch (e) {
            expect(e).toBeInstanceOf(AIError);
        }
    });

    it("接受全部 6 种题型的混合批次", () => {
        const raw = [
            { type: "single_choice", question: "a", options: ["1", "2"], answer: 0 },
            { type: "multiple_choice", question: "b", options: ["1", "2"], answer: [0, 1] },
            { type: "fill_blank", question: "c", answer: [["x"]] },
            { type: "true_false", question: "d", answer: true },
            { type: "subjective", question: "e", reference_answer: "要点" },
            { type: "coding", question: "f", answer: "print(1)" },
        ];
        const questions: Question[] = validateQuestions(raw, ALL);
        expect(questions.map((q) => q.type)).toEqual([
            "single_choice",
            "multiple_choice",
            "fill_blank",
            "true_false",
            "subjective",
            "coding",
        ]);
    });
});

describe("toTags - 知识点标签归一化", () => {
    it("保留有效标签", () => {
        expect(toTags(["二叉树遍历", "递归"])).toEqual(["二叉树遍历", "递归"]);
    });

    it("去首尾空白并折叠内部空白", () => {
        expect(toTags(["  HTTP   缓存  "])).toEqual(["HTTP 缓存"]);
    });

    it("按大小写不敏感去重并保留首次出现的写法", () => {
        expect(toTags(["HTTP", "http", "Http"])).toEqual(["HTTP"]);
    });

    it("最多保留 3 个标签", () => {
        expect(toTags(["a", "b", "c", "d", "e"])).toHaveLength(3);
    });

    it("单个标签超长时截断", () => {
        const tag = toTags(["长".repeat(50)])![0];
        expect(tag.length).toBe(24);
    });

    it("过滤空串与非字符串非数字项", () => {
        expect(toTags(["", "  ", null, {}, true, "有效"])).toEqual(["有效"]);
    });

    it("全部无效时返回 undefined 而不是空数组", () => {
        expect(toTags([])).toBeUndefined();
        expect(toTags(["", "   "])).toBeUndefined();
    });

    it("非数组返回 undefined", () => {
        expect(toTags("标签")).toBeUndefined();
        expect(toTags(undefined)).toBeUndefined();
        expect(toTags(null)).toBeUndefined();
    });

    it("数字标签被转成字符串", () => {
        expect(toTags([42])).toEqual(["42"]);
    });

    it("题库题目携带归一化后的标签", () => {
        const result = coerceQuestion(
            { type: "true_false", question: "x", answer: true, tags: [" A ", "a", "B"] },
            "q-1",
            ALL
        );
        expect(result.question?.tags).toEqual(["A", "B"]);
    });

    it("没有标签时 tags 为 undefined，不写空数组", () => {
        const result = coerceQuestion({ type: "true_false", question: "x", answer: true }, "q-1", ALL);
        expect(result.question?.tags).toBeUndefined();
    });
});

describe("collectFailedReviews", () => {
    it("挑出未通过的题目并保留原因", () => {
        const result = collectFailedReviews(
            [
                { index: 0, passed: true },
                { index: 1, passed: false, reason: "答案有误" },
                { index: 2, passed: false },
            ],
            3
        );
        expect(result.indices).toEqual([1, 2]);
        expect(result.reasons[0]).toBe("答案有误");
        expect(result.reasons[1]).toBe("未通过审核");
    });

    it("忽略 null / 非对象元素（回归：曾直接读 r.passed 抛异常）", () => {
        expect(() => collectFailedReviews([null, undefined, 42, "x", { index: 0, passed: false }], 1)).not.toThrow();
        expect(collectFailedReviews([null, undefined, 42, "x", { index: 0, passed: false }], 1).indices).toEqual([0]);
    });

    it("丢掉小数与越界下标（回归：index=1.5 会取到 undefined 后崩溃）", () => {
        const result = collectFailedReviews(
            [
                { index: 1.5, passed: false },
                { index: -1, passed: false },
                { index: 9, passed: false },
                { index: "1", passed: false },
                { index: NaN, passed: false },
            ],
            3
        );
        expect(result.indices).toEqual([]);
    });

    it("同一题被报多次时只取一次", () => {
        const result = collectFailedReviews(
            [
                { index: 1, passed: false, reason: "第一次" },
                { index: 1, passed: false, reason: "第二次" },
            ],
            3
        );
        expect(result.indices).toEqual([1]);
        expect(result.reasons).toEqual(["第一次"]);
    });

    it("原因不是字符串时回落到默认文案", () => {
        const result = collectFailedReviews([{ index: 0, passed: false, reason: 42 }], 1);
        expect(result.reasons).toEqual(["未通过审核"]);
    });

    it("空数组与空题库都安全", () => {
        expect(collectFailedReviews([], 0)).toEqual({ indices: [], reasons: [] });
        expect(collectFailedReviews([{ index: 0, passed: false }], 0)).toEqual({ indices: [], reasons: [] });
    });
});

describe("generateQuestions 的取消", () => {
    it("调用前已取消则不发任何请求", async () => {
        let calls = 0;
        __setFetchSyncPost(() => {
            calls++;
            return {
                code: 0,
                msg: "",
                data: { body: "{}", status: 200, contentType: "", headers: null, elapsed: 1, url: "" },
            };
        });
        const ctrl = new AbortController();
        ctrl.abort();
        await expect(generateQuestions(getDefaultConfig(), "笔记内容", undefined, ctrl.signal)).rejects.toMatchObject({
            kind: "aborted",
        });
        expect(calls).toBe(0);
        __resetFetchSyncPost();
    });

    it("取消后不再发起后续批次（题量需要分批时）", async () => {
        const config = getDefaultConfig();
        // 30 题会拆成多批
        config.general.difficulty = { total: 30, easy: 10, medium: 10, hard: 10 };
        const ctrl = new AbortController();
        let calls = 0;
        __setFetchSyncPost(() => {
            calls++;
            ctrl.abort(); // 第一批在途时用户点了取消
            return {
                code: 0,
                msg: "",
                data: { body: "{}", status: 200, contentType: "", headers: null, elapsed: 1, url: "" },
            };
        });
        await expect(generateQuestions(config, "笔记内容", undefined, ctrl.signal)).rejects.toMatchObject({
            kind: "aborted",
        });
        expect(calls).toBe(1);
        __resetFetchSyncPost();
    });
});

describe("模型少给题时的补齐", () => {
    /** 构造 forwardProxy 成功响应（chat 协议：正文在 choices[0].message.content 里） */
    const proxyBody = (content: string) => ({
        code: 0,
        msg: "",
        data: {
            body: JSON.stringify({
                choices: [{ message: { content }, finish_reason: "stop" }],
            }),
            status: 200,
            contentType: "application/json",
            headers: null,
            elapsed: 1,
            url: "",
        },
    });
    const reply = (questions: unknown[]) => proxyBody(JSON.stringify({ questions }));
    const q = (n: number) => ({ type: "true_false", difficulty: "easy", question: `第 ${n} 题`, answer: true });

    /** 只测补齐，不触发审题循环 */
    const configWith = (total: number) => {
        const config = getDefaultConfig();
        config.general.difficulty = { total, easy: total, medium: 0, hard: 0 };
        config.ai.roles.reviewer = "";
        return config;
    };

    it("少给题时按差额再要一轮，最终题量贴近请求数", async () => {
        const calls: number[] = [];
        __setFetchSyncPost(() => {
            calls.push(calls.length + 1);
            // 第一次只给 2 题，补题时给满差额
            return calls.length === 1 ? reply([q(1), q(2)]) : reply([q(3)]);
        });
        const questions = await generateQuestions(configWith(3), "笔记内容");
        expect(calls).toHaveLength(2);
        expect(questions).toHaveLength(3);
        __resetFetchSyncPost();
    });

    it("给足题量时不会多发请求", async () => {
        const calls: number[] = [];
        __setFetchSyncPost(() => {
            calls.push(calls.length + 1);
            return reply([q(1), q(2), q(3)]);
        });
        const questions = await generateQuestions(configWith(3), "笔记内容");
        expect(calls).toHaveLength(1);
        expect(questions).toHaveLength(3);
        __resetFetchSyncPost();
    });

    it("补题失败不会作废已经拿到的题目", async () => {
        const calls: number[] = [];
        __setFetchSyncPost(() => {
            calls.push(calls.length + 1);
            return calls.length === 1 ? reply([q(1), q(2)]) : proxyBody("这不是 JSON");
        });
        const questions = await generateQuestions(configWith(3), "笔记内容");
        expect(calls.length).toBeGreaterThanOrEqual(2);
        // 已有的 2 题必须保留
        expect(questions).toHaveLength(2);
        __resetFetchSyncPost();
    });

    it("补题只补一轮，不会因模型持续少给而反复请求", async () => {
        const calls: number[] = [];
        __setFetchSyncPost(() => {
            calls.push(calls.length + 1);
            // 每次都只给 1 题
            return reply([q(calls.length)]);
        });
        const questions = await generateQuestions(configWith(5), "笔记内容");
        // 首批（可能多批）+ 一轮补题；不可能是无限循环
        expect(calls.length).toBeLessThanOrEqual(4);
        expect(questions.length).toBeGreaterThanOrEqual(1);
        __resetFetchSyncPost();
    });
});

describe("补齐时的进度文案", () => {
    it("单批的首次生成显示「正在生成」，不显示补题文案", async () => {
        const config = getDefaultConfig();
        config.general.difficulty = { total: 2, easy: 2, medium: 0, hard: 0 };
        config.ai.roles.reviewer = "";
        const labels: string[] = [];
        __setFetchSyncPost(() => ({
            code: 0,
            msg: "",
            data: {
                body: JSON.stringify({
                    choices: [
                        {
                            message: {
                                content: JSON.stringify({
                                    questions: [
                                        { type: "true_false", difficulty: "easy", question: "甲", answer: true },
                                        { type: "true_false", difficulty: "easy", question: "乙", answer: true },
                                    ],
                                }),
                            },
                            finish_reason: "stop",
                        },
                    ],
                }),
                status: 200,
                contentType: "application/json",
                headers: null,
                elapsed: 1,
                url: "",
            },
        }));
        await generateQuestions(config, "笔记", (_phase, _round, detail) => labels.push(detail));
        expect(labels.some((l) => l.includes("补齐"))).toBe(false);
        expect(labels.some((l) => l.includes("生成"))).toBe(true);
        __resetFetchSyncPost();
    });
});

describe("返回形状与截断的诊断", () => {
    const proxyBody = (content: string, finish = "stop") => ({
        code: 0,
        msg: "",
        data: {
            body: JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }),
            status: 200,
            contentType: "application/json",
            headers: null,
            elapsed: 1,
            url: "",
        },
    });
    const q = (n: number) => ({ type: "true_false", difficulty: "easy", question: `第 ${n} 题`, answer: true });
    const oneQuestion = () => {
        const config = getDefaultConfig();
        config.general.difficulty = { total: 1, easy: 1, medium: 0, hard: 0 };
        config.general.allowedTypes = ["true_false"];
        config.ai.roles.reviewer = "";
        return config;
    };
    /** 捕获 reject 的错误对象，便于断言 kind / raw / message；没抛错就直接失败 */
    const failure = async (config: ReturnType<typeof getDefaultConfig>): Promise<AIError> => {
        const err = await generateQuestions(config, "笔记内容").then(
            () => null,
            (e: unknown) => e
        );
        expect(err, "本该抛出解析错误，实际却成功了").toBeInstanceOf(AIError);
        return err as AIError;
    };

    it("被截断的输出报「输出被截断」，并带上模型原文（而不是一句缺少 questions）", async () => {
        const truncated = '{"questions":[{"type":"true_false","difficulty":"easy","question":"第 1 题';
        __setFetchSyncPost(() => proxyBody(truncated));
        const err = await failure(oneQuestion());
        expect(err).toBeInstanceOf(AIError);
        expect(err.kind).toBe("truncated");
        expect(err.message).toMatch(/截断/);
        expect(err.raw).toContain('"questions"');
        __resetFetchSyncPost();
    });

    it("形状确实不对时，错误里列出顶层字段名并附原文", async () => {
        __setFetchSyncPost(() => proxyBody(JSON.stringify({ summary: "好的", meta: 1 })));
        const err = await failure(oneQuestion());
        expect(err.kind).toBe("parse");
        expect(err.message).toContain("summary");
        expect(err.message).toContain("meta");
        expect(err.raw).toContain("summary");
        __resetFetchSyncPost();
    });

    it("截断后只剩残缺对象时不再误报成「形状不对」", async () => {
        // `{"questions":` 会被 jsonrepair 修成 {questions:null}：这属于截断，不是形状问题
        __setFetchSyncPost(() => proxyBody('{"questions":'));
        const err = await failure(oneQuestion());
        expect(err.kind).toBe("truncated");
        __resetFetchSyncPost();
    });

    it("题目放在 data / items / 中文键下也能正常出题", async () => {
        for (const key of ["data", "items", "list", "result", "题目", "题目列表"]) {
            __setFetchSyncPost(() => proxyBody(JSON.stringify({ [key]: [q(1)] })));
            const questions = await generateQuestions(oneQuestion(), "笔记内容");
            expect(questions, `键 ${key}`).toHaveLength(1);
        }
        __resetFetchSyncPost();
    });

    it("整条回复就是一道题时也能出题", async () => {
        __setFetchSyncPost(() => proxyBody(JSON.stringify(q(1))));
        const questions = await generateQuestions(oneQuestion(), "笔记内容");
        expect(questions).toHaveLength(1);
        __resetFetchSyncPost();
    });

    it("数组被多包一层（result.quiz.questions）也能出题", async () => {
        __setFetchSyncPost(() => proxyBody(JSON.stringify({ result: { quiz: { questions: [q(1)] } } })));
        const questions = await generateQuestions(oneQuestion(), "笔记内容");
        expect(questions).toHaveLength(1);
        __resetFetchSyncPost();
    });

    it("重做不合格题时同样接受别名键（原先只认 questions，会静默放弃重做）", async () => {
        const config = oneQuestion();
        // 让审题循环真的跑起来：把审题者指向同一个存在的模型
        config.ai.roles.reviewer = config.ai.roles.generator;
        const original = { ...q(1), question: "原题" };
        const redone = { ...q(1), question: "重做后的题" };
        let call = 0;
        __setFetchSyncPost(() => {
            call++;
            if (call === 1) return proxyBody(JSON.stringify({ questions: [original] }));
            if (call === 2)
                return proxyBody(JSON.stringify({ reviews: [{ index: 0, passed: false, reason: "太简单" }] }));
            if (call === 3) return proxyBody(JSON.stringify({ data: [redone] })); // 别名键
            return proxyBody(JSON.stringify({ reviews: [{ index: 0, passed: true }] }));
        });
        const questions = await generateQuestions(config, "笔记内容");
        expect(call).toBe(4);
        expect(questions[0].question).toBe("重做后的题");
        __resetFetchSyncPost();
    });
});

describe("生成进度快照", () => {
    const q = (n: number) => ({ type: "true_false", difficulty: "easy", question: `第 ${n} 题`, answer: true });
    const reply = (questions: unknown[]) => ({
        code: 0,
        msg: "",
        data: {
            body: JSON.stringify({
                choices: [{ message: { content: JSON.stringify({ questions }) }, finish_reason: "stop" }],
            }),
            status: 200,
            contentType: "application/json",
            headers: null,
            elapsed: 1,
            url: "",
        },
    });

    it("每批开始时推送快照：目标题量、已收集、批次序号", async () => {
        const config = getDefaultConfig();
        // 30 题超过单次上限，会被拆成多批
        config.general.difficulty = { total: 30, easy: 30, medium: 0, hard: 0 };
        config.general.allowedTypes = ["true_false"];
        config.ai.roles.reviewer = "";
        __setFetchSyncPost(() => reply([q(1)]));
        const snapshots: GenStats[] = [];
        await generateQuestions(config, "笔记内容", (_phase, _round, _detail, stats) => {
            if (stats) snapshots.push({ ...stats });
        });
        expect(snapshots.length).toBeGreaterThan(0);
        expect(snapshots[0]).toMatchObject({ phase: "generating", target: 30, collected: 0, batch: 1 });
        expect(snapshots[0].batches).toBeGreaterThan(1);
        // 收集数必须随批次推进而增长
        expect(Math.max(...snapshots.map((s) => s.collected))).toBeGreaterThan(0);
        __resetFetchSyncPost();
    });

    it("丢弃不合格题目会体现在快照里", async () => {
        const config = getDefaultConfig();
        config.general.difficulty = { total: 1, easy: 1, medium: 0, hard: 0 };
        config.general.allowedTypes = ["true_false"];
        config.ai.roles.reviewer = "";
        // 一题没题干、一题类型未启用：都会被丢弃
        __setFetchSyncPost(() =>
            reply([{ type: "true_false", difficulty: "easy", question: "" }, q(2), { type: "coding", question: "x" }])
        );
        const snapshots: GenStats[] = [];
        await generateQuestions(config, "笔记内容", (_p, _r, _d, stats) => {
            if (stats) snapshots.push({ ...stats });
        });
        expect(Math.max(...snapshots.map((s) => s.dropped))).toBeGreaterThanOrEqual(1);
        __resetFetchSyncPost();
    });
});

describe("分批生成的并发度", () => {
    const q = (n: number) => ({ type: "true_false", difficulty: "easy", question: `第 ${n} 题`, answer: true });
    const reply = (questions: unknown[]) => ({
        code: 0,
        msg: "",
        data: {
            body: JSON.stringify({
                choices: [{ message: { content: JSON.stringify({ questions }) }, finish_reason: "stop" }],
            }),
            status: 200,
            contentType: "application/json",
            headers: null,
            elapsed: 1,
            url: "",
        },
    });
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    /** 30 题会拆成 3 批；每批都给 1 题，于是还有一轮补题 */
    const config30 = () => {
        const config = getDefaultConfig();
        config.general.difficulty = { total: 30, easy: 30, medium: 0, hard: 0 };
        config.general.allowedTypes = ["true_false"];
        config.ai.roles.reviewer = "";
        return config;
    };

    it("多批同时发出：总耗时接近单批，而不是各批之和", { timeout: 30_000 }, async () => {
        const PER_CALL_MS = 120;
        let inFlight = 0;
        let maxInFlight = 0;
        let calls = 0;
        __setFetchSyncPost(async () => {
            calls++;
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await delay(PER_CALL_MS);
            inFlight--;
            return reply([q(calls)]);
        });

        const started = Date.now();
        const questions = await generateQuestions(config30(), "笔记内容");
        const elapsed = Date.now() - started;
        __resetFetchSyncPost();

        expect(calls).toBeGreaterThanOrEqual(3);
        // 串行时总耗时 ≈ 调用数 × 单次耗时；并发后应明显更短
        expect(maxInFlight, "应有多批同时在飞").toBeGreaterThan(1);
        expect(elapsed).toBeLessThan(PER_CALL_MS * calls * 0.75);
        expect(questions.length).toBeGreaterThan(0);
    });

    it("并发完成后题目顺序仍与规划一致（保序合并）", { timeout: 30_000 }, async () => {
        // 让后发的批次先返回，检验是否按槽位而不是按完成顺序合并
        const answers = new Map<number, number>();
        let calls = 0;
        __setFetchSyncPost(async () => {
            calls++;
            const mine = calls;
            // 第 1 批最慢、第 3 批最快
            await delay(mine === 1 ? 120 : mine === 2 ? 60 : 10);
            return reply([{ ...q(mine), question: `批 ${mine} 的题` }]);
        });
        const config = config30();
        // 只保留首次生成，避免补题轮干扰顺序断言
        config.general.difficulty = { total: 24, easy: 24, medium: 0, hard: 0 };
        const questions = await generateQuestions(config, "笔记内容");
        __resetFetchSyncPost();
        void answers;

        const texts = questions.map((x) => x.question);
        expect(texts[0]).toBe("批 1 的题");
        // 首批的题必须排在第二批之前，即使它更晚返回
        if (texts.length > 1) expect(texts[1]).toBe("批 2 的题");
    });
});
