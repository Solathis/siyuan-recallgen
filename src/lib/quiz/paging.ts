/**
 * 历史记录的分段渲染。
 *
 * 记录很多时一次性渲染全部条目会创建大量 DOM（缩略图视图每条还带进度条），
 * 而按日期/来源分组又是变高内容，真正的虚拟滚动需要动态测量、容易出错。
 * 这里采用「分段渲染 + 触底加载」：DOM 规模有上界，分组结构保持不变。
 */

/** 一组记录 */
export interface Group<T> {
    key: string;
    items: T[];
}

/** 分段渲染结果 */
export interface LimitedGroups<T> {
    /** 截断后的分组（可能最后一组只显示部分条目） */
    groups: Group<T>[];
    /** 当前已渲染条数 */
    shown: number;
    /** 还可加载条数 */
    remaining: number;
}

/**
 * 按已渲染条数截断分组。
 * 依赖调用方保持分组的先后顺序（历史记录已按时间倒序）。
 */
export function limitGroups<T>(groups: Group<T>[], limit: number): LimitedGroups<T> {
    const total = groups.reduce((sum, g) => sum + g.items.length, 0);
    if (limit <= 0) {
        return { groups: [], shown: 0, remaining: total };
    }

    const out: Group<T>[] = [];
    let shown = 0;
    for (const group of groups) {
        if (shown >= limit) break;
        const take = Math.min(group.items.length, limit - shown);
        // 跳过空组，避免渲染出没有内容的分组标题
        if (take === 0) continue;
        out.push({ key: group.key, items: group.items.slice(0, take) });
        shown += take;
    }
    return { groups: out, shown, remaining: total - shown };
}

/** 每次加载的条数 */
export const PAGE_SIZE = 60;

/** 下一批的渲染条数（不超过总数） */
export function nextLimit(current: number, total: number, step = PAGE_SIZE): number {
    return Math.min(total, current + step);
}
