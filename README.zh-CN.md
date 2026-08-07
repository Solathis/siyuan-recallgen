# 知了·RecallGen

基于 AI 的思源笔记智能复习插件。

## 功能

- 选中笔记内容，一键生成多题型复习试卷（单选/多选/填空/判断/主观/编程）
- 内置答题面板（含 CodeMirror 6 代码编辑器）
- 客观题本地判分，主观题/编程题 AI 判分
- 薄弱点分析与复习指导
- 题目存为思源文档，成绩日历热力图可视化

## 开发

```bash
pnpm install
pnpm run dev      # 开发模式，watch + livereload
pnpm run build    # 生产构建，输出 dist/ + package.zip
pnpm run make-link  # 链接到思源插件目录
```

## 技术栈

TypeScript + Svelte 4 + Vite 5，基于 [plugin-sample-vite-svelte](https://github.com/siyuan-note/plugin-sample-vite-svelte) 模板。
