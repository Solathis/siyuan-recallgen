# 知了 · RecallGen

> **语言**: **简体中文** | [English](README.md)

> 基于思源笔记的 AI 智能复习插件——选块生成多题型试卷，内置答题面板，自动判分与薄弱点分析，热力图追踪学习轨迹。

## 📖 简介

RecallGen 是一款思源笔记插件，将笔记内容转化为可答题的复习试卷。用户选中笔记块或从文档/笔记本/日期范围触发，插件调用 AI 生成多种题型的题目，在独立 Tab 中答题后自动判分，客观题本地秒判、主观题/编程题 AI 评分，并生成薄弱点分析与学习建议。成绩记录以 GitHub 风格热力图展示，支持历史回看。

## ✨ 功能特性

### 题目生成

- **6 种题型**：单选题、多选题、填空题、判断题、主观题（简答/论述）、编程题
- **难度分布**：1-50 题，自定义初级/中级/高级配比，实时校验总题数
- **超纲比例**：0-50% 滑块，允许 AI 生成分笔记内容相关的扩展知识点题目
- **自包含原则**：题目题干包含解题所需的全部信息（代码、数据、定义），不依赖外部笔记上下文
- **Markdown + LaTeX 渲染**：题目文本和选项支持完整 Markdown 语法与 `$...$` / `$$...$$` 数学公式渲染（KaTeX + marked）
- **多入口触发**：
  - 文档块右键菜单 →「生成复习题」
  - 文档标题栏图标 →「生成复习题」/「从今日笔记生成」/「从近 N 天笔记生成」
  - 文档树右键菜单 → 同上，支持整个笔记本范围
  - 命令面板 → 搜索「生成复习题」

### AI 三角色架构

插件支持**多端点 + 多模型**配置，三种 AI 角色各独立选定模型：

| 角色 | 职责 | 默认温度 | 默认 MaxTokens |
|------|------|----------|---------------|
| 出题者 (generator) | 根据笔记内容生成题目 | 0.7 | 16384 |
| 审题者 (reviewer) | 审查题目严谨性与正确性 | 0.3 | 4096 |
| 判题者 (grader) | 主观题/编程题评分、薄弱点分析、AI 答疑 | 0 | 512 |

- **审题循环**：审题者审查所有题目，未通过的题目发回出题者重新生成（保留题目 ID），再审，最多 3 轮循环
- **进度展示**：生成阶段实时显示当前阶段（出题/审题/重生）、轮次和详情

### AI 协议支持

| 协议 | 端点路径 | 适用场景 |
|------|---------|---------|
| Chat (OpenAI) | `/v1/chat/completions` | OpenAI 及兼容 API（new-api、one-api 等） |
| Responses (OpenAI) | `/v1/responses` | OpenAI Responses API |
| Messages (Anthropic) | `/v1/messages` | Anthropic Claude |

- **结构化输出**：开启 JSON Schema 严格模式时使用 OpenAI tools/function calling 强制 JSON 输出；关闭时使用 `response_format: json_object` 宽松模式 + jsonrepair 容错
- **Ollama 支持**：无 API Key 时自动跳过认证头
- **超时与重试**：可配置超时（默认 120s），HTTP 429/5xx/超时自动重试（指数退避，最多 2 次）
- **网络代理**：所有 AI 调用经思源内核 `forwardProxy` 代理，无 CORS 问题，API Key 不暴露在前端

### 答题面板

- **独立 Tab**：自定义 `addTab`，支持宽屏与移动端响应式布局，面板宽度可配置（600-1600px）
- **单页全题视图**：所有题目在同一页面滚动展示，题号导航条标记已答/未答状态
- **编程题编辑器**：CodeMirror 6，支持语法高亮、行号、自动补全，深色/浅色主题跟随思源
- **主观题 Markdown 编辑**：支持编辑/预览切换，实时渲染 Markdown + LaTeX
- **倒计时**：可开启答题倒计时，时间到自动交卷
- **进度自动保存**：答题过程每 800ms 防抖保存到思源 `saveData`，关闭后可恢复
- **取消与恢复**：生成阶段可取消；关闭 Tab 时如在答题中，强制保存进度
- **二次确认**：重新生成和交卷操作需弹窗确认
- **日期范围生成**：支持「今日笔记」「近 N 天笔记」生成，可配置基点时间（如凌晨 4 点作为日期边界，适合深夜写笔记的用户）

