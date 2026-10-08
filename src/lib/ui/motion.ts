import { cubicOut, quintOut } from "svelte/easing";
import type { TransitionConfig } from "svelte/transition";

import { useReducedMotion } from "./media.svelte";

/**
 * 进入动效预设。
 *
 * 为什么不用 Svelte 内置的 fade/fly 直接写：
 * 1. 系统开了「减少动态效果」时，内置 transition 仍会按给定 duration 播完，
 *    每个调用点都得自己判断一次，漏一个就动一次；
 * 2. 内置 fly 的 css 会生成 transform，与同元素上的 hover:scale 打架。
 * 这里统一在入口判断，且在 reduced 时把 duration 直接压成 0——
 * duration 为 0 时 Svelte 不会调用 css，元素直接落在终态，不留中间态。
 */

interface RiseParams {
    /** 起始的向下偏移量（px），默认 6 */
    y?: number;
    duration?: number;
    delay?: number;
}

/** 淡入 + 轻微上浮。用于列表项、卡片、状态块。 */
export function rise(node: Element, params: RiseParams = {}): TransitionConfig {
    void node;
    const reduced = useReducedMotion();
    const y = params.y ?? 6;
    return {
        duration: reduced ? 0 : (params.duration ?? 220),
        delay: reduced ? 0 : (params.delay ?? 0),
        easing: cubicOut,
        css: (t) => `opacity:${t};transform:translateY(${(1 - t) * y}px)`,
    };
}

interface FadeParams {
    duration?: number;
    delay?: number;
}

/** 纯淡入。用于不想产生位移的浮层内容。 */
export function softFade(node: Element, params: FadeParams = {}): TransitionConfig {
    void node;
    const reduced = useReducedMotion();
    return {
        duration: reduced ? 0 : (params.duration ?? 160),
        delay: reduced ? 0 : (params.delay ?? 0),
        easing: cubicOut,
        css: (t) => `opacity:${t}`,
    };
}

interface PopParams {
    duration?: number;
    /** 起始缩放，默认 0.94 */
    scale?: number;
}

/** 由小变大的轻弹。用于状态刚刚变化的元素（得分、开关、切换中的块）。 */
export function pop(node: Element, params: PopParams = {}): TransitionConfig {
    void node;
    const reduced = useReducedMotion();
    const scale = params.scale ?? 0.94;
    return {
        duration: reduced ? 0 : (params.duration ?? 200),
        easing: quintOut,
        css: (t) => `transform:scale(${scale + (1 - scale) * t});opacity:${t}`,
    };
}
