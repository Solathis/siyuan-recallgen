import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import livereload from "rollup-plugin-livereload";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import zipPack from "vite-plugin-zip-pack";
import fg from "fast-glob";

const env = process.env;
const mode = env.NODE_ENV === "development" ? "development" : "production";
const isSrcmap = env.VITE_SOURCEMAP === "inline";
const isDev = mode === "development";

/** 本地开发时可在 gitignore 的 .env.local 里指定思源插件目录，避免把机器路径写进仓库 */
const fileEnv = loadEnv(mode, process.cwd(), "");
const outputDir = isDev ? "dev" : env.OUTPUT_DIR || fileEnv.OUTPUT_DIR || "dist";

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
        },
    },

    plugins: [
        svelte(),

        katexLocalAssets(),

        viteStaticCopy({
            targets: [
                { src: "./README*.md", dest: "./" },
                { src: "./plugin.json", dest: "./" },
                { src: "./preview.png", dest: "./" },
                { src: "./icon.png", dest: "./" },
            ],
        }),
    ],

    define: {
        "process.env.DEV_MODE": JSON.stringify(isDev),
        "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV),
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
        emptyOutDir: true,
        minify: true,
        sourcemap: isSrcmap ? "inline" : false,

        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            fileName: () => "index.js",
            formats: ["cjs"],
        },
        rollupOptions: {
            plugins: isDev
                ? [livereload(outputDir), watchExternalFiles(["public/i18n/**", "./README*.md", "./plugin.json"])]
                : [
                      zipPack({
                          inDir: outputDir,
                          outDir: outputDir,
                          outFileName: "package.zip",
                      }),
                  ],

            external: ["siyuan", "process"],

            output: {
                entryFileNames: "[name].js",
                inlineDynamicImports: true,
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === "style.css") {
                        return "index.css";
                    }
                    return assetInfo.name;
                },
            },
        },
    },
});

function watchExternalFiles(patterns: string[]) {
    return {
        name: "watch-external",
        async buildStart() {
            const files = await fg(patterns);
            for (const file of files) {
                this.addWatchFile(file);
            }
        },
    };
}

/**
 * 把 KaTeX 样式与字体打进插件包，避免依赖 CDN：
 * 离线或 jsDelivr 不可达时公式仍能正常排版。
 *
 * 只保留 woff2（思源桌面端与移动端 WebView 均支持），
 * 丢掉 woff/ttf 可让字体体积从 1.2MB 降到约 296KB。
 */
function katexLocalAssets(): Plugin {
    const katexDist = resolve(__dirname, "node_modules/katex/dist");
    const fontsDir = join(katexDist, "fonts");

    return {
        name: "recallgen-katex-local-assets",
        enforce: "post",
        generateBundle(_options, bundle) {
            const css = readFileSync(join(katexDist, "katex.min.css"), "utf8").replace(
                /,url\(fonts\/[^)]+\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g,
                ""
            );

            let appended = false;
            for (const file of Object.values(bundle)) {
                if (file.type === "asset" && file.fileName.endsWith(".css")) {
                    file.source = `${String(file.source)}\n${css}`;
                    appended = true;
                }
            }
            if (!appended) {
                this.warn("未找到 CSS 产物，KaTeX 样式未注入");
            }

            for (const name of readdirSync(fontsDir)) {
                if (!name.endsWith(".woff2")) continue;
                this.emitFile({
                    type: "asset",
                    fileName: `fonts/${name}`,
                    source: readFileSync(join(fontsDir, name)),
                });
            }
        },
    };
}
