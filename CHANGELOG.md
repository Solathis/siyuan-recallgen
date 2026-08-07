# Changelog

## 0.1.0

- 初始化项目脚手架，基于 plugin-sample-vite-svelte 模板
- 配置 plugin.json/package.json/vite.config.ts 为 app-only 单文件构建
- 核心类型与默认配置（6 题型、难度分布、热力图配色区间）
- 存储层 ConfigStore/ScoreStore/ProgressStore（saveData/loadData）
- AI 客户端经内核 forwardProxy 代理，JSON Schema 约束 + jsonrepair 容错
- 题目生成器、判分器（客观本地 / 主观编程 AI 并发 ≤4）
- CodeMirror 6 编辑器封装（动态语言包、主题跟随思源）
- 答题面板 QuizPanel 状态机（生成→答题→判分→结果）与题目视图
- 结果面板 ResultPanel（分数环、卡片、薄弱点分析、保存到文档）
- 日历热力图 Heatmap（SVG、按日聚合、配色分级）
- 设置面板 SettingPanel（AI/题目/提示词/热力图/数据管理）
- 内容选取器（块菜单 + 命令面板）、题目文档落盘
- index.ts 完整编排：Tab 注册、服务对象、选择器、顶栏按钮
- i18n 基础设施（public 目录自动产出）
- tsc 0 错，build 通过，单文件 dist/index.js（gzip 246KB）
