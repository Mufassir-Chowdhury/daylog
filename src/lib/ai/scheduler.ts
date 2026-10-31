/**
 * When check-ins run. Pure: given the config, the time and what already ran
 * today (`assistantCheckins`), it says what to run now. Whoever runs it (web
 * tab or desktop app, Steps 5.3–5.5) claims the run first so two devices never
 * run the same check-in.
 *
 * Rules:
 * - A check-in is due once its time has passed today, until it has run.
 * - Only the latest due check-in runs; earlier ones missed today are skipped
 *   (a morning warm-up is no use at 6 PM). Nothing carries over past midnight.
 * - A run that failed is tried again after 15 minutes, at most 3 times.
 * - A run marked running for over 10 minutes is taken as dead (the device
 *   closed mid-run) and counts as failed.
 * - Quiet hours hold back notifications, not runs (Step 5.7).
 */
import type { AssistantConfig, Checkin } from './config';
import type { InboxItem } from './inbox';

export type CheckinStatus = 'running' | 'done' | 'failed' | 'skipped';

/** One check-in on one day, stored at `assistantCheckins/{date}_{checkinId}`. */
export interface CheckinRecord {
	date: string;
	checkinId: string;
	status: CheckinStatus;
	/** When the latest attempt started, ms since the epoch. */
	at: number;
	attempts: number;
	/** Which device ran it. */
	device: string;
}

export const RETRY_AFTER = 15 * 60_000;
export const MAX_ATTEMPTS = 3;
export const STUCK_AFTER = 10 * 60_000;

export const recordId = (date: string, checkinId: string) => `${date}_${checkinId}`;

/** `HH:MM` of a date, local time. */
export const clock = (now: Date) =>
	`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

/** Whether a record still blocks a run at `now`. */
function settled(record: CheckinRecord, now: number): boolean {
	switch (record.status) {
		case 'done':
		case 'skipped':
			return true;
		case 'running':
			return now - record.at < STUCK_AFTER;
		case 'failed':
			return record.attempts >= MAX_ATTEMPTS || now - record.at < RETRY_AFTER;
	}
}

export interface DuePlan {
	/** The check-in to run now, if any. */
	run: Checkin | null;
	/** Earlier check-ins missed today, to mark skipped. */
	skip: Checkin[];
}

/** What to do at `now`, given today's records. */
export function dueCheckins(
	config: AssistantConfig,
	now: Date,
	today: string,
	records: CheckinRecord[]
): DuePlan {
	const time = clock(now);
	const byId = new Map(records.filter((r) => r.date === today).map((r) => [r.checkinId, r]));
	const passed = config.checkins
		.filter((c) => c.enabled && c.time <= time)
		.sort((a, b) => a.time.localeCompare(b.time));
	const latest = passed.at(-1);
	if (!latest) return { run: null, skip: [] };
	const record = byId.get(latest.id);
	return {
		// Only the latest passed check-in can run; earlier ones are past their use.
		run: !record || !settled(record, now.getTime()) ? latest : null,
		skip: passed.slice(0, -1).filter((c) => !byId.has(c.id))
	};
}

/** The record for a new attempt at `checkin`, or null when `existing` still blocks it. */
export function nextAttempt(
	existing: CheckinRecord | null,
	checkin: Checkin,
	today: string,
	device: string,
	now: number
): CheckinRecord | null {
	if (existing && settled(existing, now)) return null;
	return {
		date: today,
		checkinId: checkin.id,
		status: 'running',
		at: now,
		attempts: (existing?.attempts ?? 0) + 1,
		device
	};
}

/**
 * How many more unprompted cards may be made today (`maxCardsPerDay`).
 * Scheduled check-ins don't count; cards from detectors (Step 5.6) do.
 */
export function cardsLeftToday(config: AssistantConfig, items: InboxItem[], today: number): number {
	const unprompted = items.filter(
		(i) =>
			i.source === 'checkin' && !i.signalKey.startsWith('checkin:') && sameDay(i.createdAt, today)
	).length;
	return Math.max(0, config.maxCardsPerDay - unprompted);
}

function sameDay(a: number, b: number): boolean {
	const x = new Date(a);
	const y = new Date(b);
	return (
		x.getFullYear() === y.getFullYear() &&
		x.getMonth() === y.getMonth() &&
		x.getDate() === y.getDate()
	);
}
