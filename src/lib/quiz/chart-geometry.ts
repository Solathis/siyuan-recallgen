/**
 * 图表的几何与比例计算。
 *
 * 图表本身用 SVG 与 CSS 直接绘制（不引入图表库），
 * 这里集中放其中真正需要计算的纯函数，便于单测——
 * 圆弧路径与坐标映射是最容易写错、也最难靠肉眼发现问题的部分。
 */

/** 线性映射：把 [d0, d1] 区间内的值映射到 [r0, r1] */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (value: number) => number {
    const span = d1 - d0;
    if (span === 0) return () => r0;
    return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

/**
 * 生成 0..max 的等分刻度（含首尾），共 count+1 个。
 * max 非正时返回 [0]，避免出现 NaN 刻度。
 */
export function ticks(max: number, count = 4): number[] {
    if (!Number.isFinite(max) || max <= 0) return [0];
    return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}

/** 折线上的一个点 */
export interface LinePoint {
    x: number;
    y: number;
}

export interface LineGeometry {
    points: LinePoint[];
    /** 折线路径（M/L） */
    line: string;
    /** 闭合到基线的面积路径，用于填充 */
    area: string;
}

/**
 * 由数值序列生成折线几何。
 * values 按时间顺序排列；y 轴固定 0-100（得分率）。
 */
export function lineGeometry(
    values: number[],
    width: number,
    height: number,
    padding: { top: number; right: number; bottom: number; left: number },
    min = 0,
    max = 100
): LineGeometry {
    const innerWidth = Math.max(0, width - padding.left - padding.right);
    const innerHeight = Math.max(0, height - padding.top - padding.bottom);
    const scaleY = linearScale(min, max, padding.top + innerHeight, padding.top);

    if (values.length === 0) {
        return { points: [], line: "", area: "" };
    }

    // 只有一个点时放在水平中间，避免所有点挤在左边缘
    const scaleX =
        values.length === 1
            ? () => padding.left + innerWidth / 2
            : linearScale(0, values.length - 1, padding.left, padding.left + innerWidth);

    const points = values.map((value, index) => ({
        x: scaleX(index),
        y: scaleY(clampPercent(value)),
    }));

    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${round(p.x)},${round(p.y)}`).join(" ");
    const baseline = padding.top + innerHeight;
    const area =
        points.length === 1
            ? ""
            : `${line} L${round(points[points.length - 1].x)},${round(baseline)} L${round(points[0].x)},${round(baseline)} Z`;

    return { points, line, area };
}

function clampPercent(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, value));
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * 极坐标转直角坐标。
 * 角度以 12 点方向为 0 度，顺时针递增（与 SVG 的 y 轴向下一致）。
 */
export function polar(cx: number, cy: number, radius: number, degrees: number): LinePoint {
    const rad = ((degrees - 90) * Math.PI) / 180;
    return { x: round(cx + radius * Math.cos(rad)), y: round(cy + radius * Math.sin(rad)) };
}

export interface DonutArc {
    /** 扇区路径 */
    path: string;
    /** 占比（0-1） */
    ratio: number;
    startAngle: number;
    endAngle: number;
}

/**
 * 生成环形图扇区。
 * 处理两个退化情况：单项占满整圈（360 度圆弧无法用单段弧表示）、以及全为 0。
 */
export function donutArcs(
    values: number[],
    opts: { cx: number; cy: number; inner: number; outer: number }
): DonutArc[] {
    const { cx, cy, inner, outer } = opts;
    const total = values.reduce((sum, v) => sum + (Number.isFinite(v) && v > 0 ? v : 0), 0);
    if (total <= 0) return [];

    const arcs: DonutArc[] = [];
    let angle = 0;
    for (const value of values) {
        const safe = Number.isFinite(value) && value > 0 ? value : 0;
        if (safe === 0) continue;
        const ratio = safe / total;
        const sweep = ratio * 360;
        const startAngle = angle;
        const endAngle = angle + sweep;
        arcs.push({
            path: ringSectorPath(cx, cy, inner, outer, startAngle, endAngle),
            ratio,
            startAngle,
            endAngle,
        });
        angle = endAngle;
    }
    return arcs;
}

/** 环形扇区路径；接近整圈时改用两段半圆，避免单段弧退化为空路径 */
function ringSectorPath(
    cx: number,
    cy: number,
    inner: number,
    outer: number,
    startAngle: number,
    endAngle: number
): string {
    const sweep = endAngle - startAngle;
    if (sweep >= 359.999) {
        const top = polar(cx, cy, outer, 0);
        const bottom = polar(cx, cy, outer, 180);
        const innerTop = polar(cx, cy, inner, 0);
        const innerBottom = polar(cx, cy, inner, 180);
        return [
            `M${top.x},${top.y}`,
            `A${outer},${outer} 0 1 1 ${bottom.x},${bottom.y}`,
            `A${outer},${outer} 0 1 1 ${top.x},${top.y}`,
            `M${innerTop.x},${innerTop.y}`,
            `A${inner},${inner} 0 1 0 ${innerBottom.x},${innerBottom.y}`,
            `A${inner},${inner} 0 1 0 ${innerTop.x},${innerTop.y}`,
            "Z",
        ].join(" ");
    }

    const largeArc = sweep > 180 ? 1 : 0;
    const outerStart = polar(cx, cy, outer, startAngle);
    const outerEnd = polar(cx, cy, outer, endAngle);
    const innerEnd = polar(cx, cy, inner, endAngle);
    const innerStart = polar(cx, cy, inner, startAngle);
    return [
        `M${outerStart.x},${outerStart.y}`,
        `A${outer},${outer} 0 ${largeArc} 1 ${outerEnd.x},${outerEnd.y}`,
        `L${innerEnd.x},${innerEnd.y}`,
        `A${inner},${inner} 0 ${largeArc} 0 ${innerStart.x},${innerStart.y}`,
        "Z",
    ].join(" ");
}

/** 时间轴刻度：从首末时间戳等分出 count 个点，返回各自的时间戳 */
export function timeTicks(timestamps: number[], count = 3): number[] {
    if (timestamps.length === 0) return [];
    const first = Math.min(...timestamps);
    const last = Math.max(...timestamps);
    if (first === last) return [first];
    return Array.from({ length: count + 1 }, (_, i) => Math.round(first + ((last - first) / count) * i));
}

/**
 * 从序列中均匀取出 k 个下标（含首末）。count <= k 时返回全部下标。
 */
export function uniformIndices(count: number, k: number): number[] {
    if (count <= 0 || k <= 0) return [];
    if (k === 1) return [0];
    if (count <= k) return Array.from({ length: count }, (_, i) => i);
    const step = (count - 1) / (k - 1);
    return Array.from({ length: k }, (_, i) => Math.round(i * step));
}

/**
 * 从序列中挑选需要绘制标记点的下标。
 *
 * 数据点很多时逐个画圆点既慢又糊成一片，因此只在点数超过上限时取样，
 * 并始终保留首末点与峰谷点，保证趋势的起点、终点与极值不会被采样漏掉。
 *
 * 注意不能「取样后按下标排序再截断」——那样会把下标较大的末点丢掉。
 * 这里是先给首末与峰谷留好位置，再用剩余名额做均匀取样的内部点。
 */
export function pickMarkerIndices(values: number[], max: number): number[] {
    const count = values.length;
    if (count === 0 || max <= 0) return [];
    if (count <= max) return values.map((_, i) => i);
    // 名额太少时不额外插极值，否则连首末都放不下
    if (max <= 4) return uniformIndices(count, max);

    let maxIndex = 0;
    let minIndex = 0;
    for (let i = 1; i < count; i++) {
        if (values[i] > values[maxIndex]) maxIndex = i;
        if (values[i] < values[minIndex]) minIndex = i;
    }

    const picked = new Set<number>([0, count - 1, maxIndex, minIndex]);
    // 取内部点时去掉首末，避免与已占用的位置重复而浪费名额
    const interior = uniformIndices(count, max - picked.size + 2).slice(1, -1);
    for (const index of interior) picked.add(index);

    return [...picked].sort((a, b) => a - b);
}
