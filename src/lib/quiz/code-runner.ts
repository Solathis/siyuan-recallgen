import { t } from "@/lib/i18n";
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
    /** 实际跑出结果的用例数（不含因加载失败/抛错而未产出值的用例） */
    executed: number;
    /** 入口函数未能加载时的原因；正常时为 undefined */
    loadError?: string;
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
    const explicit = question.entry_point?.trim();
    // 非法标识符（含空格、点号、括号等）不能拼进脚本，回落到推断
    if (explicit && isValidIdentifier(explicit)) return explicit;
    return inferEntryPoint(question.starter_code ?? "") ?? inferEntryPoint(question.answer ?? "");
}

/** 是否是合法的 JavaScript 标识符（入口函数名会被拼进执行脚本，必须先校验） */
export function isValidIdentifier(name: string): boolean {
    return /^[A-Za-z_$][\w$]*$/.test(name);
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
 * 执行用户代码前会删除并以形参遮蔽的全局入口。
 *
 * 学生代码可能由 AI 依据笔记内容生成，必须按不可信代码对待：
 * Worker 只能保证「不会卡死主线程」，挡不住网络访问，
 * 于是它既能向任意地址发请求，也能对本地思源内核发起 CSRF。
 */
export const BLOCKED_GLOBALS = [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "importScripts",
    "Worker",
    "SharedWorker",
    "indexedDB",
    "caches",
] as const;

/**
 * 生成 Worker 内运行的脚本。
 *
 * 三层处理：
 * 1. 在全局对象及其原型链上把上表中的入口改写成 undefined。
 *    只 `delete self.fetch` 是不够的：fetch 挂在 WorkerGlobalScope 的原型上，
 *    删掉自有属性后 `globalThis.fetch` 依然能拿到（已在真实浏览器中验证过）。
 * 2. 再把这些名字作为形参遮蔽进用户代码所在的作用域，
 *    这样 `fetch(...)` 与被返回的入口函数内部都拿不到它们。
 * 3. 入口函数可能是 async，必须 await 后再回传；Promise 无法结构化克隆，
 *    否则每个用例都会以「执行出错」告终。
 *
 * 需要说明的是这仍不是完整的沙箱：真正不可绕过需要 iframe + 严格 CSP。
 * 这里的定位是「执行自己写的练习代码」时的兜底，不是对抗恶意代码的边界。
 */
export function buildRunnerSource(code: string, entryPoint: string, cases: TestCase[]): string {
    const args = cases.map((testCase) => testCase.args ?? []);
    const blocked = JSON.stringify(BLOCKED_GLOBALS);
    const codeLiteral = JSON.stringify(code);
    const entryLiteral = JSON.stringify(entryPoint);

    return `
"use strict";
const post = self.postMessage.bind(self);
const rawCases = ${JSON.stringify(args)};
const blocked = ${blocked};

/** 在全局对象与原型链上把某个入口彻底改写掉 */
function blockGlobal(key) {
    let target = self;
    while (target) {
        let desc = null;
        try { desc = Object.getOwnPropertyDescriptor(target, key); } catch (e) { desc = null; }
        if (desc) {
            if (desc.configurable) {
                try { delete target[key]; } catch (e) { /* 交给下面的改写 */ }
            }
            try {
                Object.defineProperty(target, key, { value: undefined, writable: false, configurable: false });
            } catch (e) { /* 不可配置且不可写时只能靠形参遮蔽 */ }
            return;
        }
        target = Object.getPrototypeOf(target);
    }
    try {
        Object.defineProperty(self, key, { value: undefined, writable: false, configurable: false });
    } catch (e) { /* 同上 */ }
}

for (const key of blocked) blockGlobal(key);
if (self.navigator) {
    try {
        Object.defineProperty(self.navigator, "sendBeacon", { value: undefined, writable: false, configurable: false });
    } catch (e) { /* 只读属性，忽略 */ }
}

function describe(e) {
    return e && e.message ? String(e.message) : String(e);
}

/** 转成可结构化克隆的值：Promise/BigInt/循环引用/超大对象都会让 postMessage 抛错 */
function safe(value, level) {
    const depth = level || 0;
    if (value === null || value === undefined) return value;
    const kind = typeof value;
    if (kind === "number") return Number.isFinite(value) ? value : String(value);
    if (kind === "string" || kind === "boolean") return value;
    if (kind === "bigint") return value.toString() + "n";
    if (kind === "symbol" || kind === "function") return String(value);
    if (value instanceof Date) return value.toISOString();
    if (depth >= 5) return "[层级过深]";
    if (Array.isArray(value)) return value.slice(0, 500).map(function (v) { return safe(v, depth + 1); });
    if (value instanceof Map) return Array.from(value.entries()).slice(0, 200).map(function (p) { return safe(p, depth + 1); });
    if (value instanceof Set) return Array.from(value.values()).slice(0, 200).map(function (v) { return safe(v, depth + 1); });
    if (kind === "object") {
        const out = {};
        for (const key of Object.keys(value).slice(0, 200)) out[key] = safe(value[key], depth + 1);
        return out;
    }
    return String(value);
}

(async function () {
    const results = [];
    let fn = null;
    let loadError = "";

    try {
        const body =
            "return (function () {\\n" + ${codeLiteral} +
            "\\n;return typeof " + ${entryLiteral} + ' === "function" ? ' + ${entryLiteral} + " : null;\\n})();";
        const build = new Function(blocked.join(", "), body);
        fn = build.apply(null, blocked.map(function () { return undefined; }));
    } catch (e) {
        loadError = describe(e);
    }
    if (!fn && !loadError) loadError = "没有找到可调用的函数：" + ${entryLiteral};

    if (loadError) {
        post({
            loadError: loadError,
            results: rawCases.map(function (_, index) { return { index: index, error: loadError }; }),
        });
        return;
    }

    for (let index = 0; index < rawCases.length; index++) {
        try {
            // await 让 async 入口函数也能正确取到结果
            const actual = await fn.apply(null, rawCases[index]);
            results.push({ index: index, actual: safe(actual) });
        } catch (e) {
            results.push({ index: index, error: describe(e) });
        }
    }

    post({ loadError: "", results: results });
})();
`;
}

/** Worker 回传的负载 */
interface RawRunPayload {
    loadError?: string;
    results?: RawCaseResult[];
}

/** Worker 回传的原始结果 */
interface RawCaseResult {
    index: number;
    actual?: unknown;
    error?: string;
}

/** 把原始执行结果与期望值比对 */
export function evaluateCases(cases: TestCase[], raw: RawCaseResult[]): CaseOutcome[] {
    const byIndex = new Map(raw.map((item) => [item.index, item]));
    return cases.map((testCase, index) => {
        const expected = normalizeExpected(testCase.expected);
        const result = byIndex.get(index);
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
        return { supported: false, reason: t("runtime.onlyJs", language || t("runtime.unknownLanguage")) };
    }
    if (!entryPoint) {
        return { supported: false, reason: t("runtime.noEntryPoint") };
    }
    if (!isValidIdentifier(entryPoint)) {
        return { supported: false, reason: t("runtime.badIdentifier", entryPoint) };
    }
    if (cases.length === 0) {
        return { supported: false, reason: t("runtime.noCases") };
    }
    if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL?.createObjectURL !== "function") {
        return { supported: false, reason: t("runtime.noWorker") };
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    let worker: Worker | null = null;
    let objectUrl = "";

    try {
        const source = buildRunnerSource(code, entryPoint, cases);
        objectUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        worker = new Worker(objectUrl);

        const raw = await new Promise<RawRunPayload>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`执行超时（${timeoutMs / 1000} 秒）`)), timeoutMs);
            worker!.onmessage = (event) => {
                clearTimeout(timer);
                resolve(event.data as RawRunPayload);
            };
            worker!.onerror = (event) => {
                clearTimeout(timer);
                reject(new Error(event.message || "执行出错"));
            };
        });

        if (!raw || !Array.isArray(raw.results)) {
            return { supported: false, reason: t("runtime.badResult") };
        }
        const results = evaluateCases(cases, raw.results);
        const loadError = typeof raw.loadError === "string" && raw.loadError ? raw.loadError : undefined;
        return {
            supported: true,
            results,
            executed: results.filter((r) => r.error === undefined).length,
            loadError,
        };
    } catch (e) {
        return { supported: false, reason: (e as Error).message };
    } finally {
        worker?.terminate();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
}