### 判分与结果

- **客观题本地判分**：单选/多选/填空/判断题无需 AI 调用，即时判分
  - 多选题：排序后数组比较
  - 填空题：trim + 大小写不敏感匹配任意可接受答案
- **主观题/编程题 AI 判分**：返回 0-100 分 + 简要评语，JSON Schema 约束输出
- **结果面板**（3 标签页导航）：
  - **题目列表**：得分/正确率/答题时间统计卡片，题目进度条（绿色正确/红色错误/灰色未答），点击题号跳转详情，展示题目、选项（正确项绿色高亮）、用户答案、正确答案、解析、评语
  - **薄弱点分析**：AI 基于错题生成复习指导意见，包含知识点定位与练习方向
  - **学习建议**：AI 学习建议文本
- **AI 答疑**：全局 AI 答疑对话框，可针对整卷提问，AI 拥有所有题目、作答情况和分析上下文
- **保存到文档**：将题目写入思源文档（同级子文档或指定笔记本），支持「保存全部」或「仅保存错题（score < 60）」或「放弃保存」

### 成绩记录与热力图

- **GitHub 风格热力图**：固定 53 周 × 7 天（371 格）贡献图，展示过去一年每日答题情况
- **聚合方式**：每日最高分 / 每日平均分（可配置）
- **配色区间**：默认 GitHub 绿色色阶，支持自定义颜色区间与色盘选色
- **成绩自动记录**：交卷时立即写入成绩索引与当月明细分片，不受后续分析成败影响；历史列表只加载轻量索引，回看时才按需拉取明细
- **复习记录 Tab**：右上角图标打开历史记录面板，含「记录」与「统计」两个视图
  - **记录**：按日期/按来源分组，缩略图/列表/表格三种视图；支持按标题与来源搜索、按分数区间筛选、导出 JSON/CSV/Markdown、单条删除（带二次确认）；点击记录可回看完整结果。列表分段渲染（每批 60 条，触底自动加载），记录很多时也不会一次性创建大量 DOM
  - **统计**：时间范围可切换（近 7/30/90 天或全部），包含分数趋势折线、题型正确率、分数区间分布、难度正确率环形，以及答题次数、平均/最高得分率、连续打卡天数、每题平均耗时等总览指标与薄弱环节排行

- **间隔重复**：交卷后题目按题干指纹进入题库，由 FSRS 排程下次复习时间；命令面板或标题菜单的「复习到期题目」可直接复习到期内容

### 设置面板

左侧导航栏 + 右侧内容区，6 个独立设置分区：

1. **AI 服务**：端点 CRUD（名称/提供商/协议/Base URL/API Key），每个端点下嵌套管理模型（名称/温度/MaxTokens），端点内模型名去重，测试连接（端点+模型级联选择），全局超时与 JSON Schema 开关
2. **AI 身份**：出题者/审题者/判题者三角色卡片，端点+模型级联选择，不同角色推荐使用不同模型但允许相同
3. **题目与答题**：题型开关、难度分布（总数+各难度题数+校验）、超纲比例、语言（中文/英文）、倒计时开关与时长、面板宽度
4. **提示词**：出题/审题/判分/分析四个提示词编辑器，支持重置为默认
5. **热力图**：热力图预览 + 聚合方式选择 + 配色区间管理
6. **数据管理**：清除成绩记录、清除答题进度

## 📦 安装

### 方法一：思源集市

（上架后可通过思源「集市-插件」搜索 RecallGen 安装）

### 方法二：手动安装

1. 下载 `package.zip`，解压到 `思源数据目录/data/plugins/siyuan-recallgen/`
2. 在思源「设置-集市-插件」中启用「知了·RecallGen」
3. 点击插件旁的齿轮图标配置 AI 端点

