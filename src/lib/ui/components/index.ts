/**
 * shadcn 风格 class 常量，颜色全部映射思源 --b3-* 主题变量。
 * 用法：<button class={button({variant:'outline',size:'sm'})}>。
 * cn() 合并条件类，替代手动模板字符串三元。
 */

export type ButtonVariant = "default" | "outline" | "ghost" | "destructive" | "secondary" | "link";
export type ButtonSize = "default" | "sm" | "lg" | "icon";
export type BadgeVariant = "default" | "secondary" | "outline" | "destructive" | "success" | "warning";
export type AlertVariant = "default" | "destructive" | "success" | "warning";

export function cn(...parts: (string | false | null | undefined)[]): string {
    return parts.filter(Boolean).join(" ");
}

const BTN_BASE = "rg-btn";
const BTN_VARIANT: Record<ButtonVariant, string> = {
    default: "rg-btn--default",
    outline: "rg-btn--outline",
    ghost: "rg-btn--ghost",
    destructive: "rg-btn--destructive",
    secondary: "rg-btn--secondary",
    link: "rg-btn--link",
};
const BTN_SIZE: Record<ButtonSize, string> = {
    default: "rg-btn--md",
    sm: "rg-btn--sm",
    lg: "rg-btn--lg",
    icon: "rg-btn--icon",
};

export function button(opts: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
    return cn(BTN_BASE, BTN_VARIANT[opts.variant ?? "default"], BTN_SIZE[opts.size ?? "default"]);
}

const BADGE_VARIANT: Record<BadgeVariant, string> = {
    default: "rg-badge--default",
    secondary: "rg-badge--secondary",
    outline: "rg-badge--outline",
    destructive: "rg-badge--destructive",
    success: "rg-badge--success",
    warning: "rg-badge--warning",
};

export function badge(variant: BadgeVariant = "default"): string {
    return cn("rg-badge", BADGE_VARIANT[variant]);
}

export const input = "rg-input";
export const textarea = "rg-textarea";
export const label = "rg-label";
export const select = "rg-select";
export const switchCls = "rg-switch";
export const checkbox = "rg-checkbox";
export const slider = "rg-slider";
export const separator = "rg-separator";

export const card = {
    root: "rg-card",
    header: "rg-card__header",
    title: "rg-card__title",
    description: "rg-card__description",
    content: "rg-card__content",
    footer: "rg-card__footer",
};

const ALERT_VARIANT: Record<AlertVariant, string> = {
    default: "rg-alert--default",
    destructive: "rg-alert--destructive",
    success: "rg-alert--success",
    warning: "rg-alert--warning",
};

export function alert(variant: AlertVariant = "default"): string {
    return cn("rg-alert", ALERT_VARIANT[variant]);
}
export const alertTitle = "rg-alert__title";
export const alertDescription = "rg-alert__description";

export const field = {
    group: "rg-field-group",
    field: "rg-field",
    label: "rg-field-label",
    description: "rg-field-description",
};

export const progress = {
    root: "rg-progress",
    bar: "rg-progress__bar",
    indeterminate: "rg-progress__bar--indeterminate",
};

export const tabs = {
    root: "rg-tabs",
    list: "rg-tabs__list",
    trigger: (active: boolean) => cn("rg-tabs__trigger", active && "rg-tabs__trigger--active"),
    content: "rg-tabs__content",
};

export const collapsible = {
    root: "rg-collapsible",
    trigger: "rg-collapsible__trigger",
    content: "rg-collapsible__content",
};

export const tooltip = "rg-tooltip";

export const scrollArea = "rg-scroll-area";

export const sidebarNav = "rg-sidebar-nav";
export const sidebarNavItem = (active: boolean) => cn("rg-sidebar-nav__item", active && "rg-sidebar-nav__item--active");

export const heatmap = {
    root: "rg-heatmap",
    grid: "rg-heatmap__grid",
    col: "rg-heatmap__col",
    cell: "rg-heatmap__cell",
    months: "rg-heatmap__months",
    monthLabel: "rg-heatmap__month",
    legend: "rg-heatmap__legend",
    legendSwatch: "rg-heatmap__legend-swatch",
    legendText: "rg-heatmap__legend-text",
    tip: "rg-heatmap__tip",
};

/** 共享 context key，所有 Tabs 组件必须使用同一个 Symbol 实例 */
export const TABS_KEY = Symbol("rg-tabs");
