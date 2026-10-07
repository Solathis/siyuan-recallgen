// @vitest-environment jsdom
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { getDefaultConfig, type RecallGenConfig } from "@/types/config";
import SettingsGeneral from "./SettingsGeneral.svelte";

const MOUNT_TIMEOUT = 60_000;
let cleanup: (() => void) | null = null;

afterEach(() => {
    cleanup?.();
    cleanup = null;
});

function mountGeneral(config: RecallGenConfig, onsave: (c: RecallGenConfig) => void = () => {}) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(SettingsGeneral, { target: host, props: { config, onsave } });
    flushSync();
    cleanup = () => {
        unmount(app);
        host.remove();
    };
    return host;
}

const input = (host: HTMLElement, id: string) => host.querySelector<HTMLInputElement>(`#${id}`)!;

describe("设置 · 通用", () => {
    it("难度输入框显示配置里的当前值（真实 DOM 的属性而不是序列化属性）", { timeout: MOUNT_TIMEOUT }, () => {
        const config = getDefaultConfig();
        config.general.difficulty = { total: 20, easy: 6, medium: 8, hard: 6 };
        const host = mountGeneral(config);

        // 序列化 innerHTML 里看不到这些值（Svelte 设的是 DOM 属性），
        // 但只要 value 属性正确，用户看到的就是对的——这里守住这一点
        expect(input(host, "rg-diff-total").value).toBe("20");
        expect(input(host, "rg-diff-easy").value).toBe("6");
        expect(input(host, "rg-diff-medium").value).toBe("8");
        expect(input(host, "rg-diff-hard").value).toBe("6");
        expect(input(host, "rg-countdown").value).toBe(String(config.general.countdownMinutes));
        expect(input(host, "rg-review-limit").value).toBe(String(config.general.reviewLimit));
        expect(input(host, "rg-daily-goal").value).toBe(String(config.general.dailyGoal));
    });

    it("改动难度分档会回调 onsave，并把值收敛到 0-50 的整数", { timeout: MOUNT_TIMEOUT }, () => {
        const config = getDefaultConfig();
        config.general.difficulty = { total: 20, easy: 6, medium: 8, hard: 6 };
        const saved: RecallGenConfig[] = [];
        const host = mountGeneral(config, (next) => saved.push(next));

        const easy = input(host, "rg-diff-easy");
        easy.value = "999";
        easy.dispatchEvent(new Event("change", { bubbles: true }));
        flushSync();

        expect(saved).toHaveLength(1);
        expect(saved[0].general.difficulty.easy).toBe(50);
        // 其余字段不受影响
        expect(saved[0].general.difficulty.total).toBe(20);
    });

    it("分档之和对不上总题量时给出提示", { timeout: MOUNT_TIMEOUT }, () => {
        const config = getDefaultConfig();
        config.general.difficulty = { total: 20, easy: 6, medium: 8, hard: 6 };
        const host = mountGeneral(config);
        expect(host.textContent).toContain("20");
        // 6+8+6 = 20 与总题量一致时不该出现提醒
        expect(host.querySelector(".text-warning")).toBeNull();
    });

    it("不允许取消最后一个题型（否则生成必然失败）", { timeout: MOUNT_TIMEOUT }, () => {
        const config = getDefaultConfig();
        config.general.allowedTypes = ["true_false"];
        const saved: RecallGenConfig[] = [];
        const host = mountGeneral(config, (next) => saved.push(next));

        // 题型复选框顺序固定（单选/多选/填空/判断/主观/编程），索引 3 是判断题
        const boxes = [...host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')];
        expect(boxes).toHaveLength(6);
        boxes[3].click();
        flushSync();

        // 被拒绝：没有回调，配置里的题型没被清空
        expect(saved).toHaveLength(0);
    });

    it("勾选未启用的题型会加入配置", { timeout: MOUNT_TIMEOUT }, () => {
        const config = getDefaultConfig();
        config.general.allowedTypes = ["true_false"];
        const saved: RecallGenConfig[] = [];
        const host = mountGeneral(config, (next) => saved.push(next));

        // 题型顺序固定，索引 0 是单选（未启用）
        const boxes = [...host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')];
        boxes[0].click();
        flushSync();

        expect(saved).toHaveLength(1);
        expect(saved[0].general.allowedTypes).toContain("single_choice");
        expect(saved[0].general.allowedTypes).toContain("true_false");
    });
});