## 🚀 快速上手

1. **配置 AI**：打开设置 →「AI 服务」→ 填写 Base URL 和 API Key → 添加模型 → 点击「测试连接」
2. **设置角色**：「AI 身份」→ 为出题者/审题者/判题者选择模型（可全部使用同一模型）
3. **生成题目**：在任意笔记文档中，右键块图标或点击文档标题图标 →「生成复习题」
4. **答题**：自动打开的 Tab 中逐题作答，编程题使用内置代码编辑器
5. **交卷**：点击「交卷」按钮 → 客观题即时判分，主观题/编程题 AI 判分 → 查看结果
6. **查看历史**：右上角知了图标 → 复习记录 Tab → 点击记录回看完整结果
7. **热力图**：设置 →「热力图」分区查看成绩日历

## 🏗️ 技术架构

### 技术栈

| 组件 | 技术 | 版本 |
|------|------|------|
| 前端框架 | Svelte | 5.57+ |
| 构建工具 | Vite | 7.3+ |
| 类型系统 | TypeScript | 5.9+ |
| 样式与组件 | Tailwind CSS 4 + shadcn-svelte（bits-ui） | 4.3+ / 1.7+ |
| 图表 | 自绘 SVG + CSS（无图表库依赖） | — |
| 思源 SDK | siyuan | 1.2.3 |
| 代码编辑器 | CodeMirror 6 | 6.x |
| 数学渲染 | KaTeX | 0.18.1 |
| Markdown 渲染 | marked | 18.0.9 |
| JSON 修复 | jsonrepair | 3.15+ |
| HTML 净化 | DOMPurify | 3.4+ |
| 单元测试 | Vitest | 4.1+ |
| 包管理器 | pnpm | 11+ |

### 架构要点

- **单文件打包**：Vite 配置 `inlineDynamicImports: true`，输出单个 `dist/index.js`，适配思源插件加载器
- **AI 网络代理**：所有 AI 请求经 `forwardProxy`（内核 HTTP 代理），`payloadEncoding: 'json'` 传递 JSON 对象，避免 CORS，API Key 不暴露前端
- **数据持久化**：使用思源 `saveData`/`loadData`（非 localStorage），支持多端同步
  - `recallgen-config.json`：插件配置
  - `recallgen-scores-index.json`：成绩索引（含按题型/难度的聚合值，历史列表与统计图表只读它）
  - `recallgen-scores-YYYY-MM.json`：按月分片的成绩明细（题目、判分、分析），按需加载
  - `recallgen-progress.json`：答题进度（未交卷的会话）
- **异步存储基类**：`AsyncStore` 统一处理读串行化、写串行化、读写不互相覆盖、写入失败上抛；配置写入按 400ms 合并，避免每次按键都重写配置文件；答题进度按 30 天 TTL 自动清理
- **Tab 状态机**：`configuring → loading_generating → answering → loading_grading → result`
- **UI 组件**：全部使用 shadcn-svelte 组件（Button/Card/Badge/Input/Select/Switch/Tabs/Table/AlertDialog/DropdownMenu/Progress/Skeleton 等，基于 bits-ui）。shadcn 的语义变量映射到思源 `--b3-*`，因此明暗主题自动跟随；`dark:` 变体绑定思源的 `.theme-dark`
- **样式隔离**：**刻意不引入 Tailwind 的 preflight**——思源本体与插件共享同一文档，全局重置会破坏思源界面。只引入 theme 与 utilities 两个 layer，并把工具类依赖的重置收窄到插件容器 `.rg-scope` 内；KaTeX 自带的 `body{counter-reset}` 规则也改写为容器作用域，保证对思源全局样式零侵入
- **Tab 恢复**：思源重启时恢复自定义 Tab，`mode='generate'` 的 Tab 自动检测已有进度并恢复为答题状态，避免重新生成
- **公式渲染**：KaTeX 样式与字体随插件打包（仅 woff2，共约 296KB），不再依赖 CDN，离线可用；渲染走「marked → DOMPurify 净化 → 回填 KaTeX」的顺序，净化时公式还是占位符，既拦住了笔记/AI 文本里的脚本注入，又不会误伤 KaTeX 生成的 MathML

