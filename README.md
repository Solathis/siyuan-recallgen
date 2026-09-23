# RecallGen

> **Languages**: [简体中文](README.zh-CN.md) | **English**

> An AI-powered quiz generation and spaced review plugin for SiYuan Note — select note content to generate multi-type quizzes, answer in a built-in panel, auto-grade, and track progress with a contribution-graph heatmap.

## 📖 Overview

RecallGen is a SiYuan Note plugin that transforms your notes into reviewable quiz papers. Select a note block or trigger from a document/notebook/date range, and the plugin calls an AI model to generate various question types. After answering in a dedicated tab, objective questions are graded locally, subjective and coding questions are AI-graded, and a weakness analysis with study advice is generated. Score history is visualized as a GitHub-style heatmap, and past quizzes can be replayed from the history panel.

## ✨ Features

### Quiz Generation

- **6 Question Types**: Single choice, multiple choice, fill-in-the-blank, true/false, subjective (essay/discussion), and coding
- **Difficulty Distribution**: 1–50 questions with customizable easy/medium/hard ratio and real-time validation; counts above the per-request limit are generated in batches, then deduplicated by stem and renumbered
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
- **Single-Page All-Questions View**: All questions scroll in one page; a numbered nav bar marks answered/unanswered and jumps to a question, with previous/next buttons and a position indicator
- **Keyboard Shortcuts**: ← / → (or PageUp / PageDown) change question, Ctrl/Cmd + Enter submits; they do not fire inside inputs or the code editor
- **Coding Editor**: CodeMirror 6 with syntax highlighting, line numbers, auto-completion, and light/dark theme following SiYuan
- **Subjective Markdown Editor**: Edit/preview toggle with real-time Markdown + LaTeX rendering
- **Countdown**: Optional answer countdown timer; auto-submits when time expires
- **Auto-Save Progress**: Debounced (800ms) save to SiYuan `saveData`; resumable after closing
- **Cancel & Resume**: Cancel during generation; force-save progress on tab close during answering
- **Flagging**: mark questions you are unsure about; flags are saved with the progress
- **Run Tests**: coding questions can run their test cases against the current code, with per-case results (JavaScript only)
- **Per-question timing**: each question's time is measured and surfaced in results and statistics
- **Confirmation Dialogs**: Regenerate and submit actions require secondary confirmation
- **Date-Range Generation**: "Today's notes" and "Recent N days" generation with configurable base time (e.g., 4 AM as the day boundary for late-night note-takers)

### Grading & Results

- **Local Objective Grading**: Single/multiple choice, fill-in-the-blank, and true/false are graded instantly without AI calls
  - Multiple choice: **partial credit** by default — `(hits − wrong picks) ÷ correct options`, floored at 0; selecting everything earns nothing. Switch to all-or-nothing in Settings; a result is marked correct only at full marks, otherwise partial
  - Fill-in-the-blank: trim + case-insensitive match against any accepted answer
- **AI Subjective/Coding Grading**: Returns 0–100 score + brief comment, JSON Schema constrained
- **Result Panel** (3-tab navigation):
  - **Question List**: Score/accuracy/time stat cards, question progress bar (green=correct, red=wrong, gray=unanswered), clickable question navigation, detailed view with options (correct highlighted), user answer, correct answer, explanation, and comment
  - **Weakness Analysis**: AI-generated review guidance based on wrong questions, including knowledge-point positioning and practice directions
  - **Study Advice**: AI-generated study advice text
- **AI Q&A**: Global AI chat to ask questions about the entire quiz, with access to all questions, answers, and analysis context
- **Save to Document**: Write questions to a SiYuan document (sibling sub-doc or fixed notebook); supports "Save All", "Save Wrong Only (score < 60)", or "Discard"

### Score Records & Heatmap

