import { AIError } from "./client";
import { t } from "@/lib/i18n";

/** 面向用户的错误说明：标题 + 可操作建议 + 原始信息 + 模型/服务端返回原文 */
export interface ErrorDescription {
    title: string;
    hint: string;
    detail: string;
    /** 模型或服务端返回的原文；有值时界面提供展开与复制，便于排查 */
    raw?: string;
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
    const raw = error instanceof AIError ? error.raw : undefined;
    const withRaw = (d: Omit<ErrorDescription, "raw">): ErrorDescription => (raw ? { ...d, raw } : d);

    if (error instanceof AIError) {
        switch (error.kind) {
            case "config":
                return withRaw({ title: t("err.config.title"), hint: t("err.config.hint"), detail });
            case "timeout":
                return withRaw({ title: t("err.timeout.title"), hint: t("err.timeout.hint"), detail });
            case "parse":
                return withRaw({ title: t("err.json.title"), hint: t("err.json.hint"), detail });
            case "network":
                // 不把 kind 名当参数塞进标题：之前会显示成「网络错误（network）」
                return withRaw({ title: t("err.network.title"), hint: t("err.network.hint"), detail });
            case "truncated":
                return withRaw({ title: t("err.truncated.title"), hint: t("err.truncated.hint"), detail });
            case "aborted":
                return withRaw({ title: t("err.aborted.title"), hint: t("err.aborted.hint"), detail });
            case "http":
                return withRaw(describeHttp(error.status, detail));
        }
    }

    return withRaw({ title: t("err.generic.title"), hint: t("err.generic.hint"), detail });
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
        // 其余状态码（404 模型名写错、408、413…）此前一律报「网络错误」，
        // 把人往 Base URL 上引
        return { title: t("err.http.title", String(status)), hint: t("err.http.hint"), detail };
    }
    return { title: t("err.generic.title"), hint: t("err.generic.hint"), detail };
}