### 项目结构

```
src/
├── index.ts                    # 插件入口：生命周期、Tab 注册（mount/unmount）、服务组装
├── index.css 的源头 app.css     # Tailwind v4 入口 + shadcn 语义变量映射 + .rg-scope 收窄重置
├── api.ts                      # 思源 API 封装（仅保留实际使用：forwardProxy、块、SQL、导出）
├── test/
│   ├── siyuan-stub.ts          # siyuan 包替身（该包只有类型声明，无运行时实现）
│   └── setup-i18n.ts           # 单测统一加载真实中文字典
├── types/
│   ├── config.ts               # 配置类型、默认值、ConfigPatch、旧配置迁移
│   └── quiz.ts                 # 题目/作答/判分/成绩索引与明细类型
└── lib/
    ├── ai/
    │   ├── client.ts           # AI 调用（三协议、超时看门狗、指数退避重试、错误分类）
    │   ├── errors.ts           # 错误 → 「标题 + 建议 + 原文」的展示映射
    │   ├── schema.ts           # JSON Schema 与宽松解析（parseJsonLoose）
    │   ├── scaffold.ts         # 提示词脚手架文案（中英双份，跟随输出语言）
    │   └── prompts.ts          # 生成/审题/重生/判分/分析/答疑消息构建
    ├── quiz/
    │   ├── generator.ts        # 出题 + 审题循环 + 逐题容错校验与类型收敛
    │   ├── grader.ts           # 判分（客观本地 + 主观 AI，并发 ≤4）
    │   ├── selector.ts         # 触发入口注册（菜单/命令/事件）与内容选取
    │   ├── content.ts          # 文档批量导出（并发 + 顺序保持 + 字符预算）
    │   ├── stats.ts            # 成绩聚合（按题型/难度）与索引条目派生
    │   ├── export.ts           # 成绩导出（JSON / CSV / Markdown）
    │   ├── charts.ts           # 统计图表的数据准备（纯函数）
    │   ├── chart-geometry.ts   # 折线与环形的几何计算（纯函数）
    │   ├── paging.ts           # 历史记录分段渲染
    │   ├── bank.ts             # 题库、题干指纹与 FSRS 排程
    │   ├── service.ts          # QuizService 接口（QuizPanel 与后端解耦）
    │   ├── docWriter.ts        # 题目写入思源文档（IAL 标记、折叠答案）
    │   └── dateRange.ts        # 日期范围查询（SQL created 字段）
    ├── editor/
    │   └── codemirror.ts       # CodeMirror 6 编辑器（语言包按需导入、主题跟随思源）
    ├── i18n/
    │   └── index.ts            # t() 翻译（占位符全局替换、字典回退）
    ├── storage/
    │   ├── store.ts            # AsyncStore 基类（读写串行化、合并写入、错误上抛）
    │   ├── config.ts           # 配置存储（合并写入 + 旧配置迁移）
    │   ├── scores.ts           # 成绩存储（索引 + 按月分片 + v1 迁移）
    │   ├── progress.ts         # 答题进度（30 天 TTL 自动清理）
    │   └── index.ts            # 存储模块导出
    ├── ui/
    │   ├── QuizPanel.svelte    # 答题主面板（状态机、倒计时、确认对话框）
    │   ├── QuestionView.svelte # 单题渲染（Markdown+LaTeX+代码编辑器）
    │   ├── ResultPanel.svelte  # 结果面板（统计卡片、题目详情、AI 答疑）
    │   ├── HistoryPanel.svelte # 历史记录（搜索/筛选/导出/删除，三种视图）
    │   ├── Heatmap.svelte      # 热力图（跟随主题、窄屏横向滚动、可聚焦查看）
    │   ├── ProgressBar.svelte  # 进度条（确定/不确定两种形态）
    │   ├── SettingPanel.svelte # 设置面板外壳（左侧导航）
    │   ├── SettingsAI.svelte   # 端点/模型管理与测试连接
    │   ├── SettingsAIRoles.svelte
    │   ├── SettingsGeneral.svelte
    │   ├── SettingsPrompts.svelte
    │   ├── SettingsHeatmap.svelte
    │   ├── SettingsData.svelte
    │   ├── latex.ts            # Markdown + LaTeX → 安全 HTML（DOMPurify 净化）
    │   ├── LineChart.svelte    # 折线图（SVG，时间轴）
    │   ├── DonutChart.svelte   # 环形图（SVG 弧段 + 文本图例）
    │   └── StatsPanel.svelte   # 统计仪表盘（图表容器）
    ├── components/ui/          # shadcn-svelte 组件（CLI 生成，可按需修改）
    ├── utils.ts                # cn() 与 shadcn 所需类型辅助
    └── promise-pool.ts         # 并发上限池
tests/                          # 与源码同目录的 *.test.ts（19 个文件 / 344 个用例）
```

