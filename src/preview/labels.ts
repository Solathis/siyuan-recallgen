/**
 * 画廊外框的界面文案。
 *
 * 和 pages.ts 同样的理由：静态体检会扫描所有 .svelte 的文本节点，
 * 模板里出现连续两个以上汉字就判为「硬编码中文」并报错。
 * 预览台不需要 i18n 词典，把文案放这里即可。
 */
export const L = {
    appTitle: "RecallGen 预览台",
    appSubtitle: "真实组件渲染 · 模拟思源主题",

    theme: "主题",
    themeLight: "浅色",
    themeDark: "深色",

    lang: "界面语言",
    langZh: "中文",
    langEn: "English",

    touch: "移动端路径",
    touchOn: "强制开",
    touchOff: "按设备",

    width: "容器宽度",
    widthReset: "回到默认",
    widthFit: "适应窗口",
    widthPx: "px",

    varsToggle: "思源主题变量",
    varsTitle: "粘贴你的思源主题变量，让预览与真机一致",
    varsDesc:
        "在思源里按 Ctrl+Shift+I 打开开发者工具，选中 <body>，把样式面板里的 --b3-* 变量整段复制过来即可。明暗两套分开保存，切换到深色主题后再贴一次深色的那套。",
    varsApply: "应用",
    varsClear: "清除",
    varsPlaceholder: "--b3-theme-background: #ffffff;\n--b3-theme-primary: #3575f0;",
    varsApplied: "已应用变量数",
    varsEmpty: "未粘贴，使用内置模拟值",

    focus: "观察重点",
    embedHint: "此屏在 iframe 里渲染，宽度即组件的真实可用宽度",
} as const;
