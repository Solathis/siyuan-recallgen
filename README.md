# RecallGen · Cicada

> An AI-powered quiz generation and spaced review plugin for SiYuan Note — select note content to generate multi-type quizzes, answer in a built-in panel, auto-grade, and track progress with a contribution-graph heatmap.

## 📖 Overview

RecallGen is a SiYuan Note plugin that transforms your notes into reviewable quiz papers. Select a note block or trigger from a document/notebook/date range, and the plugin calls an AI model to generate various question types. After answering in a dedicated tab, objective questions are graded locally, subjective and coding questions are AI-graded, and a weakness analysis with study advice is generated. Score history is visualized as a GitHub-style heatmap, and past quizzes can be replayed from the history panel.

## ✨ Features

### Quiz Generation

- **6 Question Types**: Single choice, multiple choice, fill-in-the-blank, true/false, subjective (essay/discussion), and coding
- **Difficulty Distribution**: 1–50 questions with customizable easy/medium/hard ratio and real-time validation
- **Extra-Scope Ratio**: 0–50% slider allowing AI to generate questions on related knowledge points beyond the note content
- **Self-Contained Questions**: Question stems include all information needed to answer (code, data, definitions) — no dependency on external note context
- **Markdown + LaTeX Rendering**: Question text and options support full Markdown syntax and `$...$` / `$$...$$` math formula rendering (KaTeX + marked)
- **Multiple Entry Points**:
  - Block context menu → "Generate Quiz"
  - Document title bar icon → "Generate Quiz" / "From Today's Notes" / "From Recent N Days"
  - Document tree right-click → same options, supports entire notebook scope
  - Command palette → search "Generate Quiz"

### Three-Role AI Architecture

The plugin supports **multi-endpoint + multi-model** configuration, with three AI roles each independently selecting a model:

| Role | Responsibility | Default Temp | Default MaxTokens |
|------|---------------|-------------|-------------------|
| Generator | Generate questions from note content | 0.7 | 16384 |
| Reviewer | Review questions for rigor and correctness | 0.3 | 4096 |
| Grader | Grade subjective/coding questions, analyze weaknesses, answer chat | 0 | 512 |

- **Review Loop**: The reviewer checks all questions; failed ones are sent back to the generator for regeneration (preserving question IDs), then re-reviewed — up to 3 rounds
- **Progress Display**: Real-time phase (generating/reviewing/regenerating), round number, and detail shown during generation

### AI Protocol Support

| Protocol | Endpoint Path | Use Case |
|----------|--------------|----------|
| Chat (OpenAI) | `/v1/chat/completions` | OpenAI and compatible APIs (new-api, one-api, etc.) |
| Responses (OpenAI) | `/v1/responses` | OpenAI Responses API |
| Messages (Anthropic) | `/v1/messages` | Anthropic Claude |

- **Structured Output**: When JSON Schema strict mode is enabled, uses OpenAI tools/function calling to enforce JSON output; when disabled, uses `response_format: json_object` + jsonrepair fault tolerance
- **Ollama Support**: Automatically skips auth headers when no API key is set
- **Timeout & Retry**: Configurable timeout (default 120s), automatic retry with exponential backoff for HTTP 429/5xx/timeout (max 2 retries)
- **Network Proxy**: All AI calls go through SiYuan kernel `forwardProxy` — no CORS issues, API keys stay off the frontend

### Answer Panel

- **Dedicated Tab**: Custom `addTab` with responsive layout for desktop and mobile; configurable panel width (600–1600px)
- **Single-Page All-Questions View**: All questions scroll in one page with a progress bar marking answered/unanswered status
- **Coding Editor**: CodeMirror 6 with syntax highlighting, line numbers, auto-completion, and light/dark theme following SiYuan
- **Subjective Markdown Editor**: Edit/preview toggle with real-time Markdown + LaTeX rendering
- **Countdown**: Optional answer countdown timer; auto-submits when time expires
- **Auto-Save Progress**: Debounced (800ms) save to SiYuan `saveData`; resumable after closing
- **Cancel & Resume**: Cancel during generation; force-save progress on tab close during answering
- **Confirmation Dialogs**: Regenerate and submit actions require secondary confirmation
- **Date-Range Generation**: "Today's notes" and "Recent N days" generation with configurable base time (e.g., 4 AM as the day boundary for late-night note-takers)

### Grading & Results

