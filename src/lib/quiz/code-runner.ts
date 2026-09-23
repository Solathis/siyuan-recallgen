import type { Question, TestCase } from "@/types/quiz";

/**
 * 编程题测试用例执行。
 *
 * 设计取舍：
 * - 只在浏览器端执行 JavaScript，并使用 Web Worker + 超时终止，
 *   因为主线程无法中断死循环（会把思源界面卡死），而 Worker 可以直接 terminate
 * - 期望值用「先按 JSON 解析、失败则按字符串」的宽松规则比较，
 *   避免因为 `42` 与 `"42"`、`true` 与 `"true"` 的写法差异误判
 * - 比较逻辑放在主线程，因此可以完整单测；Worker 只负责「跑代码、回传结果」
 */

/** 单个用例的执行结果 */
export interface CaseOutcome {
    index: number;
    passed: boolean;
    actual?: unknown;
    expected?: unknown;
    /** 执行该用例时抛出的错误信息 */
    error?: string;
}

/** 无法执行时的说明 */
export interface RunUnsupported {
    supported: false;
    reason: string;
}

export interface RunSupported {
    supported: true;
    results: CaseOutcome[];
    /** 实际执行的用例数 */
    executed: number;
}

export type RunOutcome = RunSupported | RunUnsupported;

/**
 * 判定执行是否成功。
 * 提供显式类型守卫，供调用方与模板可靠地收窄联合类型。
 */
export function isRunSupported(outcome: RunOutcome | null | undefined): outcome is RunSupported {
    return !!outcome && outcome.supported === true;
}

/** 默认单次执行的超时时间 */
export const DEFAULT_RUN_TIMEOUT_MS = 5000;

/** 支持直接执行的编程语言 */
const JS_LANGUAGES = ["javascript", "js", "node", "ecmascript"];

/** 语言是否可直接执行 */
export function isRunnableLanguage(language: string): boolean {
    return JS_LANGUAGES.includes((language ?? "").trim().toLowerCase());
}

/** 取题目的入口函数名：优先显式字段，其次从初始代码里推断 */
export function resolveEntryPoint(question: Question): string | null {
    if (question.type !== "coding") return null;
    if (question.entry_point && question.entry_point.trim()) return question.entry_point.trim();
    return inferEntryPoint(question.starter_code ?? "") ?? inferEntryPoint(question.answer ?? "");
}

