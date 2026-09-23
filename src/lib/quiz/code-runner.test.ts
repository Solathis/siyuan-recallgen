import { describe, expect, it } from "vitest";
import type { Question, TestCase } from "@/types/quiz";
import {
    buildRunnerSource,
    evaluateCases,
    inferEntryPoint,
    isRunSupported,
    isValidIdentifier,
    isRunnableLanguage,
    looseEqual,
    normalizeExpected,
    resolveEntryPoint,
    runCodingTests,
} from "./code-runner";

const coding = (over: Partial<Question> = {}): Question =>
    ({
        id: "q-1",
        type: "coding",
        difficulty: "medium",
        question: "实现 add",
        language: "javascript",
        answer: "",
        ...over,
    }) as Question;

const testCase = (over: Partial<TestCase> = {}): TestCase => ({ expected: "1", ...over });

describe("isRunnableLanguage", () => {
    it("JavaScript 的各种写法都可执行", () => {
        for (const language of ["javascript", "JavaScript", " js ", "node", "ECMAScript"]) {
            expect(isRunnableLanguage(language)).toBe(true);
        }
    });

    it("其他语言不可执行", () => {
        for (const language of ["python", "go", "rust", "java", ""]) {
            expect(isRunnableLanguage(language)).toBe(false);
        }
    });

    it("空值不抛错", () => {
        expect(isRunnableLanguage(undefined as unknown as string)).toBe(false);
    });
});

describe("inferEntryPoint", () => {
    it("识别函数声明", () => {
        expect(inferEntryPoint("function add(a, b) { return a + b; }")).toBe("add");
        expect(inferEntryPoint("async function load() {}")).toBe("load");
    });

    it("识别常量箭头函数与函数表达式", () => {
        expect(inferEntryPoint("const add = (a, b) => a + b;")).toBe("add");
        expect(inferEntryPoint("let solve = function (n) { return n; };")).toBe("solve");
    });

    it("识别下划线、美元与数字组成的名字", () => {
        expect(inferEntryPoint("function _run2$() {}")).toBe("_run2$");
    });

    it("没有函数时返回 null", () => {
        expect(inferEntryPoint("const x = 1;")).toBeNull();
        expect(inferEntryPoint("")).toBeNull();
    });
});

describe("resolveEntryPoint", () => {
    it("优先使用题目显式给出的入口函数名", () => {
        expect(resolveEntryPoint(coding({ entry_point: "solve", starter_code: "function other() {}" } as never))).toBe(
            "solve"
        );
    });

    it("显式字段为空或只有空白时回落到推断", () => {
        expect(resolveEntryPoint(coding({ entry_point: "   ", starter_code: "function add() {}" } as never))).toBe(
            "add"
        );
    });

    it("没有初始代码时从参考答案推断", () => {
        expect(resolveEntryPoint(coding({ answer: "function fromAnswer() {}" } as never))).toBe("fromAnswer");
    });

    it("非编程题返回 null", () => {
        expect(
            resolveEntryPoint({
                id: "q",
                type: "true_false",
                difficulty: "easy",
                question: "?",
                answer: true,
            } as Question)
        ).toBeNull();
    });
});

describe("normalizeExpected", () => {
    it("能解析成 JSON 的按 JSON 处理", () => {
        expect(normalizeExpected("42")).toBe(42);
        expect(normalizeExpected("true")).toBe(true);
        expect(normalizeExpected('{"a":1}')).toEqual({ a: 1 });
        expect(normalizeExpected("[1,2]")).toEqual([1, 2]);
    });

    it("非 JSON 文本按字符串处理并去掉首尾空白", () => {
        expect(normalizeExpected("  hello ")).toBe("hello");
    });

    it("空串返回空串", () => {
        expect(normalizeExpected("")).toBe("");
        expect(normalizeExpected("   ")).toBe("");
    });

    it("非字符串原样返回", () => {
        expect(normalizeExpected(7)).toBe(7);
    });
});

