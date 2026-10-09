/**
 * 预览台的页面清单。
 *
 * 文案故意放在 .ts 里而不是模板里：本项目的静态体检（code-hygiene）会扫描
 * 所有 .svelte 的文本节点，模板里出现连续两个以上汉字就报错（防止英文界面漏出中文）。
 * 预览台不受 i18n 约束，但也没必要为它破例去加词典，放在数据文件里即可。
 */

export type PageKey =
    | "quiz-compose"
    | "quiz-date-config"
    | "quiz-generating"
    | "quiz-generating-slow"
    | "quiz-generating-fail"
    | "quiz-generating-empty"
    | "quiz-answering"
    | "quiz-answering-empty"
    | "quiz-result"
    | "flashcard"
    | "bank"
    | "stats"
    | "history"
    | "settings";

export interface PageDef {
    key: PageKey;
    label: string;
    /** 这一屏想被观察的重点 */
    hint: string;
}

export interface PageGroup {
    group: string;
    pages: PageDef[];
}

export const PAGE_GROUPS: PageGroup[] = [
    {
        group: "出题",
        pages: [
            { key: "quiz-compose", label: "粘贴材料出题", hint: "材料输入、来源标题、字数上限与截断提示" },
            { key: "quiz-date-config", label: "日期范围配置", hint: "按日期出题时的配置卡与出题计划" },
            { key: "quiz-generating", label: "生成中", hint: "进度条、阶段、批次与已收集题数" },
            { key: "quiz-generating-slow", label: "生成中（慢）", hint: "把耗时拉长，便于观察进度与动效" },
            { key: "quiz-generating-fail", label: "生成失败", hint: "失败诊断、原始返回折叠区与重试" },
            { key: "quiz-generating-empty", label: "生成 0 题", hint: "模型没给出可用题目时的空态" },
        ],
    },
    {
        group: "答题",
        pages: [
            { key: "quiz-answering", label: "答题中", hint: "六种题型、题号导航、标记与交卷栏" },
            { key: "quiz-answering-empty", label: "空会话", hint: "恢复到一个没有题目的会话" },
        ],
    },
    {
        group: "结果",
        pages: [{ key: "quiz-result", label: "成绩与解析", hint: "得分汇总、逐题回看与 AI 答疑" }],
    },
    {
        group: "复习",
        pages: [
            { key: "flashcard", label: "闪卡复习", hint: "翻卡与四档自评" },
            { key: "bank", label: "题库", hint: "到期筛选、标签管理与表格" },
            { key: "stats", label: "统计", hint: "概览卡、趋势、分布、难度环形与热力图" },
            { key: "history", label: "历史记录", hint: "列表/网格/表格三种视图" },
        ],
    },
    {
        group: "设置",
        pages: [{ key: "settings", label: "设置（六分区）", hint: "AI、角色、通用、提示词、热力图、数据" }],
    },
];

export const ALL_PAGES: PageDef[] = PAGE_GROUPS.flatMap((group) => group.pages);

export function pageDef(key: PageKey): PageDef {
    return ALL_PAGES.find((page) => page.key === key) ?? ALL_PAGES[0];
}

/** 未指定或无法识别时渲染哪一屏。默认给答题页：它是改动最频繁、也是用户最常看的一屏 */
export const DEFAULT_PAGE_KEY: PageKey = "quiz-answering";

/** URL 参数 → PageKey。认不出来就回落到默认屏，而不是渲染空白 */
export function asPageKey(raw: string): PageKey {
    return ALL_PAGES.some((page) => page.key === raw) ? (raw as PageKey) : DEFAULT_PAGE_KEY;
}

/**
 * 预览默认宽度。
 * 取 1024 而不是思源里配置的面板宽度 1100：画廊本身还要占掉左侧导航，
 * 默认值超过可用宽度时舞台会横向滚动，右下角的交卷栏直接被推出视野。
 */
export const DEFAULT_WIDTH = 1024;

/** 宽度档位：手机 / 平板 / 窄桌面 / 桌面 / 宽屏 */
export const WIDTH_STEPS = [375, 560, 768, 1024, 1440] as const;
