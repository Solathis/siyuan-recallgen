// @vitest-environment jsdom
import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";
import type { GenStats } from "../quiz/generator";
import ComposeView from "./ComposeView.svelte";
import GenProgressView from "./GenProgressView.svelte";

const MOUNT_TIMEOUT = 60_000;

/** 30 题三批：第 2 批失败、补题轮在跑，差额 12 */
const stats: GenStats = {
    phase: "generating",
    target: 30,
    collected: 18,
    batch: 3,
    batches: 3,
    dropped: 1,
    note: "第 2 批没返回可用题目，已跳过",
    batchStates: [
        { state: "done", count: 10, topUp: false },
        { state: "failed", count: 10, topUp: false },
        { state: "done", count: 10, topUp: false },
        { state: "running", count: 12, topUp: true },
    ],
    toppingUp: true,
};

function render(props: Record<string, unknown>) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(GenProgressView, { target: host, props: props as never });
    flushSync();
    return {
        host,
        text: () => host.textContent?.replace(/\s+/g, " ") ?? "",
        destroy() {
            unmount(app);
            host.remove();
        },
    };
}

const cancelButton = (host: HTMLElement) =>
    [...host.querySelectorAll("button")].find((b) => /取消/.test(b.textContent ?? ""));

describe("生成中", () => {
    it("收题数、逐批状态与补题差额都写出来", { timeout: MOUNT_TIMEOUT }, () => {
        const view = render({ mode: "generate", title: "正在生成题目", counter: { done: 18, total: 30 }, stats });
        expect(view.text()).toContain("18 / 30 题");
        const chips = [...view.host.querySelectorAll('[data-slot="badge"][title]')].map((b) => b.getAttribute("title"));
        // 首轮按 1、2、3 编号，补题轮标「补题」，失败批次说清楚原因
        expect(chips).toEqual([
            "第 1 批 · 10 题 · 已完成",
            "第 2 批 · 10 题 · 没返回可用题目",
            "第 3 批 · 10 题 · 已完成",
            "补题 · 12 题 · 请求中",
        ]);
        expect(view.text()).toContain("+12");
        expect(view.text()).toContain("还差 12 题，正在补齐");
        expect(view.text()).toContain("已丢弃 1 道格式不合格的题目");
        expect(view.host.querySelector('[data-slot="alert"]')?.textContent).toContain("第 2 批");
        view.destroy();
    });

    it("补题轮收集数超过目标时不显示负的差额", { timeout: MOUNT_TIMEOUT }, () => {
        const view = render({ mode: "generate", title: "t", stats: { ...stats, collected: 31 } });
        expect(view.text()).not.toContain("还差");
        view.destroy();
    });

    it("没配审题模型时步骤条只有生成一步", { timeout: MOUNT_TIMEOUT }, () => {
        const withReviewer = render({ mode: "generate", title: "t", stats, reviewer: true });
        expect(withReviewer.host.querySelectorAll("ol[aria-label] > li")).toHaveLength(3);
        withReviewer.destroy();
        const without = render({ mode: "generate", title: "t", stats, reviewer: false });
        expect(without.host.querySelectorAll("ol[aria-label] > li")).toHaveLength(1);
        without.destroy();
    });

    it("步骤条里只有 li：连接线放在 li 里面，ol 的子元素必须都是 li", { timeout: MOUNT_TIMEOUT }, () => {
        const view = render({ mode: "generate", title: "t", stats, reviewer: true });
        const children = [...(view.host.querySelector("ol[aria-label]")?.children ?? [])].map((c) => c.tagName);
        expect(children).toEqual(["LI", "LI", "LI"]);
        view.destroy();
    });

    it("动态按给定顺序列出并带时间；还没有动态时给出等待提示", { timeout: MOUNT_TIMEOUT }, () => {
        const empty = render({ mode: "generate", title: "t", activity: [] });
        expect(empty.host.querySelector('[role="log"]')?.textContent).toContain("等待第一批返回");
        empty.destroy();
        const view = render({
            mode: "generate",
            title: "t",
            activity: [
                { at: 65, text: "第 1 轮审题中…" },
                { at: 3, text: "并发生成 3 批" },
            ],
        });
        const rows = [...view.host.querySelectorAll('[role="log"] li')].map((li) =>
            li.textContent?.replace(/\s+/g, " ").trim()
        );
        expect(rows).toEqual(["1:05 第 1 轮审题中…", "0:03 并发生成 3 批"]);
        view.destroy();
    });

    it("出题计划默认折叠，点开才显示", { timeout: MOUNT_TIMEOUT }, () => {
        const plan = createRawSnippet(() => ({ render: () => "<div data-testid='plan'>计划内容</div>" }));
        const view = render({ mode: "generate", title: "t", plan });
        // bits-ui 的折叠内容常驻 DOM，靠 hidden 切换显隐
        const content = () => view.host.querySelector<HTMLElement>('[data-slot="collapsible-content"]');
        expect(content()?.hidden).toBe(true);
        const trigger = view.host.querySelector<HTMLElement>('[data-slot="collapsible-trigger"]');
        expect(trigger?.textContent).toContain("出题计划");
        trigger?.click();
        flushSync();
        expect(content()?.hidden).toBe(false);
        expect(content()?.querySelector("[data-testid='plan']")).not.toBeNull();
        view.destroy();
    });

    it("显示用时与「取消生成」，点击回调", { timeout: MOUNT_TIMEOUT }, () => {
        const oncancel = vi.fn();
        const view = render({ mode: "generate", title: "t", elapsed: 83, oncancel });
        expect(view.text()).toContain("已用时 1:23");
        cancelButton(view.host)?.click();
        expect(oncancel).toHaveBeenCalledTimes(1);
        expect(cancelButton(view.host)?.textContent?.trim()).toBe("取消生成");
        view.destroy();
    });
});

