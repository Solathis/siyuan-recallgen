import { beforeEach } from "vitest";
import zhCN from "@/../public/i18n/zh-CN.json";
import { initI18n, setFallback } from "@/lib/i18n";

/**
 * 单测统一加载仓库里真实的中文字典。
 *
 * 既让断言可以比对可读文案（而不是比对 key），
 * 也能捕获「代码引用了字典中不存在的 key」——此时 t() 会原样返回 key，断言随即失败。
 */
beforeEach(() => {
    const dict = zhCN as Record<string, string>;
    initI18n(dict);
    setFallback(dict);
});
