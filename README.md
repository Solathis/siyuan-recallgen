# RecallGen

AI-powered quiz generation and spaced review plugin for SiYuan notes.

## Features

- Select note content and generate multi-type quizzes (single/multiple choice, fill-blank, true-false, subjective, coding)
- Built-in answer panel with CodeMirror 6 code editor
- Local grading for objective questions, AI grading for subjective/coding questions
- Weak-point analysis and review guidance
- Quizzes saved as SiYuan documents; score calendar heatmap visualization

## Development

```bash
pnpm install
pnpm run dev      # watch mode + livereload
pnpm run build    # production build -> dist/ + package.zip
pnpm run make-link  # link to SiYuan plugins dir
```

## Tech Stack

TypeScript + Svelte 4 + Vite 5, based on the [plugin-sample-vite-svelte](https://github.com/siyuan-note/plugin-sample-vite-svelte) template.
