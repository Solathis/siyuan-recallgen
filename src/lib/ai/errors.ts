import { AIError } from "./client";
import { t } from "@/lib/i18n";

/** 面向用户的错误说明：标题 + 可操作建议 + 原始信息 */
export interface ErrorDescription {
    title: string;
    hint: string;
    detail: string;
}

/**
 * 把错误对象翻译成「标题 + 建议 + 原始信息」。
 *
 * 早先的实现在 UI 层用 message 文本匹配分类（`msg.includes("超时")` 之类），
 * 既依赖文案又会随语言变化失效；现在优先依据 AIError 的 kind/status 判断，
 * 只在完全没有结构信息时才回落到文本匹配。
 */
export function describeError(error: unknown): ErrorDescription {
    const detail = error instanceof Error ? error.message : String(error);

    if (error instanceof AIError) {
        switch (error.kind) {
            case "config":
                return { title: t("err.config.title"), hint: t("err.config.hint"), detail };
            case "timeout":
                return { title: t("err.timeout.title"), hint: t("err.timeout.hint"), detail };
            case "parse":
                return { title: t("err.json.title"), hint: t("err.json.hint"), detail };
            case "network":
                return { title: t("err.network.title", "network"), hint: t("err.network.hint"), detail };
            case "http":
                return describeHttp(error.status, detail);
        }
    }

    return { title: t("err.generic.title"), hint: t("err.generic.hint"), detail };
}

/** 按 HTTP 状态码给出针对性建议 */
export function describeHttp(status: number | undefined, detail: string): ErrorDescription {
    if (status === 400) {
        return { title: t("err.400.title"), hint: t("err.400.hint"), detail };
    }
    if (status === 401 || status === 403) {
        return { title: t("err.401.title", String(status)), hint: t("err.401.hint"), detail };
    }
    if (status === 429) {
        return { title: t("err.429.title"), hint: t("err.429.hint"), detail };
    }
    if (typeof status === "number" && status >= 500) {
        return { title: t("err.5xx.title", String(status)), hint: t("err.5xx.hint"), detail };
    }
    if (typeof status === "number") {
        return { title: t("err.network.title", String(status)), hint: t("err.network.hint"), detail };
    }
    return { title: t("err.generic.title"), hint: t("err.generic.hint"), detail };
}
