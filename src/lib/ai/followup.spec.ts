import { describe, expect, it } from 'vitest';
import { FOLLOWUP_GRACE, isDue, isMissed, type FollowUp } from './followup';

const f = (over: Partial<FollowUp>): FollowUp => ({
	id: 'f',
	at: 1_000_000,
	why: 'x',
	status: 'pending',
	claimedAt: 0,
	...over
});

describe('follow-ups', () => {
	it('are due from their time until the grace period ends', () => {
		expect(isDue(f({}), 999_999)).toBe(false);
		expect(isDue(f({}), 1_000_000)).toBe(true);
		expect(isDue(f({}), 1_000_000 + FOLLOWUP_GRACE + 1)).toBe(false);
		expect(isMissed(f({}), 1_000_000 + FOLLOWUP_GRACE + 1)).toBe(true);
	});

	it('are taken over when a run stalls, never run twice otherwise', () => {
		expect(isDue(f({ status: 'done' }), 1_000_001)).toBe(false);
		expect(isDue(f({ status: 'running', claimedAt: 1_000_000 }), 1_000_000 + 60_000)).toBe(false);
		expect(isDue(f({ status: 'running', claimedAt: 1_000_000 }), 1_000_000 + 11 * 60_000)).toBe(
			true
		);
	});
});