- **Local Objective Grading**: Single/multiple choice, fill-in-the-blank, and true/false are graded instantly without AI calls
  - Multiple choice: sorted array comparison
  - Fill-in-the-blank: trim + case-insensitive match against any accepted answer
- **AI Subjective/Coding Grading**: Returns 0–100 score + brief comment, JSON Schema constrained
- **Result Panel** (3-tab navigation):
  - **Question List**: Score/accuracy/time stat cards, question progress bar (green=correct, red=wrong, gray=unanswered), clickable question navigation, detailed view with options (correct highlighted), user answer, correct answer, explanation, and comment
  - **Weakness Analysis**: AI-generated review guidance based on wrong questions, including knowledge-point positioning and practice directions
  - **Study Advice**: AI-generated study advice text
- **AI Q&A**: Global AI chat to ask questions about the entire quiz, with access to all questions, answers, and analysis context
- **Save to Document**: Write questions to a SiYuan document (sibling sub-doc or fixed notebook); supports "Save All", "Save Wrong Only (score < 60)", or "Discard"

### Score Records & Heatmap

- **GitHub-style Heatmap**: Fixed 53 weeks × 7 days (371 cells) contribution graph showing the past year's daily quiz activity
- **Aggregation**: Daily max score or daily average score (configurable)
- **Color Ranges**: Default GitHub green palette, customizable with color pickers
- **Auto-Recording**: Score saved immediately on submit to `recallgen-scores.json`, independent of subsequent analysis success
- **History Tab**: Top-right icon opens the history panel; group by date or source notebook; thumbnail/list/table views; click a record to replay the full result view

### Settings Panel

Left sidebar navigation + right content area, 5 independent sections:

1. **AI Service**: Endpoint CRUD (name/provider/protocol/Base URL/API Key), nested models per endpoint (name/temperature/MaxTokens), duplicate name prevention, test connection (endpoint+model cascade select), global timeout and JSON Schema toggle
2. **AI Roles**: Three role cards (generator/reviewer/grader) with endpoint+model cascade selection; different models recommended but same allowed
3. **Quiz & Answer**: Question type toggles, difficulty distribution (total + per-difficulty + validation), extra-scope ratio, language (Chinese/English), countdown toggle and duration, panel width
4. **Prompts**: Four prompt editors (generate/review/grade/analysis), reset to default supported
5. **Heatmap**: Heatmap preview + aggregation mode + color range management
6. **Data Management**: Clear score records, clear answer progress

## 📦 Installation

### Method 1: SiYuan Marketplace

