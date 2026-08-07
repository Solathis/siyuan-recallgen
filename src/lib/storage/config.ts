import type { StoragePlugin } from "./store";
import type { RecallGenConfig } from "@/types/config";
import { getDefaultConfig, migrateAIConfig } from "@/types/config";
import { AsyncStore } from "./store";

const CONFIG_NAME = "recallgen-config.json";

/**
 * 配置存储：内存缓存 + 串行化落盘。
 * safe for concurrent calls.
 */
export class ConfigStore extends AsyncStore {
    private config: RecallGenConfig | null = null;

    constructor(plugin: StoragePlugin) {
        super(plugin, CONFIG_NAME);
    }

    async load(): Promise<RecallGenConfig> {
        const merged = this.mergeDefaults(await this.read<Partial<RecallGenConfig>>({}));
        this.config = merged;
        return merged;
    }

    get(): RecallGenConfig {
        if (!this.config) {
            // 兜底：未 load 时返回默认，避免上层崩溃
            return getDefaultConfig();
        }
        return this.config;
    }

    set(patch: Partial<RecallGenConfig>): void {
        if (!this.config) {
            this.config = getDefaultConfig();
        }
        this.config = {
            ai: patch.ai ?? this.config.ai,
            prompts: { ...this.config.prompts, ...patch.prompts },
            general: { ...this.config.general, ...patch.general },
            heatmap: { ...this.config.heatmap, ...patch.heatmap },
        };
        void this.write(this.config);
    }

    /** 用默认值补齐缺失字段，兼容旧版配置 */
    private mergeDefaults(partial: Partial<RecallGenConfig>): RecallGenConfig {
        const def = getDefaultConfig();
        return {
            ai: migrateAIConfig(partial.ai),
            prompts: { ...def.prompts, ...partial.prompts },
            general: { ...def.general, ...partial.general },
            heatmap: { ...def.heatmap, ...partial.heatmap },
        };
    }
}