## 💻 开发

### 环境要求

- Node.js ≥ 24.11
- pnpm ≥ 11
- 思源笔记 ≥ 3.7.0

### 开发流程

```bash
# 安装依赖
pnpm install

# 开发模式（watch + livereload）
pnpm run dev

# 生产构建（输出到 dist/ 和思源插件目录）
pnpm run build

# 创建开发链接（链接到思源插件目录）
pnpm run make-link

# 一键安装（构建 + 安装到思源）
pnpm run make-install
```

### 构建产物

- `dist/index.js`：单文件打包（inlineDynamicImports），约 1.52MB（gzip 484KB）
- `dist/index.css`：样式文件（含 KaTeX 样式），约 74KB（gzip 12KB）
- `dist/fonts/`：KaTeX 字体（20 个 woff2，约 296KB）
- `dist/icon.png`：插件图标
- `dist/plugin.json`：插件清单
- `package.zip`：打包压缩文件

### 开发注意事项

- **npm/npx 不可用**：本环境 MSYS2 bash 中 npm 路径不可执行，必须使用 `pnpm` 或 `pnpm exec`
- **SiYuan SDK 补丁**：`siyuan@1.2.3` 存在 TS6196 未使用导入问题，通过 `patches/siyuan@1.2.3.patch` 修复（`pnpm-workspace.yaml` 配置 `patchedDependencies`）
- **Vite 配置**：`output.inlineDynamicImports: true` 强制单文件输出；`viteStaticCopy` 复制 `icon.png`；`optimizeDeps.include` 预打包 CodeMirror 语言包
- **Svelte 5**：组件挂载用 `mount`/`unmount`（`new Component()` 与 `$destroy()` 已不可用）；`mount()` 不再暴露 `$on`，插件入口与组件之间统一改用回调属性（`onsave`、`onchange` 等）；新组件一律使用 runes（`$props`/`$state`/`$derived`/`$effect`）
- **质量门禁**：`pnpm run typecheck`（svelte-check）、`pnpm run format:check`（prettier）、`pnpm test`（vitest）、`pnpm run build`；CI 在 push/PR 上全部执行，并在 tag 发布前校验 tag 与 `plugin.json` 版本一致
- **输出目录**：生产构建默认输出到 `dist/`；需要直接构建到思源插件目录时，复制 `.env.local.example` 为 `.env.local` 并填写 `OUTPUT_DIR`（该文件已被 gitignore）
- **思源插件加载器**：使用浏览器模块加载（非 Node require），Rollup code-split 产生的 `require()` 存根会导致运行时失败

## 📊 数据流

