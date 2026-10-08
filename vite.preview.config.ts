import { resolve } from "node:path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

/**
 * 预览台的 Vite 配置（与插件构建完全分开）。
 *
 * 为什么单独一份而不是复用 vite.config.ts：插件是「单文件 CJS 库」构建，
 * 带 inlineDynamicImports、externals 与 zip 打包，没有 HTML 入口，
 * 也不该为了浏览器预览去动它——那会直接改变发布产物的形态。
 *
 * 这里的 root 保持仓库根，index.html 放在 src/preview 下，因此开发地址是
 * http://localhost:5178/src/preview/ 。root 不能改成 src/preview：
 * Tailwind v4 的源码扫描范围由 Vite root 决定，root 一收窄，只有 src/preview
 * 里的类名会被生成，src/lib 下所有面板的工具类全部丢失（界面会整片塌掉），
 * 而这一点在编辑器里完全看不出来。
 *
 * 其余：产物输出到仓库根的 dist-preview（已 gitignore），不碰 dist；
 * `siyuan` 裸导入指到预览替身，否则面板一 import 就解析失败。
 */
const root = resolve(__dirname);
const previewRoot = resolve(root, "src/preview");

export default defineConfig({
    root,

    resolve: {
        alias: {
            "@": resolve(root, "src"),
            siyuan: resolve(previewRoot, "siyuan.ts"),
        },
    },

    plugins: [svelte(), tailwindcss()],

    server: {
        port: 5178,
        strictPort: true,
    },

    optimizeDeps: {
        // CodeMirror 语言包是按需 import 的，不预构建时首次进入编程题会边加载边重载
        include: [
            "@codemirror/state",
            "@codemirror/view",
            "@codemirror/commands",
            "@codemirror/language",
            "@codemirror/autocomplete",
            "@codemirror/lang-python",
            "@codemirror/lang-javascript",
            "@codemirror/lang-css",
            "@codemirror/lang-markdown",
            "@codemirror/theme-one-dark",
            "jsonrepair",
        ],
    },

    build: {
        outDir: resolve(root, "dist-preview"),
        emptyOutDir: true,
    },
});
