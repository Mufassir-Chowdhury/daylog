import { describe, expect, it } from 'vitest';
import { addDays, dateKey, fromKey, isValidKey } from './date';

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