```
用户选中笔记
    │
    ▼
QuizSelector 触发 → openQuizTab(QuizTabData)
    │
    ▼
QuizPanel onMount
    ├─ mode='generate'   → startGenerate()
    ├─ mode='dateGenerate' → configuring 表单 → loadDateRangeContent → startGenerate()
    ├─ mode='resume'     → loadProgress → answering
    └─ mode='review'     → 从 ScoreRecord 恢复 → result
    │
    ▼
generateQuestions(config, content, onProgress)
    ├─ 出题者生成全部题目 (tools/function calling)
    ├─ 审题者审查 → 不通过的题目发回出题者重生（最多3轮）
    └─ validateQuestions 容错校验
    │
    ▼
用户答题 → scheduleSave (800ms防抖保存进度)
    │
    ▼
交卷 → gradeAll
    ├─ 客观题本地判分 (即时)
    └─ 主观题/编程题 AI 判分 (progress callback)
    │
    ▼
saveScore (成绩立即保存, 不受分析影响)
clearProgress (清除答题进度)
    │
    ▼
analyze → AI 薄弱点分析 (失败不影响成绩)
    │
    ▼
ResultPanel (三标签: 题目列表/薄弱点分析/学习建议)
    ├─ AI 答疑 (全局, 使用判题者模型)
    ├─ 保存到文档 (全部/仅错题)
    └─ 放弃保存 (关闭Tab)
    │
    ▼
成绩记录 → recallgen-scores-index.json + recallgen-scores-YYYY-MM.json（按月分片）
    ├─ 热力图 (SettingsHeatmap)
    └─ 历史记录 (HistoryPanel → review 回看)
```

## 📝 配置说明

### AI 配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| endpoints | AIEndpoint[] | 1 个默认端点 | API 连接配置（名称/提供商/协议/URL/Key） |
| models | AIModel[] | 1 个默认模型 | 模型配置（名称/端点/温度/MaxTokens） |
| roles | AIRoles | 全部 m-default | 三角色各自指向的模型 ID |
| timeout | number | 120000 | forwardProxy 超时（毫秒） |
| jsonSchemaEnabled | boolean | true | true=tools/function calling，false=json_object |
| testModelId | string | m-default | 测试连接使用的模型 |
| testPrompt | string | 请用一句话简要介绍你自己 | 测试连接的提示词 |

### 通用配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| allowedTypes | QuestionType[] | 全部6种 | 允许生成的题型 |
| difficulty | {total, easy, medium, hard} | {15, 6, 6, 3} | 题数与难度分布 |
| extraScopePct | number | 20 | 超纲题占比 (%) |
| language | "zh" / "en" | zh | AI 输出语言 |
| countdownEnabled | boolean | true | 答题倒计时开关 |
| countdownMinutes | number | 30 | 倒计时分钟数 |
| panelWidth | number | 1100 | 答题面板宽度 (px) |
| storageLocation | "sibling" / "notebook" | sibling | 题目保存位置 |
| notebookId | string | "" | 指定笔记本（storageLocation=notebook 时生效） |

### 热力图配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| enabled | boolean | true | 热力图开关 |
| metric | "max" / "avg" | avg | 每日聚合方式 |
| ranges | ScoreRange[] | GitHub 绿色色阶 | 分数区间配色 |

## 🧠 间隔重复与题库

交卷后，每道题都会按题干指纹进入题库，并由 [FSRS](https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler) 算法安排下次复习时间（使用成熟实现 `ts-fsrs`）：

| 得分率 | FSRS 评分 | 效果 |
|--------|-----------|------|
| ≥ 90 | 轻松（Easy） | 间隔拉得最长 |
| 75-89 | 良好（Good） | 正常推进 |
| 60-74 | 勉强（Hard） | 间隔增长较慢 |
| < 60 | 重来（Again） | 很快再次出现 |

- **入口**：命令面板或文档标题菜单 →「复习到期题目」。该流程不调用 AI 出题，直接取到期题目；主观题与编程题的判分仍需 AI
- **去重**：题干经归一化（统一大小写、去掉空白与中英文标点）后哈希，因此「1+1=?」与「1 + 1 = ？ 」会被识别为同一道题
- **保留进度**：从同一篇笔记再次生成时，已存在的题目只更新题面与来源，复习排程与作答历史不会被清零
- **掌握度**：正确率与稳定性各占一半，用于题库概览与清理策略
- **自动清理**：插件加载时会清理「超过 180 天未考且掌握度已达 85」的题目，避免题库无限增长
- **数据管理**：设置 →「数据管理」可查看题库规模（总数与到期数）并清空题库（带二次确认）