- **GitHub-style Heatmap**: 7 weekday rows × up to 53 week columns showing daily quiz activity, with a switchable range (last 12 months, or any calendar year found in your records). Weeks are always Monday-aligned
- **Aggregation**: Daily max score or daily average score (configurable)
- **Color Ranges**: Default GitHub green palette, customizable with color pickers
- **Auto-Recording**: On submit the score index and the current month's detail shard are written immediately, independent of subsequent analysis. The history list loads only the lightweight index; detail is fetched on demand when reviewing
- **History Tab**: open from the top-right icon; it has **Records**, **Statistics** and **Bank** views (the statistics view opens with the activity heatmap)
  - **Records**: group by date/source, thumbnail/list/table views, search by title and source, filter by score band, export as JSON/CSV/Markdown, delete a single record with confirmation, and click a record to replay the full result. The list renders in batches of 60 with load-on-scroll, so a long history does not create a huge DOM at once
  - **Statistics**: switch the range (last 7/30/90 days or all time) and see a score-trend line, accuracy by question type, score-band distribution, accuracy by difficulty donut, plus summary metrics (quiz and question counts, average/best score, current and longest streak, time per question) and a weakest-areas ranking

- **Spaced repetition**: after submitting, questions enter the bank keyed by stem fingerprint and FSRS schedules their next review; review what is due from the command palette or title menu

### Settings Panel

Left sidebar navigation + right content area, 6 independent sections:

1. **AI Service**: Endpoint CRUD (name/provider/protocol/Base URL/API Key), nested models per endpoint (name/temperature/MaxTokens), duplicate name prevention, test connection (endpoint+model cascade select), global timeout and JSON Schema toggle
2. **AI Roles**: Three role cards (generator/reviewer/grader) with endpoint+model cascade selection; different models recommended but same allowed
3. **Quiz & Answer**: Question type toggles, difficulty distribution (total + per-difficulty + validation), extra-scope ratio, language (Chinese/English), countdown toggle and duration, panel width, multiple-choice scoring policy; the current combination can also be saved as a named **quiz preset** (apply or delete it with one click, and the active preset is marked)
4. **Prompts**: Four prompt editors (generate/review/grade/analysis), reset to default supported
5. **Heatmap**: Heatmap preview + aggregation mode + color range management
6. **Data Management**: Clear scores, quiz progress and the question bank; export/import configuration (optionally including API keys); export/import a score backup including questions and grading detail

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
| Frontend Framework | Svelte | 5.57+ |
| Build Tool | Vite | 7.3+ |
| Type System | TypeScript | 5.9+ |
| Styling & Components | Tailwind CSS 4 + shadcn-svelte (bits-ui) | 4.3+ / 1.7+ |
| Charts | Hand-drawn SVG + CSS (no chart library) | — |
| SiYuan SDK | siyuan | 1.2.3 |
| Code Editor | CodeMirror 6 | 6.x |
| Math Rendering | KaTeX | 0.18.1 |
| Markdown Rendering | marked | 18.0.9 |
| JSON Repair | jsonrepair | 3.15+ |
| HTML Sanitizing | DOMPurify | 3.4+ |
| Unit Tests | Vitest | 4.1+ |
| Package Manager | pnpm | 11+ |

### Architecture Highlights

- **Single-File Bundle**: Vite `inlineDynamicImports: true` outputs a single `dist/index.js` for SiYuan's plugin loader
- **AI Network Proxy**: All AI requests via `forwardProxy` (kernel HTTP proxy), `payloadEncoding: 'json'` passes JSON object directly, no CORS, API keys not exposed
- **Data Persistence**: Uses SiYuan `saveData`/`loadData` (not localStorage), supports multi-device sync
  - `recallgen-config.json`: Plugin configuration
  - `recallgen-scores-index.json`: Score index with per-type/per-difficulty aggregates; the history list and charts read only this file
  - `recallgen-scores-YYYY-MM.json`: Monthly detail shards (questions, grading, analysis), loaded on demand
  - `recallgen-progress.json`: Answer progress (unsaved sessions)