(Once published, search for "RecallGen" in SiYuan's Marketplace → Plugins)

### Method 2: Manual Install

1. Download `package.zip`, extract to `SiYuanDataDir/data/plugins/siyuan-recallgen/`
2. Enable "RecallGen" in SiYuan → Settings → Marketplace → Plugins
3. Click the gear icon next to the plugin to configure AI endpoints

## 🚀 Quick Start

1. **Configure AI**: Open Settings → "AI Service" → fill in Base URL and API Key → add model → click "Test Connection"
2. **Set Roles**: "AI Roles" → select models for generator/reviewer/grader (can all use the same model)
3. **Generate Quiz**: In any note document, right-click the block icon or click the document title icon → "Generate Quiz"
4. **Answer**: Answer questions in the auto-opened tab; use the built-in code editor for coding questions
5. **Submit**: Click "Submit" → objective questions graded instantly, subjective/coding AI-graded → view results
6. **View History**: Top-right Cicada icon → History tab → click a record to replay the full result
7. **Heatmap**: Settings → "Heatmap" section to view the score calendar

## 🏗️ Technical Architecture

### Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Frontend Framework | Svelte | 4.2+ |
| Build Tool | Vite | 5.2+ |
| Type System | TypeScript | 5.1+ |
| SiYuan SDK | siyuan | 1.2.3 |
| Code Editor | CodeMirror 6 | 6.x |
| Math Rendering | KaTeX | 0.18.1 |
| Markdown Rendering | marked | 18.0.9 |
| JSON Repair | jsonrepair | 3.15+ |
| Package Manager | pnpm | 11+ |

### Architecture Highlights

- **Single-File Bundle**: Vite `inlineDynamicImports: true` outputs a single `dist/index.js` for SiYuan's plugin loader
- **AI Network Proxy**: All AI requests via `forwardProxy` (kernel HTTP proxy), `payloadEncoding: 'json'` passes JSON object directly, no CORS, API keys not exposed
- **Data Persistence**: Uses SiYuan `saveData`/`loadData` (not localStorage), supports multi-device sync
  - `recallgen-config.json`: Plugin configuration
  - `recallgen-scores.json`: Score records (includes questions, answers, comments, analysis)
  - `recallgen-progress.json`: Answer progress (unsaved sessions)
- **Async Store Base**: `AsyncStore` implements write serialization (Promise chain), in-memory cache + disk persistence, concurrency-safe
- **Tab State Machine**: `configuring → loading_generating → answering → loading_grading → result`
- **UI Components**: shadcn-style Svelte components (Card/Button/Badge/Field/Progress/Separator/Tooltip etc.) using SiYuan `--b3-*` CSS variables, theme-native, no Tailwind dependency
- **Tab Restore**: SiYuan restores custom tabs on restart; `mode='generate'` tabs auto-detect existing progress and resume to answering state
- **LaTeX CSS**: KaTeX CSS injected via CDN `<link>` (not Vite import) to avoid base64 font bloat

### Project Structure

```
src/
├── index.ts                    # Plugin entry: lifecycle, tab registration, service assembly
├── index.scss                  # Global styles (rg-* component classes mapping SiYuan variables)
├── api.ts                      # SiYuan API wrappers (forwardProxy, block ops, SQL, export)
├── types/
│   ├── config.ts               # Config types and defaults
│   └── quiz.ts                 # Question/answer/grading/score types
├── lib/
│   ├── ai/
│   │   ├── client.ts           # AI calls (3 protocols, retry, timeout, forwardProxy)
│   │   ├── schema.ts            # JSON Schema definitions and loose parsing (parseJsonLoose)
│   │   └── prompts.ts           # Prompt builders (generate/review/regenerate/grade/analyze/chat)
│   ├── quiz/
│   │   ├── generator.ts        # Generation + review loop + fault-tolerant validation
│   │   ├── grader.ts           # Grading (objective local + subjective AI)
│   │   ├── selector.ts         # Entry point registration (menus/commands/events)
│   │   ├── service.ts          # QuizService interface (decouples QuizPanel from backend)
│   │   ├── docWriter.ts        # Write questions to SiYuan docs (IAL tagging)
│   │   └── dateRange.ts        # Date range queries (SQL created field)
│   ├── editor/
│   │   └── codemirror.ts       # CodeMirror 6 editor (dynamic language pack imports)
│   ├── storage/
│   │   ├── store.ts            # AsyncStore base (serialized writes + cache)
│   │   ├── config.ts           # Config store (mergeDefaults migration)
│   │   ├── scores.ts           # Score store
│   │   ├── progress.ts         # Answer progress store
│   │   └── index.ts            # Storage module exports
│   └── ui/
│       ├── QuizPanel.svelte    # Main answer panel (state machine)
│       ├── QuestionView.svelte # Single question rendering (Markdown+LaTeX+editor)
│       ├── ResultPanel.svelte  # Result panel (3 tabs + AI Q&A)
│       ├── ChatPanel.svelte     # Per-question AI chat
│       ├── ProgressBar.svelte   # Generation/grading progress bar
│       ├── Heatmap.svelte       # Heatmap component
│       ├── HistoryPanel.svelte  # History records panel
│       ├── SettingPanel.svelte  # Settings panel (sidebar nav)
│       ├── SettingsAI.svelte    # AI endpoint/model management
│       ├── SettingsAIRoles.svelte # AI role config
│       ├── SettingsGeneral.svelte # Quiz & answer settings
│       ├── SettingsPrompts.svelte # Prompt editors
│       ├── SettingsHeatmap.svelte # Heatmap settings
│       ├── SettingsData.svelte   # Data management
│       ├── latex.ts            # Markdown+LaTeX rendering function
│       └── components/         # shadcn-style component library
│           ├── index.ts        # CSS class constant exports
│           └── Tabs*.svelte    # Tabs component (context API)
└── libs/                       # Template utilities (dialog, setting-utils)
```

## 💻 Development

### Requirements

- Node.js ≥ 24.11
- pnpm ≥ 11
- SiYuan Note ≥ 3.7.0

### Workflow

```bash
# Install dependencies
pnpm install

# Development mode (watch + livereload)
pnpm run dev

# Production build (outputs to dist/ and SiYuan plugin dir)
pnpm run build

# Create dev link (link to SiYuan plugins dir)
pnpm run make-link

# One-step install (build + install to SiYuan)
pnpm run make-install
```

### Build Artifacts

- `dist/index.js`: Single-file bundle (inlineDynamicImports), ~1MB (gzip 360KB)
- `dist/index.css`: Stylesheet, ~24KB (gzip 4KB)
- `dist/icon.png`: Plugin icon
- `dist/plugin.json`: Plugin manifest
- `package.zip`: Packaged zip file

### Development Notes

- **npm/npx unavailable**: In MSYS2 bash, npm path is not executable; use `pnpm` or `pnpm exec`
- **SiYuan SDK patch**: `siyuan@1.2.3` has a TS6196 unused import issue, fixed via `patches/siyuan@1.2.3.patch` (configured in `pnpm-workspace.yaml` `patchedDependencies`)
- **Vite config**: `output.inlineDynamicImports: true` forces single-file output; `viteStaticCopy` copies `icon.png`; `optimizeDeps.include` pre-bundles CodeMirror language packs
- **Svelte 4 limitations**: No inline TS type assertions in `on:event` handlers; `getContext`/`setContext` Symbols must be declared in a shared module
- **SiYuan plugin loader**: Uses browser module loader (not Node require); Rollup code-split `require()` stubs cause runtime failures

## 📊 Data Flow

```
User selects note content
    │
    ▼
QuizSelector trigger → openQuizTab(QuizTabData)
    │
    ▼
QuizPanel onMount
    ├─ mode='generate'      → startGenerate()
    ├─ mode='dateGenerate'  → configuring form → loadDateRangeContent → startGenerate()
    ├─ mode='resume'        → loadProgress → answering
    └─ mode='review'        → restore from ScoreRecord → result
    │
    ▼
generateQuestions(config, content, onProgress)
    ├─ Generator creates all questions (tools/function calling)
    ├─ Reviewer checks → failed questions sent back to generator (max 3 rounds)
    └─ validateQuestions fault-tolerant validation
    │
    ▼
User answers → scheduleSave (800ms debounced progress save)
    │
    ▼
Submit → gradeAll
    ├─ Objective questions graded locally (instant)
    └─ Subjective/coding questions AI-graded (progress callback)
    │
    ▼
saveScore (score saved immediately, unaffected by analysis)
clearProgress (clear answer progress)
    │
    ▼
analyze → AI weakness analysis (failure doesn't affect score)
    │
    ▼
ResultPanel (3 tabs: Question List / Weakness Analysis / Study Advice)
    ├─ AI Q&A (global, uses grader model)
    ├─ Save to Document (all / wrong-only)
    └─ Discard (close tab)
    │
    ▼
Score record → recallgen-scores.json
    ├─ Heatmap (SettingsHeatmap)
    └─ History (HistoryPanel → review replay)
```

## 📝 Configuration Reference

### AI Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| endpoints | AIEndpoint[] | 1 default endpoint | API connection config (name/provider/protocol/URL/Key) |
| models | AIModel[] | 1 default model | Model config (name/endpoint/temperature/MaxTokens) |
| roles | AIRoles | all m-default | Model ID for each of the 3 roles |
| timeout | number | 120000 | forwardProxy timeout (ms) |
| jsonSchemaEnabled | boolean | true | true=tools/function calling, false=json_object |
| testModelId | string | m-default | Model for test connection |
| testPrompt | string | "Please introduce yourself in one sentence" | Test connection prompt |

### General Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| allowedTypes | QuestionType[] | All 6 types | Allowed question types |
| difficulty | {total, easy, medium, hard} | {15, 6, 6, 3} | Question count and difficulty distribution |
| extraScopePct | number | 20 | Extra-scope question percentage (%) |
| language | "zh" / "en" | zh | AI output language |
| countdownEnabled | boolean | true | Answer countdown toggle |
| countdownMinutes | number | 30 | Countdown minutes |
| panelWidth | number | 1100 | Answer panel width (px) |
| storageLocation | "sibling" / "notebook" | sibling | Question save location |
| notebookId | string | "" | Target notebook (when storageLocation=notebook) |

### Heatmap Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | true | Heatmap toggle |
| metric | "max" / "avg" | avg | Daily aggregation mode |
| ranges | ScoreRange[] | GitHub green palette | Score range color mapping |

## 🌐 Language Support

- **AI Output Language**: Configurable (Chinese/English) — controls the language of generated questions, grading comments, and analysis
- **UI Language**: Currently Chinese-only; i18n infrastructure is in place for future localization

## 📄 License

MIT License

## 👤 Author

Solathis
