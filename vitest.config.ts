import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
    resolve: {
        alias: [
            {
                // siyuan@1.2.3 只有类型声明，没有运行时实现，单测里用替身顶替
                find: /^siyuan$/,
                replacement: fileURLToPath(new URL("./src/test/siyuan-stub.ts", import.meta.url)),
            },
            { find: /^@\/(.*)$/, replacement: `${srcDir}/$1` },
        ],
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
    },
});
