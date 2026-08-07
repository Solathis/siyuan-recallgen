# RecallGen

AI-powered quiz generation and spaced review plugin for SiYuan notes.

## Features

- Select note content → generate multi-type quizzes (single/multiple choice, fill-blank, true-false, subjective, coding)
- Built-in answer panel (custom Tab) with CodeMirror 6 code editor, question navigation, countdown, auto-save progress
- Local grading for objective questions; AI grading (0-100 + comment) for subjective/coding questions
- Weak-point analysis and review guidance via AI
- Quizzes saved as SiYuan documents (sub-doc or current doc append) with folded answers
- Calendar heatmap of daily scores (GitHub-style, customizable color ranges)
- Settings: AI provider (OpenAI/Ollama/custom), difficulty distribution with validation, editable prompts, heatmap config, data management
- Network via SiYuan kernel forwardProxy (no CORS, keeps API key off frontend)
- Desktop & mobile responsive

## Architecture

- AI calls via kernel `forwardProxy` (frontend → kernel HTTP), timeout 120s
- Answer panel as custom `addTab`; settings as custom Tab
- Progress & scores stored via `saveData`/`loadData` (multi-end sync)
- Tab state machine: `loading_generating → answering → loading_grading → result`

## Development

```bash
pnpm install
pnpm run dev      # watch mode + livereload
pnpm run build    # production build -> dist/ + package.zip
pnpm run make-link  # link to SiYuan plugins dir
```

Requires: Node ≥ 24.11, pnpm ≥ 11. Build produces single-file `dist/index.js` (inlineDynamicImports) for SiYuan's plugin loader.
