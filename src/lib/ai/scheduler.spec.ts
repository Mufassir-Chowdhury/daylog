import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type AssistantConfig } from './config';
import type { InboxItem } from './inbox';
import {
	cardsLeftToday,
	dueCheckins,
	MAX_ATTEMPTS,
	nextAttempt,
	RETRY_AFTER,
	STUCK_AFTER,
	type CheckinRecord
} from './scheduler';

const TODAY = '2026-10-30';
const at = (time: string) => new Date(`${TODAY}T${time}:00`);
const config = (): AssistantConfig => structuredClone(DEFAULT_CONFIG);
const record = (checkinId: string, over: Partial<CheckinRecord> = {}): CheckinRecord => ({
	date: TODAY,
	checkinId,
	status: 'done',
	at: at('08:00').getTime(),
	attempts: 1,
	device: 'd1',
	...over
});
const ids = (plan: ReturnType<typeof dueCheckins>) => ({
	run: plan.run?.id ?? null,
	skip: plan.skip.map((c) => c.id)
});

describe('dueCheckins', () => {
	it('runs nothing before the first check-in', () => {
		expect(ids(dueCheckins(config(), at('07:59'), TODAY, []))).toEqual({ run: null, skip: [] });
	});

	it('runs a check-in once its time has passed, until it has run', () => {
		expect(ids(dueCheckins(config(), at('08:00'), TODAY, []))).toEqual({
			run: 'warmup',
			skip: []
		});
		expect(ids(dueCheckins(config(), at('09:30'), TODAY, [record('warmup')]))).toEqual({
			run: null,
			skip: []
		});
	});

	it('runs only the latest missed one and skips the earlier', () => {
		expect(ids(dueCheckins(config(), at('18:00'), TODAY, []))).toEqual({
			run: 'evening',
			skip: ['warmup']
		});
	});

	it("ignores yesterday's records, disabled check-ins and skipped ones", () => {
		const c = config();
		c.checkins[1].enabled = false;
		expect(
			ids(dueCheckins(c, at('18:00'), TODAY, [record('warmup', { date: '2026-10-29' })]))
		).toEqual({ run: 'warmup', skip: [] });
		expect(
			ids(dueCheckins(config(), at('18:00'), TODAY, [record('evening', { status: 'skipped' })]))
		).toEqual({ run: null, skip: ['warmup'] });
	});

	it('retries a failed run after 15 minutes, at most three times', () => {
		const failed = (attempts: number) =>
			record('evening', { status: 'failed', attempts, at: at('17:00').getTime() });
		const now = (mins: number) => new Date(at('17:00').getTime() + mins * 60_000);
		expect(dueCheckins(config(), now(10), TODAY, [failed(1)]).run).toBeNull();
		expect(dueCheckins(config(), now(RETRY_AFTER / 60_000), TODAY, [failed(1)]).run?.id).toBe(
			'evening'
		);
		expect(dueCheckins(config(), now(60), TODAY, [failed(MAX_ATTEMPTS)]).run).toBeNull();
	});

	it('takes over a run that has been "running" too long', () => {
		const stuck = record('evening', { status: 'running', at: at('17:00').getTime() });
		expect(dueCheckins(config(), at('17:05'), TODAY, [stuck]).run).toBeNull();
		const later = new Date(at('17:00').getTime() + STUCK_AFTER);
		expect(dueCheckins(config(), later, TODAY, [stuck]).run?.id).toBe('evening');
	});
});

describe('nextAttempt', () => {
	const evening = DEFAULT_CONFIG.checkins[1];
	it('claims a fresh run or a retry, never a settled one', () => {
		const now = at('17:00').getTime();
		expect(nextAttempt(null, evening, TODAY, 'd1', now)).toEqual({
			date: TODAY,
			checkinId: 'evening',
			status: 'running',
			at: now,
			attempts: 1,
			device: 'd1'
		});
		const failed = record('evening', { status: 'failed', at: now - RETRY_AFTER });
		expect(nextAttempt(failed, evening, TODAY, 'd2', now)).toMatchObject({
			attempts: 2,
			device: 'd2'
		});
		expect(nextAttempt(record('evening'), evening, TODAY, 'd2', now)).toBeNull();
		expect(
			nextAttempt(record('evening', { status: 'running', at: now }), evening, TODAY, 'd2', now)
		).toBeNull();
	});
});

describe('cardsLeftToday', () => {
	const card = (signalKey: string, createdAt: number): InboxItem => ({
		id: signalKey,
		kind: 'proposal',
		source: 'checkin',
		title: '',
		body: '',
		tool: '',
		details: [],
		changes: [],
		status: 'pending',
		signalKey,
		priority: 0,
		createdAt,
		expiresAt: createdAt + 1
	});
	it("counts today's unprompted cards only", () => {
		const now = at('12:00').getTime();
		const items = [
			card('carryover:2026-10-30', now - 1000),
			card('deadline:d1', now - 2000),
			card('checkin:warmup:2026-10-30', now - 3000),
			card('deadline:d2', at('12:00').getTime() - 86_400_000)
		];
		expect(cardsLeftToday(config(), items, now)).toBe(DEFAULT_CONFIG.maxCardsPerDay - 2);
		const c = config();
		c.maxCardsPerDay = 1;
		expect(cardsLeftToday(c, items, now)).toBe(0);
	});
});

describe('weekly check-ins', () => {
	it('runs the weekly review only on its weekday', () => {
		// 2026-10-29 is a Thursday, 2026-10-30 a Friday.
		const thu = new Date('2026-10-29T20:05:00');
		expect(dueCheckins(config(), thu, '2026-10-29', []).run?.id).toBe('review');
		const fri = new Date('2026-10-30T20:05:00');
		expect(dueCheckins(config(), fri, '2026-10-30', []).run?.id).toBe('evening');
	});
});
