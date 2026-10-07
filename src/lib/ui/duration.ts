/**
 * 秒数 → 计时文本。
 *
 * 倒计时、答题用时、结果页用时原先各写一份（有的只算 mm:ss、有的不处理小时），
 * 超过一小时后 `Math.floor(sec/60)` 会给出 75 这样的分钟数，看着不像时间。
 */
export function formatClock(totalSeconds: number): string {
    const sec = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
