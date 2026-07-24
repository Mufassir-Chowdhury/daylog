import type { RoutineLog } from './db';
import { monthOf } from './finance';

export interface RoutineMonthStats {
	/** Sum of every value logged in the month. */
	total: number;
	/** Number of days in the month with a value logged. */
	count: number;
	/** Total divided by the days of the month elapsed so far — not by `count`. */
	average: number;
}

export function daysInMonth(month: string): number {
	const [y, m] = month.split('-').map(Number);
	return new Date(y, m, 0).getDate();
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
