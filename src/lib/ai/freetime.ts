/**
 * Free time between what's scheduled: for the deadline planner and for "when
 * am I free on Thursday?". A day counts from 08:00 to 22:00; classes, events
 * and timed tasks are busy (cancelled and moved ones aren't). Pure.
 */
import { addDays } from '../date';
import type { PlanTask, ScheduleEvent, ScheduleSlot } from '../db';
import { minutes, occurrences, tasksInRange } from '../schedule';

export const DAY_START = 8 * 60;
export const DAY_END = 22 * 60;
/** A busy item with no end time takes this long. */
const DEFAULT_LENGTH = 60;

export interface Block {
	/** Minutes since midnight. */
	start: number;
	end: number;
}

/** The gaps of at least `min` minutes between `busy` blocks, within the day's bounds. */
export function gaps(busy: Block[], min: number, from = DAY_START, to = DAY_END): Block[] {
	const sorted = busy
		.map((b) => ({ start: Math.max(b.start, from), end: Math.min(b.end, to) }))
		.filter((b) => b.end > b.start)
		.sort((a, b) => a.start - b.start);
	const out: Block[] = [];
	let at = from;
	for (const b of sorted) {
		if (b.start - at >= min) out.push({ start: at, end: b.start });
		at = Math.max(at, b.end);
	}
	if (to - at >= min) out.push({ start: at, end: to });
	return out;
}

const hasTime = (t: string) => /^\d{1,2}:\d{2}$/.test(t);

function busyBlock(start: string, end: string): Block | null {
	if (!hasTime(start)) return null;
	const s = minutes(start);
	const e = hasTime(end) ? minutes(end) : s + DEFAULT_LENGTH;
	return { start: s, end: Math.max(e, s + 15) };
}

export interface FreeDay {
	date: string;
	blocks: Block[];
}

/**
 * Free blocks of at least `min` minutes on each day from `from` to `to`.
 * `nowMinutes` (for today) moves the day's start to now, rounded up to the
 * next quarter hour.
 */
export function freeTime(
	data: { slots: ScheduleSlot[]; events: ScheduleEvent[]; tasks: PlanTask[] },
	from: string,
	to: string,
	min: number,
	today: string,
	nowMinutes: number
): FreeDay[] {
	const occ = occurrences(data.slots, data.events, from, to);
	const tasks = tasksInRange(data.tasks, from, to).filter((t) => t.status === 'open');
	const out: FreeDay[] = [];
	for (let date = from; date <= to; date = addDays(date, 1)) {
		const busy = [
			...occ
				.filter(
					(o) =>
						o.event.date === date && o.event.status !== 'cancelled' && o.event.status !== 'moved'
				)
				.map((o) => busyBlock(o.event.start, o.event.end)),
			// A timed task on a span of days blocks the same hours on each.
			...tasks
				.filter((t) => t.date! <= date && (t.until ?? t.date!) >= date)
				.map((t) => busyBlock(t.start, t.end))
		].filter((b): b is Block => b !== null);
		const start = date === today ? Math.max(DAY_START, Math.ceil(nowMinutes / 15) * 15) : DAY_START;
		if (date < today) continue;
		out.push({ date, blocks: gaps(busy, min, start, DAY_END) });
	}
	return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** `540` → `09:00`. */
export const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
