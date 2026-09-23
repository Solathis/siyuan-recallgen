import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并 Tailwind 类名：clsx 处理条件类，tailwind-merge 解决冲突（后者覆盖前者） */
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/*
 * 以下类型供 shadcn-svelte 生成的组件使用（其源码固定从本模块导入）。
 * Snippet 属性在包装原生元素时必须剔除，否则会与 `children` 冲突。
 */

/** 剔除 child 属性 */
export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;

/** 剔除 children 属性 */
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, "children"> : T;

/** 同时剔除 child 与 children */
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;

/** 追加 ref 绑定 */
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
