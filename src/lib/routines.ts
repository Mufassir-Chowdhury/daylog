import type { RoutineLog } from './db';
import { addDays, daysInMonth, monthOf } from './date';

export { daysInMonth };

export interface RoutineMonthStats {
	/** Sum of every value logged in the month. */
	total: number;
	/** Number of days in the month with a value logged. */
	count: number;
	/** Total divided by the days of the month elapsed so far — not by `count`. */
	average: number;
}

/**
 * How many days of a month have happened by `today` — the divisor for
 * averages. The current month counts only days up to today; finished months
 * count in full.
 */
export function elapsedDays(month: string, today: string): number {
	if (month === monthOf(today)) return Number(today.slice(8, 10));
	return daysInMonth(month);
}

/**
 * Per-month, per-routine totals, newest month first. The current month is
 * always present (empty if nothing is logged yet) so the stats page has
 * something to show; values of deleted routines simply never get read.
 */
export function monthlyRoutineStats(
	logs: RoutineLog[],
	today: string
): { month: string; stats: Map<string, RoutineMonthStats> }[] {
	const months = new Map<string, Map<string, RoutineMonthStats>>();
	months.set(monthOf(today), new Map());
	for (const log of logs) {
		const month = monthOf(log.date);
		let stats = months.get(month);
		if (!stats) {
			stats = new Map();
			months.set(month, stats);
		}
		for (const [id, value] of Object.entries(log.values)) {
			if (typeof value !== 'number' || !Number.isFinite(value)) continue;
			let s = stats.get(id);
			if (!s) {
				s = { total: 0, count: 0, average: 0 };
				stats.set(id, s);
			}
			s.total += value;
			s.count += 1;
		}
	}
	return [...months.entries()]
		.map(([month, stats]) => {
			const days = elapsedDays(month, today);
			for (const s of stats.values()) s.average = days > 0 ? s.total / days : 0;
			return { month, stats };
		})
		.sort((a, b) => b.month.localeCompare(a.month));
}

/** A day "counts" for a routine when it reaches the target — or, with no target, has any value. */
export function dayMet(value: number | undefined, threshold: number): boolean {
	if (value === undefined || !Number.isFinite(value)) return false;
	return threshold > 0 ? value >= threshold : value > 0;
}

/**
 * Current and best runs of consecutive counting days. The current streak may
 * end yesterday — today isn't over, so not having logged yet doesn't break it.
 */
export function routineStreaks(
	logs: RoutineLog[],
	routineId: string,
	threshold: number,
	today: string
): { current: number; best: number } {
	const met = new Set(
		logs.filter((l) => dayMet(l.values[routineId], threshold)).map((l) => l.date)
	);
	let best = 0;
	for (const date of [...met].sort()) {
		if (met.has(addDays(date, -1))) continue; // not the start of a run
		let len = 1;
		while (met.has(addDays(date, len))) len++;
		best = Math.max(best, len);
	}
	let current = 0;
	let day = met.has(today) ? today : addDays(today, -1);
	while (met.has(day)) {
		current++;
		day = addDays(day, -1);
	}
	return { current, best };
}

/** The last `n` days ending today, oldest first, with the routine's value (or null). */
export function recentValues(
	logs: RoutineLog[],
	routineId: string,
	today: string,
	n = 30
): { date: string; value: number | null }[] {
	const byDate = new Map(logs.map((l) => [l.date, l.values[routineId]]));
	return Array.from({ length: n }, (_, i) => {
		const date = addDays(today, i - n + 1);
		const v = byDate.get(date);
		return { date, value: typeof v === 'number' && Number.isFinite(v) ? v : null };
	});
}
