import { resolve } from "path";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import livereload from "rollup-plugin-livereload";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import zipPack from "vite-plugin-zip-pack";
import fg from "fast-glob";

import vitePluginYamlI18n from "./yaml-plugin";

const env = process.env;
const isSrcmap = env.VITE_SOURCEMAP === "inline";
const isDev = env.NODE_ENV === "development";
const outputDir = isDev ? "dev" : "dist";

console.log("isDev=>", isDev);
console.log("isSrcmap=>", isSrcmap);
console.log("outputDir=>", outputDir);

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
        }
    },

    plugins: [
        svelte(),

        vitePluginYamlI18n({
            inDir: "public/i18n",
            outDir: `${outputDir}/i18n`
        }),

        viteStaticCopy({
            targets: [
                { src: "./README*.md", dest: "./" },
                { src: "./docs/*.md", dest: "./docs" },
                { src: "./plugin.json", dest: "./" },
                { src: "./preview.png", dest: "./" },
                { src: "./icon.png", dest: "./" }
            ],
        }),
    ],

    define: {
        "process.env.DEV_MODE": JSON.stringify(isDev),
        "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV)
    },

    optimizeDeps: {
        // 预构建 CodeMirror 语言包，避免 dev 模式动态 import 解析失败
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
        outDir: outputDir,
        emptyOutDir: false,
        minify: true,
        sourcemap: isSrcmap ? "inline" : false,

        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            fileName: () => "index.js",
            formats: ["cjs"],
        },
        rollupOptions: {
            plugins: isDev ? [
                livereload(outputDir),
                watchExternalFiles([
                    "public/i18n/**",
                    "./README*.md",
                    "./docs/*.md",
                    "./plugin.json"
                ])
            ] : [
                zipPack({
                    inDir: "./dist",
                    outDir: "./",
                    outFileName: "package.zip"
                })
            ],

            external: ["siyuan", "process"],

            output: {
                entryFileNames: "[name].js",
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === "style.css") {
                        return "index.css";
                    }
                    return assetInfo.name;
                },
            },
        },
    }
});

function watchExternalFiles(patterns: string[]) {
    return {
        name: "watch-external",
        async buildStart() {
            const files = await fg(patterns);
            for (const file of files) {
                this.addWatchFile(file);
            }
        }
    };
}
