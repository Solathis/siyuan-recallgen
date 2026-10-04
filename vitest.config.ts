import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
    // 组件级测试需要真正编译 .svelte，因此这里也要挂载 svelte 插件
    plugins: [svelte()],
    resolve: {
        alias: [
            {
                // siyuan@1.2.3 只有类型声明，没有运行时实现，单测里用替身顶替
                find: /^siyuan$/,
                replacement: fileURLToPath(new URL("./src/test/siyuan-stub.ts", import.meta.url)),
            },
            { find: /^@\/(.*)$/, replacement: `${srcDir}/$1` },
        ],
        // jsdom 下的组件测试必须拿到 Svelte 的客户端构建：
        // 默认解析到 index-server，mount() 会直接抛 lifecycle_function_unavailable
        conditions: ["browser", "module", "import", "default"],
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        setupFiles: ["src/test/setup-i18n.ts"],
    },
});