/** 从代码里推断第一个函数声明或箭头函数赋值的名字 */
export function inferEntryPoint(code: string): string | null {
    const declaration = code.match(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (declaration) return declaration[1];

    const assigned = code.match(
        /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/
    );
    if (assigned) return assigned[1];

    return null;
}

/** 期望值的宽松解析：能当 JSON 就当 JSON，否则按原字符串比较 */
export function normalizeExpected(expected: unknown): unknown {
    if (typeof expected !== "string") return expected;
    const trimmed = expected.trim();
    if (trimmed === "") return "";
    try {
        return JSON.parse(trimmed);
    } catch {
        return trimmed;
    }
}

/** 数字比较的相对容差，容忍浮点误差 */
const EPSILON = 1e-9;

/**
 * 宽松相等比较：数字容忍浮点误差，字符串忽略首尾空白，
 * 数组与对象递归比较，其余按严格相等。
 */
export function looseEqual(actual: unknown, expected: unknown): boolean {
    if (typeof actual === "number" && typeof expected === "number") {
        if (Number.isNaN(actual) && Number.isNaN(expected)) return true;
        return Math.abs(actual - expected) <= EPSILON * Math.max(1, Math.abs(expected));
    }

    if (typeof actual === "string" && typeof expected === "string") {
        return actual.trim() === expected.trim();
    }

    if (Array.isArray(actual) && Array.isArray(expected)) {
        return actual.length === expected.length && actual.every((value, i) => looseEqual(value, expected[i]));
    }

    if (
        actual &&
        expected &&
        typeof actual === "object" &&
        typeof expected === "object" &&
        !Array.isArray(actual) &&
        !Array.isArray(expected)
    ) {
        const a = actual as Record<string, unknown>;
        const b = expected as Record<string, unknown>;
        const keys = Object.keys(b);
        return keys.length === Object.keys(a).length && keys.every((key) => looseEqual(a[key], b[key]));
    }

    return actual === expected;
}

/**
 * 生成 Worker 内运行的脚本。
 *
 * 学生代码与题目提供的入口函数名会被拼进来，因此这里只用于本地执行用户自己写的代码，
 * 不是安全沙箱：真正的隔离来自 Worker 可被终止，而不是作用域限制。
 */
export function buildRunnerSource(code: string, entryPoint: string, cases: TestCase[]): string {
    const args = cases.map((testCase) => testCase.args ?? []);
    return `
const code = ${JSON.stringify(code)};
const entryPoint = ${JSON.stringify(entryPoint)};
const cases = ${JSON.stringify(args)};

const results = [];
let fn = null;
let loadError = "";
try {
    const factory = new Function(code + "\\n;return typeof " + entryPoint + ' === "function" ? ' + entryPoint + " : null;");
    fn = factory();
} catch (e) {
    loadError = (e && e.message) ? e.message : String(e);
}
if (!fn && !loadError) loadError = "没有找到可调用的函数：" + entryPoint;

if (loadError) {
    cases.forEach((_, index) => results.push({ index, error: loadError }));
} else {
    cases.forEach((caseArgs, index) => {
        try {
            results.push({ index, actual: fn.apply(null, caseArgs) });
        } catch (e) {
            results.push({ index, error: (e && e.message) ? e.message : String(e) });
        }
    });
}
self.postMessage(results);
`;
}

/** Worker 回传的原始结果 */
interface RawCaseResult {
    index: number;
    actual?: unknown;
    error?: string;
}

/** 把原始执行结果与期望值比对 */
export function evaluateCases(cases: TestCase[], raw: RawCaseResult[]): CaseOutcome[] {
    return cases.map((testCase, index) => {
        const expected = normalizeExpected(testCase.expected);
        const result = raw.find((item) => item.index === index);
        if (!result) {
            return { index, passed: false, expected, error: "没有得到执行结果" };
        }
        if (result.error) {
            return { index, passed: false, expected, error: result.error };
        }
        return { index, passed: looseEqual(result.actual, expected), actual: result.actual, expected };
    });
}

export interface RunOptions {
    language: string;
    code: string;
    entryPoint: string;
    cases: TestCase[];
    timeoutMs?: number;
}

/**
 * 在 Worker 中执行测试用例。
 * 环境不支持 Worker（例如非浏览器环境）或语言不可执行时返回 supported: false 而不是抛错，
 * 让调用方给出可读提示。
 */
export async function runCodingTests(options: RunOptions): Promise<RunOutcome> {
    const { language, code, entryPoint, cases } = options;

    if (!isRunnableLanguage(language)) {
        return { supported: false, reason: `仅支持直接运行 JavaScript，当前为 ${language || "未知语言"}` };
    }
    if (!entryPoint) {
        return { supported: false, reason: "没有识别到入口函数名，无法调用" };
    }
    if (cases.length === 0) {
        return { supported: false, reason: "这道题没有测试用例" };
    }
    if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL?.createObjectURL !== "function") {
        return { supported: false, reason: "当前环境不支持运行测试（Web Worker 不可用）" };
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    let worker: Worker | null = null;
    let objectUrl = "";

    try {
        const source = buildRunnerSource(code, entryPoint, cases);
        objectUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        worker = new Worker(objectUrl);

        const raw = await new Promise<RawCaseResult[]>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`执行超时（${timeoutMs / 1000} 秒）`)), timeoutMs);
            worker!.onmessage = (event) => {
                clearTimeout(timer);
                resolve(event.data as RawCaseResult[]);
            };
            worker!.onerror = (event) => {
                clearTimeout(timer);
                reject(new Error(event.message || "执行出错"));
            };
        });

        return { supported: true, results: evaluateCases(cases, raw), executed: cases.length };
    } catch (e) {
        return { supported: false, reason: (e as Error).message };
    } finally {
        worker?.terminate();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
}
