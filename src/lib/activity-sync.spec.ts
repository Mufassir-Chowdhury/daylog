import { describe, expect, it } from 'vitest';
import { fitSpans } from './activity-sync';

describe('fitSpans', () => {
	it('leaves small days alone and strips titles from the shortest spans first', () => {
		const spans = [
			{ s: 0, e: 1000, exe: 'a', app: 'a', title: 'x'.repeat(50) },
			{ s: 1000, e: 9000, exe: 'b', app: 'b', title: 'y'.repeat(50) }
		];
		expect(fitSpans(spans)).toBe(spans);
		const fitted = fitSpans(spans, 150);
		expect(fitted[0].title).toBeUndefined();
		expect(fitted[1].title).toBe('y'.repeat(50));
		expect(spans[0].title).toBeDefined();
	});
});
