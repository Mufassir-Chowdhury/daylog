import { describe, expect, it } from 'vitest';
import { SilenceDetector } from './recorder';

/** Feeds levels every 100 ms; returns when it decided and what. */
function run(levels: (ms: number) => number, until = 70_000) {
	const d = new SilenceDetector();
	for (let ms = 0; ms <= until; ms += 100) {
		const state = d.push(levels(ms), ms);
		if (state !== 'continue') return { state, ms };
	}
	return { state: 'continue' as const, ms: until };
}

describe('SilenceDetector', () => {
	it('ends after a pause once you have spoken', () => {
		// Quiet room, speech from 0.5 s to 2.5 s, then quiet.
		const r = run((ms) => (ms >= 500 && ms < 2500 ? 0.2 : 0.005));
		expect(r.state).toBe('done');
		expect(r.ms).toBeGreaterThanOrEqual(2500 + 1400 - 100);
		expect(r.ms).toBeLessThan(4200);
	});

	it('keeps listening through short pauses', () => {
		const r = run((ms) => ((ms >= 500 && ms < 2000) || (ms >= 3000 && ms < 4000) ? 0.2 : 0.005));
		expect(r.state).toBe('done');
		expect(r.ms).toBeGreaterThan(4000);
	});

	it('gives up when nothing is said, and adapts to a noisy room', () => {
		expect(run(() => 0.005)).toEqual({ state: 'silent', ms: 8000 });
		// A steady hum isn't speech.
		expect(run(() => 0.05).state).toBe('silent');
	});

	it('stops at a minute', () => {
		expect(run(() => 0.3)).toEqual({ state: 'done', ms: 60_000 });
	});
});
