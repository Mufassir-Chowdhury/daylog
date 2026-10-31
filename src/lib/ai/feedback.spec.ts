import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from './config';
import { isMuted, isOff, isPaused, noticeFor, normalizeFeedback, suggestionType } from './feedback';
import type { InboxItem } from './inbox';

const card = (over: Partial<InboxItem>): InboxItem => ({
	id: 'x',
	kind: 'proposal',
	source: 'checkin',
	title: 'Add “Draft intro”',
	body: '',
	tool: 'add_task',
	details: [],
	changes: [],
	status: 'pending',
	signalKey: 'deadline:d1',
	priority: 1,
	createdAt: 0,
	expiresAt: 1,
	...over
});
const at = (time: string) => new Date(`2026-10-31T${time}:00`);

describe('suggestion feedback', () => {
	it('knows which cards came from a detector', () => {
		expect(suggestionType('deadline:d1')).toBe('deadline');
		expect(suggestionType('carryover:2026-10-30')).toBe('carryover');
		expect(suggestionType('checkin:evening:2026-10-31')).toBeNull();
		expect(suggestionType('')).toBeNull();
	});

	it('reads stored feedback forgivingly', () => {
		const f = normalizeFeedback({ deadline: { applied: 2, muted: true }, carryover: null });
		expect(f).toEqual({
			deadline: { applied: 2, dismissed: 0, muted: true },
			carryover: { applied: 0, dismissed: 0, muted: false }
		});
		expect(isMuted(f, 'deadline')).toBe(true);
		expect(isMuted(f, 'other')).toBe(false);
		expect(normalizeFeedback(undefined)).toEqual({});
	});
});

describe('noticeFor', () => {
	const brief = card({
		kind: 'brief',
		title: 'Evening brief · Sat 31 Oct',
		body: 'Good evening.\n- Two classes tomorrow.',
		signalKey: 'checkin:evening:2026-10-31',
		tool: ''
	});

	it('notifies about a check-in brief, mentioning the rest', () => {
		expect(noticeFor([brief, card({})], DEFAULT_CONFIG, at('17:00'))).toEqual({
			title: 'Jarvis · Evening brief · Sat 31 Oct',
			body: 'Good evening.\n- Two classes tomorrow.\n+1 more in your Inbox'
		});
	});

	it('notifies about urgent suggestions and follow-ups, not ordinary ones', () => {
		expect(noticeFor([card({})], DEFAULT_CONFIG, at('11:00'))).toBeNull();
		expect(noticeFor([card({ priority: 2 })], DEFAULT_CONFIG, at('11:00'))).toEqual({
			title: 'Jarvis · Suggestion',
			body: 'Add “Draft intro”'
		});
		expect(
			noticeFor([card({ signalKey: 'followup:f1' })], DEFAULT_CONFIG, at('11:00'))
		).not.toBeNull();
	});

	it('stays silent in quiet hours', () => {
		expect(noticeFor([brief], DEFAULT_CONFIG, at('02:00'))).toBeNull();
	});
});

describe('pausing what you mostly dismiss', () => {
	const f = (applied: number, dismissed: number, muted = false) => ({ applied, dismissed, muted });

	it('pauses a kind after 8 or more with under 15% applied', () => {
		expect(isPaused(f(0, 7))).toBe(false); // not enough yet
		expect(isPaused(f(1, 7))).toBe(true); // 1 of 8
		expect(isPaused(f(2, 8))).toBe(false); // 20% applied
		expect(isPaused(undefined)).toBe(false);
		// Muted is off already, not "paused".
		expect(isPaused(f(0, 10, true))).toBe(false);
	});

	it('counts muted or paused kinds as off', () => {
		const feedback = { deadline: f(0, 9), money: f(0, 0, true), prep: f(5, 5) };
		expect(isOff(feedback, 'deadline')).toBe(true);
		expect(isOff(feedback, 'money')).toBe(true);
		expect(isOff(feedback, 'prep')).toBe(false);
		expect(isOff(feedback, 'capture')).toBe(false);
	});
});