> 题目会携带 1-3 个知识点标签（由 AI 生成），因此统计页的薄弱环节可以按**题型**、**难度**与**知识点**三个维度给出排行。较早的记录没有标签，不会出现在知识点维度中。

### 数据统计

历史面板的「统计」视图提供以下图表，数据全部取自成绩索引中的聚合值，不加载题目与判分明细：

| 图表 | 说明 |
|------|------|
| 分数趋势 | 每次答题的得分率随时间变化（时间轴折线） |
| 题型正确率 | 各题型的达标比例，按达标率着色 |
| 分数分布 | 0-59 / 60-69 / 70-79 / 80-89 / 90-100 五个区间的答题次数 |
| 难度正确率 | 初级/中级/高级各自的达标比例（环形） |
| 薄弱环节 | 按达标率从低到高排出的薄弱题型、薄弱难度与薄弱知识点，样本少于 2 题的组合不参与排名 |

总览指标：答题次数与累计题量、平均与最高得分率、当前连续打卡与历史最长连续、每题平均耗时与累计活跃天数。

图表用 SVG 与 CSS 直接绘制，不引入图表库：

- **配色**全部走 CSS 变量与 Tailwind 类，明暗主题自动跟随，不需要主题监听与重绘
- **响应式**由 CSS 承担（折线图用 `viewBox` 缩放，条形与柱形用百分比宽度/高度），无需监听容器尺寸
- **可访问性**：数值与标签本身就是文本；装饰性的条形与柱形标记为 `aria-hidden`，折线图与环形图带 `aria-label`，环形图另有含数值的文本图例，并额外提供「最近记录」文本列表
- 折线与环形图的几何计算（坐标映射、圆弧路径、刻度）抽成纯函数并有单测覆盖

## 🔄 近期重构

本轮重构把插件从「Svelte 4 + 手写 CSS 类」迁移到「Svelte 5 + Tailwind 4 + shadcn-svelte」，并修掉了一批正确性问题。

### 正确性与安全

- **渲染安全**：Markdown 渲染此前未做净化，笔记或 AI 输出中的 `<img onerror>`、`<script>` 可在思源桌面端执行；现经 DOMPurify 净化后再注入
- **公式渲染**：修复了占位符序号错配导致「第二个及以后的公式全部渲染失败」的问题；KaTeX 样式与字体改为随插件打包，不再依赖 CDN
- **AI 调用重试**：修复超时错误因按英文文案匹配而永远不会重试，以及超时看门狗定时器未清理造成的未捕获拒绝
- **出题容错**：修复「一道题不合格导致整批作废」，以及单选/多选题答案索引越界（这类题目用户永远答不对）
- **内容选取**：修复短内容确认弹窗点「取消」仍会继续、笔记本超过 200 篇文档时静默截断、文档导出串行且内容无长度上限
- **数据安全**：清空成绩/进度改为二次确认；配置写盘失败不再静默；答题进度按 30 天自动清理
- **设置面板**：修复新增模型名恒为空字符串、重名时输入框与配置脱钩、题型可被全部取消勾选、以及每次按键都重写配置文件

### 存储结构

成绩由「单个文件装下全部记录、每次交卷全量重写」改为「轻量索引 + 按月分片明细」：
历史列表与统计只读索引（不含题目与判分明细），交卷写入量与该月记录数成正比。首次启动会自动迁移旧文件并保留备份。

### 交互与界面

- 全部界面改用 shadcn-svelte 组件，删除四百余行手写 CSS 类
- 修复深色主题下多处硬编码颜色导致的不可读
- 修复热力图提示永远不可见、以及窄屏下单元格被压到不足 4px
- 修复答题过程中修改设置不生效、换题后代码编辑器残留上一题内容
- 修复「薄弱点分析」与「学习建议」两个标签页显示同一段文本
- 补齐空态、加载态（骨架屏）、错误态（标题 + 可操作建议 + 原文）与键盘可达性
- 提示词脚手架与默认提示词改为跟随「输出语言」设置

## 📄 许可证

MIT License

## 👤 作者

Solathis
