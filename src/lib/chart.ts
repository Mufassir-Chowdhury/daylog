/** Small geometry helpers shared by the hand-rolled SVG charts. */

export interface Scale {
	min: number;
	max: number;
	ticks: number[];
}

/**
 * Rounds a data range out to friendly gridline values (1/2/2.5/5 × 10ⁿ) so
 * ticks land on round numbers. Zero is always included — bars grow from it.
 */
export function niceScale(lo: number, hi: number, targetTicks = 4): Scale {
	const min0 = Math.min(0, lo);
	const max0 = Math.max(0, hi, min0 === 0 ? 1 : 0);
	const span = max0 - min0 || 1;
	const raw = span / targetTicks;
	const pow = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5, 10].map((f) => f * pow).find((s) => s >= raw) ?? 10 * pow;
	const min = Math.floor(min0 / step) * step;
	const max = Math.ceil(max0 / step) * step;
	const ticks: number[] = [];
	for (let v = min; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
	return { min, max, ticks };
}

/**
 * Vertical bar between `base` and `top` (SVG y coords) with 4px-rounded data
 * end and a square baseline — works for bars growing up or down.
 */
export function barPath(x: number, width: number, base: number, top: number): string {
	const h = Math.abs(base - top);
	if (h === 0) return '';
	const r = Math.min(4, h, width / 2);
	const dir = top < base ? -1 : 1;
	return (
		`M${x},${base} v${dir * (h - r)} q0,${dir * r} ${r},${dir * r} ` +
		`h${width - 2 * r} q${r},0 ${r},${-dir * r} v${-dir * (h - r)} z`
	);
}

/** Polyline path through points, skipping nulls (breaks the line). */
export function linePath(points: ({ x: number; y: number } | null)[]): string {
	let d = '';
	let pen = false;
	for (const p of points) {
		if (!p) {
			pen = false;
			continue;
		}
		d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
		pen = true;
	}
	return d;
}
