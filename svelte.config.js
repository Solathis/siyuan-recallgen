import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
    preprocess: vitePreprocess(),
    // 不再全局屏蔽 a11y 警告：这些警告此前被压制，实际存在的问题已在
    // svelte-check 中全部修掉，保留警告可见性可以避免回归。
};
