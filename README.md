# 知了 · RecallGen

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
- **成绩自动记录**：交卷时立即保存成绩到 `recallgen-scores.json`，不受后续分析成败影响
- **复习记录 Tab**：右上角图标打开历史记录面板，支持按日期/按来源分组，缩略图/列表/表格三种视图，点击记录可回看完整结果

### 设置面板

左侧导航栏 + 右侧内容区，5 个独立设置分区：

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
| 前端框架 | Svelte | 4.2+ |
| 构建工具 | Vite | 5.2+ |
| 类型系统 | TypeScript | 5.1+ |
| 思源 SDK | siyuan | 1.2.3 |
| 代码编辑器 | CodeMirror 6 | 6.x |
| 数学渲染 | KaTeX | 0.18.1 |
| Markdown 渲染 | marked | 18.0.9 |
| JSON 修复 | jsonrepair | 3.15+ |
| 包管理器 | pnpm | 11+ |

### 架构要点

- **单文件打包**：Vite 配置 `inlineDynamicImports: true`，输出单个 `dist/index.js`，适配思源插件加载器
- **AI 网络代理**：所有 AI 请求经 `forwardProxy`（内核 HTTP 代理），`payloadEncoding: 'json'` 传递 JSON 对象，避免 CORS，API Key 不暴露前端
- **数据持久化**：使用思源 `saveData`/`loadData`（非 localStorage），支持多端同步
  - `recallgen-config.json`：插件配置
  - `recallgen-scores.json`：成绩记录（含题目、答案、评语、分析）
  - `recallgen-progress.json`：答题进度（未交卷的会话）
- **异步存储基类**：`AsyncStore` 实现写入串行化（Promise 链），内存缓存 + 磁盘持久化，并发安全
- **Tab 状态机**：`configuring → loading_generating → answering → loading_grading → result`
- **UI 组件**：shadcn 风格的 Svelte 组件（Card/Button/Badge/Field/Progress/Separator/Tooltip 等），使用思源 `--b3-*` CSS 变量，主题原生一致，无 Tailwind 依赖
- **Tab 恢复**：思源重启时恢复自定义 Tab，`mode='generate'` 的 Tab 自动检测已有进度并恢复为答题状态，避免重新生成
- **LaTeX CSS**：KaTeX 样式通过 CDN `<link>` 动态注入（非 Vite import），避免字体文件 base64 内联导致 CSS 体积膨胀

### 项目结构

```
src/
├── index.ts                    # 插件入口：生命周期、Tab 注册、服务组装
├── index.scss                  # 全局样式（rg-* 组件类映射思源变量）
├── api.ts                      # 思源 API 封装（forwardProxy、块操作、SQL、导出）
├── types/
│   ├── config.ts               # 配置类型与默认值
│   └── quiz.ts                 # 题目/答题/判分/成绩类型
├── lib/
│   ├── ai/
│   │   ├── client.ts           # AI 调用（三协议、重试、超时、forwardProxy）
│   │   ├── schema.ts           # JSON Schema 定义与宽松解析（parseJsonLoose）
│   │   └── prompts.ts          # 提示词构建（生成/审题/重生/判分/分析/答疑）
│   ├── quiz/
│   │   ├── generator.ts        # 出题+审题循环+容错校验
│   │   ├── grader.ts           # 判分（客观本地+主观AI）
│   │   ├── selector.ts         # 触发入口注册（菜单/命令/事件）
│   │   ├── service.ts          # QuizService 接口（QuizPanel 与后端解耦）
│   │   ├── docWriter.ts        # 题目写入思源文档（IAL 标记）
│   │   └── dateRange.ts        # 日期范围查询（SQL created 字段）
│   ├── editor/
│   │   └── codemirror.ts       # CodeMirror 6 编辑器（语言包动态导入）
│   ├── storage/
│   │   ├── store.ts            # AsyncStore 基类（串行化写入+缓存）
│   │   ├── config.ts           # 配置存储（mergeDefaults 迁移）
│   │   ├── scores.ts           # 成绩存储
│   │   ├── progress.ts         # 答题进度存储
│   │   └── index.ts            # 存储模块导出
│   └── ui/
│       ├── QuizPanel.svelte    # 答题主面板（状态机）
│       ├── QuestionView.svelte # 单题渲染（Markdown+LaTeX+编辑器）
│       ├── ResultPanel.svelte  # 结果面板（三标签+AI答疑）
│       ├── ChatPanel.svelte     # 题目级AI答疑对话
│       ├── ProgressBar.svelte   # 生成/判分进度条
│       ├── Heatmap.svelte       # 热力图组件
│       ├── HistoryPanel.svelte  # 历史记录面板
│       ├── SettingPanel.svelte  # 设置面板（左侧导航）
│       ├── SettingsAI.svelte    # AI端点/模型管理
│       ├── SettingsAIRoles.svelte # AI角色配置
│       ├── SettingsGeneral.svelte # 题目与答题设置
│       ├── SettingsPrompts.svelte # 提示词编辑
│       ├── SettingsHeatmap.svelte # 热力图设置
│       ├── SettingsData.svelte   # 数据管理
│       ├── latex.ts            # Markdown+LaTeX 渲染函数
│       └── components/         # shadcn 风格组件库
│           ├── index.ts        # CSS 类常量导出
│           └── Tabs*.svelte    # Tabs 组件（context API）
└── libs/                       # 模板工具（dialog、setting-utils）
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

- `dist/index.js`：单文件打包（inlineDynamicImports），约 1MB（gzip 360KB）
- `dist/index.css`：样式文件，约 24KB（gzip 4KB）
- `dist/icon.png`：插件图标
- `dist/plugin.json`：插件清单
- `package.zip`：打包压缩文件

### 开发注意事项

- **npm/npx 不可用**：本环境 MSYS2 bash 中 npm 路径不可执行，必须使用 `pnpm` 或 `pnpm exec`
- **SiYuan SDK 补丁**：`siyuan@1.2.3` 存在 TS6196 未使用导入问题，通过 `patches/siyuan@1.2.3.patch` 修复（`pnpm-workspace.yaml` 配置 `patchedDependencies`）
- **Vite 配置**：`output.inlineDynamicImports: true` 强制单文件输出；`viteStaticCopy` 复制 `icon.png`；`optimizeDeps.include` 预打包 CodeMirror 语言包
- **Svelte 4 限制**：markup 中 `on:event` 不能内联 TS 类型断言，需用命名处理函数；`getContext`/`setContext` 的 Symbol 必须在共享模块中声明
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
成绩记录 → recallgen-scores.json
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

## 📄 许可证

MIT License

## 👤 作者

Solathis
