import type { StoragePlugin } from "./store";
import type { ConfigPatch, RecallGenConfig } from "@/types/config";
import { getDefaultConfig, migrateAIConfig } from "@/types/config";
import { AsyncStore } from "./store";

const CONFIG_NAME = "recallgen-config.json";

/** 设置面板每次按键都会派发保存，合并窗口内只落盘一次 */
const COALESCE_MS = 400;

/**
 * 配置存储：内存缓存 + 串行化落盘。
 *
 * 写入默认走合并（COALESCE_MS 内的多次修改只落盘一次），
 * 因此 get() 始终返回最新内存值，磁盘上的内容可能落后于内存几百毫秒。
 * 关键路径可用 flush() 等待落盘，插件卸载前由调用方调用 flushDeferred()。
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
        // 兜底：未 load 时返回默认，避免上层崩溃
        return this.config ?? getDefaultConfig();
    }

    /**
     * 更新配置。返回的 Promise 在本次（或本批合并后的）落盘完成时 settle，
     * 失败时 reject——调用方必须处理，否则写盘失败会被静默吞掉。
     */
    set(patch: ConfigPatch, opts: { immediate?: boolean } = {}): Promise<void> {
        const base = this.config ?? getDefaultConfig();
        this.config = {
            ai: { ...base.ai, ...patch.ai },
            prompts: { ...base.prompts, ...patch.prompts },
            general: { ...base.general, ...patch.general },
            heatmap: { ...base.heatmap, ...patch.heatmap },
        };
        const snapshot = this.config;
        if (opts.immediate) {
            return this.write(snapshot);
        }
        return this.writeDeferred(() => snapshot, COALESCE_MS);
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
