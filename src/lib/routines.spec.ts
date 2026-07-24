import { describe, expect, it } from 'vitest';
import type { RoutineLog } from './db';
import { daysInMonth, elapsedDays, monthlyRoutineStats } from './routines';

describe('daysInMonth', () => {
	it('knows month lengths', () => {
		expect(daysInMonth('2026-01')).toBe(31);
		expect(daysInMonth('2026-02')).toBe(28);
		expect(daysInMonth('2024-02')).toBe(29);
		expect(daysInMonth('2026-04')).toBe(30);
	});
});

describe('elapsedDays', () => {
	it('counts only up to today in the current month', () => {
		expect(elapsedDays('2026-07', '2026-07-24')).toBe(24);
		expect(elapsedDays('2026-07', '2026-07-01')).toBe(1);
	});

	it('counts finished months in full', () => {
		expect(elapsedDays('2026-06', '2026-07-24')).toBe(30);
		expect(elapsedDays('2026-02', '2026-07-24')).toBe(28);
	});
});

describe('monthlyRoutineStats', () => {
	const logs: RoutineLog[] = [
		{ date: '2026-06-01', values: { quran: 5, hadith: 2 } },
		{ date: '2026-06-15', values: { quran: 10 } },
		{ date: '2026-07-02', values: { quran: 3 } },
		{ date: '2026-07-10', values: { quran: 4, hadith: 1 } }
	];

	it('totals and counts per routine per month, newest month first', () => {
		const months = monthlyRoutineStats(logs, '2026-07-24');
		expect(months.map((m) => m.month)).toEqual(['2026-07', '2026-06']);
		expect(months[0].stats.get('quran')).toEqual({ total: 7, count: 2, average: 7 / 24 });
		expect(months[0].stats.get('hadith')).toEqual({ total: 1, count: 1, average: 1 / 24 });
	});

	it('averages past months over the whole month, not the logged days', () => {
		const june = monthlyRoutineStats(logs, '2026-07-24')[1];
		expect(june.stats.get('quran')).toEqual({ total: 15, count: 2, average: 15 / 30 });
	});

	it('always includes the current month, even with no logs', () => {
		const months = monthlyRoutineStats([], '2026-07-24');
		expect(months).toEqual([{ month: '2026-07', stats: new Map() }]);
	});

	it('ignores non-numeric values', () => {
		const months = monthlyRoutineStats(
			[{ date: '2026-07-01', values: { quran: NaN, hadith: 2 } }],
			'2026-07-24'
		);
		expect(months[0].stats.has('quran')).toBe(false);
		expect(months[0].stats.get('hadith')?.total).toBe(2);
	});
});