describe("取到期题目与判分", () => {
    it("取到期题目：只有标题与不确定进度，没有收题数、批次和动态", { timeout: MOUNT_TIMEOUT }, () => {
        const view = render({ mode: "due", title: "正在读取到期题目…", oncancel: () => {} });
        expect(view.text()).toContain("正在读取到期题目");
        expect(view.host.querySelector('[role="log"]')).toBeNull();
        expect(view.host.querySelector("ol[aria-label]")).toBeNull();
        expect(view.host.querySelector('[data-slot="skeleton"]')).not.toBeNull();
        expect(cancelButton(view.host)?.textContent?.trim()).toBe("取消");
        view.destroy();
    });

    it("判分：显示已判题数与百分比，不提供取消", { timeout: MOUNT_TIMEOUT }, () => {
        const view = render({ mode: "grade", title: "正在判分…", progress: 37.5, counter: { done: 3, total: 8 } });
        expect(view.text()).toContain("已判分");
        expect(view.text()).toContain("3 / 8 题");
        expect(view.text()).toContain("38%");
        expect(cancelButton(view.host)).toBeUndefined();
        expect(view.host.querySelector('[role="log"]')).toBeNull();
        view.destroy();
    });
});

describe("粘贴材料的草稿", () => {
    it("由调用方传入的材料与标题会填回输入框（取消或失败后回到这一屏时不丢）", { timeout: MOUNT_TIMEOUT }, () => {
        const host = document.createElement("div");
        document.body.appendChild(host);
        const app = mount(ComposeView, {
            target: host,
            props: { ongenerate: () => {}, content: "已经粘贴过的材料", title: "讲义第 3 章" },
        });
        flushSync();
        expect(host.querySelector<HTMLTextAreaElement>("#rg-compose-material")?.value).toBe("已经粘贴过的材料");
        expect([...host.querySelectorAll("input")].some((input) => input.value === "讲义第 3 章")).toBe(true);
        unmount(app);
        host.remove();
    });
});
