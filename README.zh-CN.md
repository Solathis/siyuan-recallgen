# 知了·RecallGen

基于 AI 的思源笔记智能复习插件。

## 功能

- 选中笔记内容 → 生成多题型试卷（单选/多选/填空/判断/主观/编程）
- 内置答题面板（自定义 Tab）：CodeMirror 6 代码编辑器、题号导航、倒计时、进度自动暂存
- 客观题本地判分；主观/编程题 AI 判分（0-100 分 + 评语）
- AI 薄弱点分析与复习指导
- 题目保存为思源文档（子文档或追加到当前文档，答案折叠）
- 成绩日历热力图（GitHub 式，配色区间可自定义）
- 设置：AI 服务商、难度分布校验、提示词编辑、热力图配置、数据管理
- 网络经思源内核 forwardProxy 代理（无 CORS，API Key 不出前端）
- 桌面端与移动端响应式

## 架构

- AI 调用经内核 `forwardProxy`（前端→内核 HTTP），超时 120s
- 答题面板为自定义 `addTab`；设置面板为自定义 Tab
- 进度与成绩经 `saveData`/`loadData` 存储（支持多端同步）
- Tab 状态机：`loading_generating → answering → loading_grading → result`

## 开发

```bash
pnpm install
pnpm run dev      # watch 模式 + livereload
pnpm run build    # 生产构建 -> dist/ + package.zip
pnpm run make-link  # 链接到思源插件目录
```

环境要求：Node ≥ 24.11，pnpm ≥ 11。构建产出单文件 `dist/index.js`（inlineDynamicImports），适配思源插件加载器。
