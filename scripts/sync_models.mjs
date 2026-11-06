// 从 models.dev 拉取模型数据，裁剪成随插件发布的快照 src/lib/ai/providers/models-snapshot.json。
// 用法：pnpm sync-models（需要能访问 https://models.dev）。
// 裁剪规则与运行时的「从 models.dev 刷新」共用 src/lib/ai/providers/models.ts（Node 24 直接运行 .ts）。
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MODELS_DEV_SOURCES, modelsFromCatalog } from "../src/lib/ai/providers/models.ts";

const API = "https://models.dev/api.json";
const OUT = fileURLToPath(new URL("../src/lib/ai/providers/models-snapshot.json", import.meta.url));

const res = await fetch(API);
if (!res.ok) {
    console.error(`拉取 ${API} 失败：HTTP ${res.status}`);
    process.exit(1);
}
const api = await res.json();

const models = {};
const apis = {};
const missing = [];
for (const [preset, source] of Object.entries(MODELS_DEV_SOURCES)) {
    const provider = api[source.provider];
    if (!provider) {
        missing.push(`${preset} → ${source.provider}`);
        continue;
    }
    models[preset] = modelsFromCatalog(api, source);
    apis[preset] = typeof provider.api === "string" ? provider.api : "";
    if (models[preset].length === 0) missing.push(`${preset} → ${source.provider}（过滤后没有模型）`);
}

// 映射的服务商在 models.dev 里找不到时直接失败，不生成一份缺了某家的快照
if (missing.length > 0) {
    console.error(`models.dev 里找不到这些服务商：\n  ${missing.join("\n  ")}`);
    process.exit(1);
}

const snapshot = { source: API, fetchedAt: new Date().toISOString(), apis, models };
writeFileSync(OUT, `${JSON.stringify(snapshot, null, 4)}\n`);
const total = Object.values(models).reduce((sum, list) => sum + list.length, 0);
console.info(`已写入 ${OUT}：${Object.keys(models).length} 家服务商、${total} 个模型`);