describe("looseEqual", () => {
    it("数字容忍浮点误差", () => {
        expect(looseEqual(0.1 + 0.2, 0.3)).toBe(true);
        expect(looseEqual(1, 2)).toBe(false);
    });

    it("NaN 与 NaN 视为相等", () => {
        expect(looseEqual(Number.NaN, Number.NaN)).toBe(true);
    });

    it("字符串忽略首尾空白", () => {
        expect(looseEqual(" abc ", "abc")).toBe(true);
    });

    it("数组按元素递归比较", () => {
        expect(looseEqual([1, 2, 3], [1, 2, 3])).toBe(true);
        expect(looseEqual([1, 2], [1, 2, 3])).toBe(false);
        expect(looseEqual([[1], [2]], [[1], [2]])).toBe(true);
    });

    it("数组顺序敏感", () => {
        expect(looseEqual([1, 2], [2, 1])).toBe(false);
    });

    it("对象按键递归比较", () => {
        expect(looseEqual({ a: 1, b: " x " }, { a: 1, b: "x" })).toBe(true);
        expect(looseEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
        expect(looseEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    });

    it("类型不同时不相等（数字与字符串不互相转换）", () => {
        expect(looseEqual(1, "1")).toBe(false);
        expect(looseEqual(true, 1)).toBe(false);
    });

    it("null 与 undefined 只在同为 null 时相等", () => {
        expect(looseEqual(null, null)).toBe(true);
        expect(looseEqual(null, undefined)).toBe(false);
    });
});

describe("buildRunnerSource", () => {
    it("内联代码、入口函数名与参数", () => {
        const source = buildRunnerSource("function add(a,b){return a+b}", "add", [
            testCase({ args: [1, 2], expected: "3" }),
            testCase({ args: [], expected: "0" }),
        ]);
        expect(source).toContain("function add(a,b){return a+b}");
        expect(source).toContain('"add"');
        expect(source).toContain("[[1,2],[]]");
    });

    it("没有参数的用例回落到空参数数组", () => {
        expect(buildRunnerSource("function f(){}", "f", [testCase()])).toContain("[[]]");
    });

    it("代码里的引号与换行被正确转义，不会破坏脚本", () => {
        const source = buildRunnerSource('const s = "a\\nb"; function f(){return s}', "f", [testCase()]);
        expect(source).toContain('const code = "const s = \\"a\\\\nb\\"; function f(){return s}";');
    });

    it("会向 worker 回传结果", () => {
        expect(buildRunnerSource("function f(){}", "f", [testCase()])).toContain("self.postMessage(results)");
    });
});

describe("evaluateCases", () => {
    it("返回值与期望值一致时通过", () => {
        const cases = [testCase({ args: [1, 2], expected: "3" })];
        expect(evaluateCases(cases, [{ index: 0, actual: 3 }])[0]).toMatchObject({
            passed: true,
            actual: 3,
            expected: 3,
        });
    });

    it("返回值不符时不通过", () => {
        const cases = [testCase({ expected: "3" })];
        expect(evaluateCases(cases, [{ index: 0, actual: 4 }])[0].passed).toBe(false);
    });

    it("执行抛错时记录错误信息且不通过", () => {
        const cases = [testCase({ expected: "1" })];
        const outcome = evaluateCases(cases, [{ index: 0, error: "x is not a function" }]);
        expect(outcome[0]).toMatchObject({ passed: false, error: "x is not a function" });
    });

    it("缺少执行结果时给出说明而不是崩溃", () => {
        const outcome = evaluateCases([testCase(), testCase()], [{ index: 0, actual: 1 }]);
        expect(outcome[0].passed).toBe(true);
        expect(outcome[1]).toMatchObject({ passed: false, error: "没有得到执行结果" });
    });

    it("用例顺序与输入一致", () => {
        const cases = [testCase({ expected: "1" }), testCase({ expected: "2" })];
        const outcome = evaluateCases(cases, [
            { index: 1, actual: 2 },
            { index: 0, actual: 1 },
        ]);
        expect(outcome.map((o) => o.index)).toEqual([0, 1]);
        expect(outcome.every((o) => o.passed)).toBe(true);
    });

    it("字符串期望值按去掉空白比较", () => {
        expect(evaluateCases([testCase({ expected: "  hello  " })], [{ index: 0, actual: "hello" }])[0].passed).toBe(
            true
        );
    });
});

describe("runCodingTests 的环境判断", () => {
    it("非 JavaScript 语言返回不支持而不是抛错", async () => {
        const outcome = await runCodingTests({ language: "python", code: "", entryPoint: "f", cases: [testCase()] });
        expect(isRunSupported(outcome)).toBe(false);
        expect(isRunSupported(outcome) ? "" : outcome.reason).toContain("JavaScript");
    });

    it("没有入口函数名时返回不支持", async () => {
        const outcome = await runCodingTests({ language: "javascript", code: "", entryPoint: "", cases: [testCase()] });
        expect(isRunSupported(outcome) ? "" : outcome.reason).toContain("入口函数");
    });

    it("没有测试用例时返回不支持", async () => {
        const outcome = await runCodingTests({ language: "javascript", code: "", entryPoint: "f", cases: [] });
        expect(isRunSupported(outcome) ? "" : outcome.reason).toContain("测试用例");
    });

    it("当前环境没有 Web Worker 时给出可读说明（node 环境）", async () => {
        expect(typeof Worker).toBe("undefined");
        const outcome = await runCodingTests({
            language: "javascript",
            code: "function f(){return 1}",
            entryPoint: "f",
            cases: [testCase({ expected: "1" })],
        });
        expect(isRunSupported(outcome) ? "" : outcome.reason).toContain("Worker");
    });
});

describe("isValidIdentifier", () => {
    it("接受常规函数名", () => {
        for (const name of ["add", "_run", "$el", "a1", "solve2"]) {
            expect(isValidIdentifier(name)).toBe(true);
        }
    });

    it("拒绝会被拼进脚本的非法名字", () => {
        for (const name of ["a b", "a.b", "f()", "f;g", "1abc", "", "f\ng"]) {
            expect(isValidIdentifier(name)).toBe(false);
        }
    });
});

describe("resolveEntryPoint - 非法入口函数名", () => {
    it("显式字段是非法标识符时回落到推断，避免拼出语法错误的脚本", () => {
        const question = coding({ entry_point: "a b", starter_code: "function good() {}" } as never);
        expect(resolveEntryPoint(question)).toBe("good");
    });

    it("显式字段合法时优先使用", () => {
        expect(resolveEntryPoint(coding({ entry_point: "pick", starter_code: "function other() {}" } as never))).toBe(
            "pick"
        );
    });
});

describe("runCodingTests - 非法入口函数名", () => {
    it("非法标识符返回不支持并说明原因", async () => {
        const outcome = await runCodingTests({
            language: "javascript",
            code: "const f = 1",
            entryPoint: "a b",
            cases: [testCase()],
        });
        expect(isRunSupported(outcome) ? "" : outcome.reason).toContain("合法标识符");
    });
});