- **Async Store Base**: `AsyncStore` handles serialized reads/writes, prevents a read from clobbering a concurrent write, and propagates write failures. Config writes are coalesced over a 400ms window so typing in a field no longer rewrites the whole file; quiz progress expires after 30 days
- **Tab State Machine**: `configuring → loading_generating → answering → loading_grading → result`
- **UI Components**: all built on shadcn-svelte (Button/Card/Badge/Input/Select/Switch/Tabs/Table/AlertDialog/DropdownMenu/Progress/Skeleton, powered by bits-ui). shadcn semantic variables are mapped to SiYuan's `--b3-*`, so light/dark follow the host theme, and the `dark:` variant is bound to SiYuan's `.theme-dark`
- **Style isolation**: Tailwind's preflight is **deliberately not imported** — SiYuan and the plugin share one document, and a global reset would break SiYuan's own UI. Only the theme and utilities layers are imported, with the resets Tailwind relies on narrowed to the plugin container `.rg-scope`. KaTeX's own `body{counter-reset}` rule is rewritten to that scope too, so the plugin makes zero global style changes
- **Tab Restore**: SiYuan restores custom tabs on restart; `mode='generate'` tabs auto-detect existing progress and resume to answering state
- **Formula rendering**: KaTeX styles and fonts ship with the plugin (woff2 only, ~296KB) instead of a CDN, so formulas render offline. The pipeline is `marked → DOMPurify → restore KaTeX`: at sanitize time formulas are still placeholders, which blocks script injection from notes/AI text without damaging KaTeX's own MathML

### Project Structure

