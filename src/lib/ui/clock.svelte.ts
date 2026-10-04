/**
 * 随时间推进的「当前时间」。
 *
 * 在 `$derived` 里直接调用 `Date.now()` 不会建立依赖：面板长期打开（思源不重启）时，
 * 「到期题目数」「最近一年窗口」这类派生值会一直停在打开那一刻。
 * 这里用一个低频定时器推进它，代价可以忽略。
 */
export function createClock(everyMs = 60_000): { readonly now: number } {
    let now = $state(Date.now());
    $effect(() => {
        const timer = setInterval(() => (now = Date.now()), everyMs);
        return () => clearInterval(timer);
    });
    return {
        get now() {
            return now;
        },
    };
}
