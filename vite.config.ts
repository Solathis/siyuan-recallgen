import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import livereload from "rollup-plugin-livereload";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import zipPack from "vite-plugin-zip-pack";
import fg from "fast-glob";

const env = process.env;
const mode = env.NODE_ENV === "development" ? "development" : "production";
const isSrcmap = env.VITE_SOURCEMAP === "inline";
const isDev = mode === "development";

/** 本地开发时可在 gitignore 的 .env.local 里指定思源插件目录，避免把机器路径写进仓库 */
const fileEnv = loadEnv(mode, process.cwd(), "");
const outputDir = isDev ? "dev" : resolveOutputDir(env.OUTPUT_DIR || fileEnv.OUTPUT_DIR || "dist");

/**
 * 解析产物目录，并保证「清空产物目录」这一步不会误删数据。
 *
 * 因为 emptyOutDir 为 true，且 OUTPUT_DIR 允许指向仓库外的思源插件目录，
 * 一旦路径写错（例如少写一级插件目录名），就会把整个目录内容删掉。
 * 所以仓库外的目标必须先被确认属于本插件，否则直接让构建失败。
 */
function resolveOutputDir(raw: string): string {
    const root = resolve(__dirname);
    const dir = resolve(root, raw);
    if (dir === root) {
        throw new Error("OUTPUT_DIR 不能指向项目根目录：构建会清空它");
    }
    if (isInside(root, dir)) return dir;

    assertSafeExternalDir(root, dir);
    return dir;
}

function isInside(root: string, target: string): boolean {
    const rel = relative(root, target);
    return rel !== "" && !rel.startsWith("..") && !rel.startsWith(`..${sep}`) && !isAbsolutePath(rel);
}

function isAbsolutePath(p: string): boolean {
    return /^([a-zA-Z]:)?[\\/]/.test(p);
}

/** 仓库外目录只有在「不存在 / 为空 / 确实是本插件」时才允许被清空 */
function assertSafeExternalDir(root: string, dir: string): void {
    if (!existsSync(dir)) return;

    // 软链到仓库内（make-link 建立的 dev/ 链接）视为安全
    let real = dir;
    try {
        real = realpathSync(dir);
    } catch {
        /* realpath 失败时按原路径判断 */
    }
    if (isInside(root, real)) return;

    const entries = readdirSync(dir);
    if (entries.length === 0) return;

    const manifest = join(dir, "plugin.json");
    if (!existsSync(manifest)) {
        throw new Error(
            `OUTPUT_DIR 指向仓库外的非空目录 ${dir}，其中没有 plugin.json。\n` +
                `构建会清空该目录，已中止。请确认路径是否写错（应指向 .../data/plugins/<插件名>）。`
        );
    }
    const expected = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8")).name;
    const actual = JSON.parse(readFileSync(manifest, "utf8")).name;
    if (actual !== expected) {
        throw new Error(
            `OUTPUT_DIR 指向的目录 ${dir} 属于插件「${actual}」，不是本插件「${expected}」。\n` +
                `构建会清空该目录，已中止。`
        );
    }
}

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
        },
    },

    plugins: [
        svelte(),

        // Tailwind v4 走 Vite 插件，不再需要 postcss/tailwind 配置文件
        tailwindcss(),

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
                    // 思源按固定文件名加载插件样式，必须叫 index.css
                    // （Vite 5 时代资源名为 style.css，Vite 7 变为 <libName>.css，故按扩展名判断）
                    if (assetInfo.name?.endsWith(".css")) {
                        return "index.css";
                    }
                    return assetInfo.name ?? "[name][extname]";
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
            const css = readFileSync(join(katexDist, "katex.min.css"), "utf8")
                // 去掉 woff/ttf 引用，只保留 woff2
                .replace(/,url\(fonts\/[^)]+\.(?:woff|ttf)\)\s*format\("(?:woff|truetype)"\)/g, "")
                // KaTeX 自带一条写入 body 的规则，改为限定在插件容器内，避免影响思源本体
                .replace(/body\{counter-reset:katexEqnNo mmlEqnNo\}/g, ".rg-scope{counter-reset:katexEqnNo mmlEqnNo}");

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