```
src/
├── index.ts                    # Plugin entry: lifecycle, tab registration (mount/unmount), service wiring
├── app.css                     # Tailwind v4 entry + shadcn tokens mapped to --b3-* + scoped .rg-scope preflight
├── api.ts                      # SiYuan API wrappers (only what is actually used)
├── test/
│   ├── siyuan-stub.ts          # Stand-in for the siyuan package (types only, no runtime)
│   └── setup-i18n.ts           # Loads the real Chinese dictionary for tests
├── types/
│   ├── config.ts               # Config types, defaults, ConfigPatch, legacy migration
│   └── quiz.ts                 # Question/answer/grading/score index & detail types
└── lib/
    ├── ai/                     # client.ts, errors.ts, schema.ts, scaffold.ts, prompts.ts
    ├── quiz/                   # generator.ts, grader.ts, selector.ts, content.ts, stats.ts,
    │                           # charts.ts, chart-geometry.ts, paging.ts, bank.ts, export.ts,
    │                           # service.ts, docWriter.ts, dateRange.ts
    ├── editor/codemirror.ts    # CodeMirror 6 editor (lazy language packs, theme follows SiYuan)
    ├── i18n/index.ts           # t() with global placeholder replacement and dictionary fallback
    ├── storage/                # store.ts, config.ts, scores.ts, progress.ts
    ├── ui/                     # QuizPanel, QuestionView, ResultPanel, HistoryPanel, Heatmap,
    │                           # ProgressBar, LineChart, DonutChart, StatsPanel,
    │                           # SettingPanel + 6 Settings* panels, latex.ts
    ├── components/ui/          # shadcn-svelte components (CLI-generated, editable)
    ├── utils.ts                # cn() plus the type helpers shadcn components import
    └── promise-pool.ts         # Concurrency-limited pool
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

- `dist/index.js`: Single-file bundle (inlineDynamicImports), ~1.52MB (gzip 484KB)
- `dist/index.css`: Stylesheet including KaTeX styles, ~74KB (gzip 12KB)
- `dist/fonts/`: KaTeX fonts (20 woff2 files, ~296KB)
- `dist/icon.png`: Plugin icon
- `dist/plugin.json`: Plugin manifest
- `package.zip`: Packaged zip file

### Development Notes

- **npm/npx unavailable**: In MSYS2 bash, npm path is not executable; use `pnpm` or `pnpm exec`
- **SiYuan SDK patch**: `siyuan@1.2.3` has a TS6196 unused import issue, fixed via `patches/siyuan@1.2.3.patch` (configured in `pnpm-workspace.yaml` `patchedDependencies`)
- **Vite config**: `output.inlineDynamicImports: true` forces single-file output; `viteStaticCopy` copies `icon.png`; `optimizeDeps.include` pre-bundles CodeMirror language packs
- **Svelte 5**: components are mounted with `mount`/`unmount` (`new Component()` and `$destroy()` no longer work). `mount()` does not expose `$on`, so plugin-to-component communication uses callback props (`onsave`, `onchange`, ...). New components use runes (`$props`/`$state`/`$derived`/`$effect`)
- **Quality gates**: `pnpm run typecheck` (svelte-check), `pnpm run format:check` (prettier), `pnpm test` (vitest), `pnpm run build`; CI runs all of them on push/PR and verifies the release tag matches `plugin.json`
- **Output directory**: production builds go to `dist/` by default. To build straight into your SiYuan plugin folder, copy `.env.local.example` to `.env.local` and set `OUTPUT_DIR` (that file is gitignored)
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
| multipleChoicePolicy | "partial" / "strict" | partial | Multiple-choice scoring: partial credit or all-or-nothing |
| presets | QuizPreset[] | [] | Saved quiz presets (question types + difficulty + extra scope) |

### Heatmap Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| enabled | boolean | true | Heatmap toggle |
| metric | "max" / "avg" | avg | Daily aggregation mode |
| ranges | ScoreRange[] | GitHub green palette | Score range color mapping |

## 🌐 Language Support

- **AI Output Language**: Configurable (Chinese/English) — controls the language of generated questions, grading comments, and analysis
- **UI Language**: Chinese and English are both available, switchable in Settings → Quiz & Answer

## 📊 Grading & Scoring

| Type | Scoring |
|------|---------|
| Single choice / True-false | 100 if correct, otherwise 0 |
| Multiple choice | **Partial credit** by default: `(hits − wrong picks) ÷ number of correct options`, floored at 0; selecting everything earns nothing. Switch to **all-or-nothing** in Settings (any wrong or missing pick scores 0) |
| Fill-in-the-blank | `correct blanks ÷ total blanks`; an empty string does not count |
| Subjective / Coding | AI graded (0-100); coding questions can additionally run their test cases |

- **The pass line is a single shared constant at 60**, used by the statistics, history colouring, wrong-answer filtering and weakness analysis
- The result panel distinguishes **correct (full marks) / partial / wrong / unanswered**, so a 75-point multiple choice is not shown as fully correct
- Questions are timed individually: time accumulates at each question switch or submit, capped at 5 minutes per segment so idle time is not counted. The statistics page prefers this measured value for "time per question"
- You can **flag** questions you are unsure about while answering; flags are saved with the progress and restored later
- The result panel can **retry wrong questions**: it builds a new session containing only the ones below the pass line, and both attempts are recorded separately

## ▶️ Running Coding Tests

Coding test cases can actually be executed:

- At generation time the AI provides `entry_point` (the function to call) plus `args` and `expected` for each case
- The coding area has a "Run tests" button that executes the current editor content and lists pass/fail per case, showing expected vs actual on failure
- Execution happens in a **Web Worker** with a timeout: the main thread cannot interrupt an infinite loop (it would freeze SiYuan), while a worker can be terminated
- Expected values are compared loosely — parsed as JSON first, otherwise as a string — so `42` vs `"42"` or `true` vs `"true"` are not false negatives
- **JavaScript only**; other languages report unsupported clearly. This is not a security sandbox: isolation comes from the worker being terminable, and the code being run is your own local code

## 🧠 Spaced Repetition & Question Bank

After submitting, every question enters the question bank keyed by a stem fingerprint, and its next review time is scheduled by the [FSRS](https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler) algorithm (via the mature `ts-fsrs` implementation):

| Score | FSRS rating | Effect |
|-------|-------------|--------|
| 90+ | Easy | Longest interval |
| 75-89 | Good | Normal progression |
| 60-74 | Hard | Slower interval growth |
| Below 60 | Again | Comes back soon |

- **Entry point**: command palette or document title menu → "Review due questions"; the document title menu and document tree also offer "Review due questions from this document" to limit it to that document's banked questions. This flow does not call the AI to generate questions; it takes due items straight from the bank. Grading subjective/coding answers still needs AI
- **Deduplication**: the stem is normalized (case, whitespace and CJK/Latin punctuation removed) before hashing, so "1+1=?" and "1 + 1 = ？" are recognised as the same question
- **Progress is preserved**: generating again from the same note only updates the stem and source of existing questions; the review schedule and answer history are kept
- **Mastery**: half accuracy, half stability, used for the bank overview and pruning policy
- **Automatic pruning**: on load, questions that have not been reviewed for 180 days and have reached 85 mastery are removed so the bank cannot grow without bound
- **Browse & manage**: the Bank view in the history panel supports searching by question text, filtering by state (all / due / weak) and by type, shows mastery, passed/seen counts and the next review time, and allows deleting a single question with confirmation
- **Data management**: Settings → Data shows the bank size and can clear it wholesale; scores can be exported as a full backup including questions and grading detail, and imported after moving machines or reinstalling (import only adds, never overwrites, and skips duplicates by id)

> Questions carry 1-3 knowledge-point tags generated by the AI, so the weakest-area ranking on the statistics page covers **question type**, **difficulty** and **knowledge point**. Earlier records have no tags and therefore do not appear in the knowledge-point dimension.

### Statistics

The **Statistics** view of the history panel provides the following charts. All data comes from the aggregates already stored in the score index, so no question or grading detail is loaded.

| Chart | Description |
|-------|-------------|
| Score trend | Score percentage of each quiz over time (time-axis line) |
| Accuracy by type | Pass rate per question type, coloured by pass rate |
| Score distribution | Number of quizzes in the 0-59 / 60-69 / 70-79 / 80-89 / 90-100 bands |
| Accuracy by difficulty | Pass rate for easy / medium / hard (donut) |
| Weakest areas | Weak question types, difficulty levels and knowledge points ranked by lowest pass rate; groups with fewer than 2 questions are excluded |

Summary metrics: quiz and question counts, average and best score percentage, current and longest daily streak, average time per question, and active days.

Charts are drawn directly with SVG and CSS; no chart library is used:

- **Colours** come from CSS variables and Tailwind classes, so light/dark follows automatically without theme listeners or redraws
- **Responsiveness** is handled by CSS (the line chart scales via `viewBox`, bars use percentage width/height), so no container size observation is needed
- **Accessibility**: values and labels are rendered as text; decorative bars are marked `aria-hidden`, the line and donut charts carry `aria-label`, the donut additionally has a text legend with values, and there is a "recent records" text list
- The geometry maths behind the line and donut charts (coordinate mapping, arc paths, ticks) lives in pure functions covered by unit tests

## 🔄 Recent Refactor

This round migrated the plugin from "Svelte 4 + hand-written CSS classes" to "Svelte 5 + Tailwind 4 + shadcn-svelte" and fixed a batch of correctness issues.

### Correctness & security

- **Render safety**: Markdown output was injected without sanitizing, so `<img onerror>` or `<script>` from notes or AI output could execute inside the SiYuan desktop app. It now goes through DOMPurify before injection
- **Formula rendering**: fixed a placeholder-index mismatch that made every formula after the first one fail to render. KaTeX styles and fonts now ship with the plugin instead of coming from a CDN
- **AI retry**: fixed timeouts never being retried (the old check matched English text) and an uncleaned watchdog timer that caused unhandled rejections
- **Generation tolerance**: fixed one invalid question discarding the whole batch, and out-of-range choice answer indices (questions users could never answer correctly)
- **Content selection**: fixed the "short note" confirmation ignoring Cancel, silent truncation at 200 notebook documents, and sequential unbounded document export
- **Data safety**: clearing scores/progress now requires confirmation; config write failures are no longer swallowed; quiz progress expires after 30 days
- **Settings**: fixed new models always getting an empty name, duplicate names desyncing the input from config, all question types being uncheckable, and every keystroke rewriting the config file

### Storage layout

Scores moved from "one file holding every record, fully rewritten on each submit" to "lightweight index + monthly detail shards".
The history list and charts read only the index (no questions or grading detail), and a submit writes only as much as that month holds. The old file is migrated automatically on first launch, with a backup kept.

### Interaction & UI

- Every screen now uses shadcn-svelte components; 400+ lines of hand-written CSS classes were removed
- Fixed several hard-coded colours that were unreadable in dark mode
- Fixed the heatmap tooltip being permanently invisible and cells collapsing below 4px on narrow screens
- Fixed setting changes not applying during a quiz, and the code editor keeping the previous question's content
- Fixed the "weakness analysis" and "study advice" tabs showing the same text
- Added empty, loading (skeleton) and error states (title + actionable hint + raw message) plus keyboard accessibility
- Prompt scaffolding and default prompts now follow the output-language setting

## 📄 License

MIT License

## 👤 Author

Solathis
