import { describe, expect, it } from 'vitest';
import { addDays, dateKey, fromKey, isValidKey, parseDateWord } from './date';

describe('date keys', () => {
	it('round-trips', () => {
		expect(dateKey(fromKey('2026-07-18'))).toBe('2026-07-18');
	});

	it('validates keys', () => {
		expect(isValidKey('2026-07-18')).toBe(true);
		expect(isValidKey('2026-02-30')).toBe(false);
		expect(isValidKey('2026-7-18')).toBe(false);
		expect(isValidKey('yesterday')).toBe(false);
	});

	it('adds days across month boundaries', () => {
		expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
		expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
	});
});

describe('parseDateWord', () => {
	// 2026-10-10 is a Saturday.
	const today = '2026-10-10';

	it('reads relative words and offsets', () => {
		expect(parseDateWord('today', today)).toBe(today);
		expect(parseDateWord('tmr', today)).toBe('2026-10-11');
		expect(parseDateWord('Yesterday', today)).toBe('2026-10-09');
		expect(parseDateWord('+3', today)).toBe('2026-10-13');
		expect(parseDateWord('-2d', today)).toBe('2026-10-08');
	});

	it('reads weekdays as the coming one', () => {
		expect(parseDateWord('sat', today)).toBe(today);
		expect(parseDateWord('mon', today)).toBe('2026-10-12');
		expect(parseDateWord('friday', today)).toBe('2026-10-16');
		expect(parseDateWord('next mon', today)).toBe('2026-10-19');
		expect(parseDateWord('last sat', today)).toBe('2026-10-03');
		expect(parseDateWord('last fri', today)).toBe('2026-10-09');
	});

	it('reads month and day in either order', () => {
		expect(parseDateWord('oct 12', today)).toBe('2026-10-12');
		expect(parseDateWord('12 Sept', today)).toBe('2026-09-12');
		expect(parseDateWord('jan 3 2027', today)).toBe('2027-01-03');
		expect(parseDateWord('2026-12-01', today)).toBe('2026-12-01');
	});

	it('rejects non-dates', () => {
		expect(parseDateWord('feb 30', today)).toBeNull();
		expect(parseDateWord('notes', today)).toBeNull();
		expect(parseDateWord('mo', today)).toBeNull();
		expect(parseDateWord('21', today)).toBeNull();
		expect(parseDateWord('', today)).toBeNull();
	});
});
