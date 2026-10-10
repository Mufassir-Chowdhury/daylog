import { describe, expect, it } from 'vitest';
import { barPath, linePath, niceScale } from './chart';

describe('niceScale', () => {
	it('rounds a positive range up to friendly ticks from zero', () => {
		expect(niceScale(0, 870)).toEqual({ min: 0, max: 1000, ticks: [0, 250, 500, 750, 1000] });
	});

	it('extends below zero for negative values', () => {
		const s = niceScale(-300, 900);
		expect(s.min).toBeLessThan(0);
		expect(s.ticks).toContain(0);
		expect(s.max).toBeGreaterThanOrEqual(900);
	});

	it('copes with an all-zero range', () => {
		expect(niceScale(0, 0).max).toBeGreaterThan(0);
	});
});

describe('paths', () => {
	it('draws nothing for a zero-height bar', () => {
		expect(barPath(0, 10, 100, 100)).toBe('');
	});

	it('breaks lines at nulls', () => {
		expect(linePath([{ x: 0, y: 0 }, null, { x: 2, y: 2 }, { x: 3, y: 3 }])).toBe(
			'M0.0,0.0M2.0,2.0L3.0,3.0'
		);
	});
});
