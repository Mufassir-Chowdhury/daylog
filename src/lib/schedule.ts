import { addDays, fromKey } from './date';
import type { Deadline, PlanTask, ScheduleEvent, ScheduleSlot } from './db';

/**
 * Schedule model: a weekly timetable of recurring slots (classes, labs) plus
 * one-off events (exams, meetings, invigilation duty). A slot's occurrence on
 * a given date is "virtual" until something changes about it (done, cancelled,
 * moved, room swapped) — then an override event with a deterministic id is
 * stored for that date and replaces it.
 */

export type EventKind = 'class' | 'lab' | 'exam' | 'invigilation' | 'meeting' | 'other';
export type EventStatus = 'planned' | 'done' | 'cancelled' | 'moved';
export type TaskStatus = 'open' | 'done' | 'dropped' | 'moved';

export const EVENT_KINDS: { id: EventKind; label: string }[] = [
	{ id: 'class', label: 'Class' },
	{ id: 'lab', label: 'Lab' },
	{ id: 'exam', label: 'Exam' },
	{ id: 'invigilation', label: 'Invigilation' },
	{ id: 'meeting', label: 'Meeting' },
	{ id: 'other', label: 'Other' }
];

export const WEEKDAYS = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday'
];

/** Exam-type duties get highlighted, like the yellow rows in the printed routine. */
export function isDuty(kind: EventKind): boolean {
	return kind === 'exam' || kind === 'invigilation';
}

/** Id of the stored override for a slot's occurrence on a date — one per slot per day. */
export function overrideId(slotId: string, date: string): string {
	return `${slotId}_${date}`;
}

/** The Sunday that starts the week containing `key` (the academic week runs Sun–Thu). */
export function weekStart(key: string): string {
	return addDays(key, -fromKey(key).getDay());
}

/** Whether a slot runs on a date — right weekday and within its optional date range. */
export function slotRunsOn(slot: ScheduleSlot, date: string): boolean {
	if (fromKey(date).getDay() !== slot.weekday) return false;
	if (slot.startsOn && date < slot.startsOn) return false;
	if (slot.endsOn && date > slot.endsOn) return false;
	return true;
}

/** A slot's occurrence on a date, as the event it would be if nothing changed. */
export function materialize(slot: ScheduleSlot, date: string): ScheduleEvent {
	return {
		id: overrideId(slot.id, date),
		slotId: slot.id,
		date,
		start: slot.start,
		end: slot.end,
		title: slot.title,
		kind: slot.kind,
		room: slot.room,
		status: 'planned',
		note: ''
	};
}

export interface Occurrence {
	event: ScheduleEvent;
	/** True while it's still the untouched timetable slot (nothing stored for it yet). */
	virtual: boolean;
}

/**
 * Everything scheduled between `from` and `to` (inclusive day keys): timetable
 * occurrences — replaced by their override when one is stored — plus dated
 * one-off events. Sorted by date, then start time.
 */
export function occurrences(
	slots: ScheduleSlot[],
	events: ScheduleEvent[],
	from: string,
	to: string
): Occurrence[] {
	const byId = new Map(events.map((e) => [e.id, e]));
	const out: Occurrence[] = [];
	for (let date = from; date <= to; date = addDays(date, 1)) {
		for (const slot of slots) {
			if (!slotRunsOn(slot, date)) continue;
			const stored = byId.get(overrideId(slot.id, date));
			out.push(
				stored
					? { event: stored, virtual: false }
					: { event: materialize(slot, date), virtual: true }
			);
		}
	}
	for (const e of events) {
		if (e.date === null || e.date < from || e.date > to) continue;
		// Overrides were placed above, at their slot's position; skip them here.
		if (e.slotId !== null && e.id === overrideId(e.slotId, e.date)) continue;
		out.push({ event: e, virtual: false });
	}
	return out.sort(
		(a, b) =>
			a.event.date!.localeCompare(b.event.date!) ||
			minutes(a.event.start) - minutes(b.event.start) ||
			a.event.title.localeCompare(b.event.title)
	);
}

/** One-off events with no date yet ("Date TBD"). */
export function undatedEvents(events: ScheduleEvent[]): ScheduleEvent[] {
	return events.filter((e) => e.date === null).sort((a, b) => a.title.localeCompare(b.title));
}

/** Minutes since midnight for `HH:MM`; blank or malformed times sort last. */
export function minutes(time: string): number {
	const m = /^(\d{1,2}):(\d{2})$/.exec(time);
	return m ? Number(m[1]) * 60 + Number(m[2]) : 24 * 60;
}

function clock(time: string): { text: string; pm: boolean } | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(time);
	if (!m) return null;
	const h = Number(m[1]);
	return { text: `${h % 12 === 0 ? 12 : h % 12}:${m[2]}`, pm: h >= 12 };
}

/**
 * "9:00–11:00 AM", "12:00–1:00 PM", "11:15 AM–12:00 PM" — the suffix is
 * written once when both ends share it. Empty when there's no start time.
 */
export function formatTimeRange(start: string, end: string): string {
	const a = clock(start);
	if (!a) return '';
	const b = clock(end);
	const suffix = (pm: boolean) => (pm ? 'PM' : 'AM');
	if (!b) return `${a.text} ${suffix(a.pm)}`;
	if (a.pm === b.pm) return `${a.text}–${b.text} ${suffix(b.pm)}`;
	return `${a.text} ${suffix(a.pm)}–${b.text} ${suffix(b.pm)}`;
}

const SHORT_DAY = new Intl.DateTimeFormat('en-US', {
	weekday: 'short',
	month: 'short',
	day: 'numeric'
});
const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** "Thu, Oct 8" */
export function shortDay(key: string): string {
	return SHORT_DAY.format(fromKey(key));
}

/** "Oct 4 – 10" or "Sep 27 – Oct 3" */
export function rangeLabel(from: string, to: string): string {
	const a = fromKey(from);
	const b = fromKey(to);
	const end = a.getMonth() === b.getMonth() ? String(b.getDate()) : MONTH_DAY.format(b);
	return `${MONTH_DAY.format(a)} – ${end}`;
}

/**
 * Marks `event` as moved and returns it together with the new event at the
 * target date/time. The new one is standalone (not tied to the timetable) so
 * the slot's regular occurrence there, if any, is unaffected.
 */
export function moveEvent(
	event: ScheduleEvent,
	target: { date: string; start: string; end: string; room: string },
	newId: string
): [ScheduleEvent, ScheduleEvent] {
	const when = `${shortDay(target.date)}${target.start ? ` ${formatTimeRange(target.start, target.end)}` : ''}`;
	const moved: ScheduleEvent = { ...event, status: 'moved', note: `Moved to ${when}` };
	const created: ScheduleEvent = {
		...event,
		...target,
		id: newId,
		slotId: null,
		status: 'planned',
		note: event.date ? `Moved from ${shortDay(event.date)}` : ''
	};
	return [moved, created];
}

/**
 * Tasks whose day (or `date`–`until` span) touches `from`–`to`, ordered by
 * date, then time, then entry order. `date === null` tasks are the "Later"
 * bucket and never match a range.
 */
export function tasksInRange(tasks: PlanTask[], from: string, to: string): PlanTask[] {
	return tasks
		.filter((t) => t.date !== null && t.date <= to && (t.until ?? t.date) >= from)
		.sort(compareTasks);
}

export function compareTasks(a: PlanTask, b: PlanTask): number {
	return (
		(a.date ?? '9999').localeCompare(b.date ?? '9999') ||
		minutes(a.start) - minutes(b.start) ||
		a.createdAt - b.createdAt
	);
}

/** Replaces the item with the same id, or appends it. */
export function upsert<T extends { id: string }>(items: T[], item: T): T[] {
	return items.some((i) => i.id === item.id)
		? items.map((i) => (i.id === item.id ? item : i))
		: [...items, item];
}

/** Groups items by a key, keeping first-seen order of keys. */
export function groupBy<T>(items: T[], key: (item: T) => string): [string, T[]][] {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const k = key(item);
		const list = groups.get(k);
		if (list) list.push(item);
		else groups.set(k, [item]);
	}
	return [...groups];
}

/** Moves a task to another day: the original stays, marked moved, and a fresh copy is returned. */
export function moveTask(
	task: PlanTask,
	target: { date: string | null; until: string | null },
	newId: string,
	now: number
): [PlanTask, PlanTask] {
	const where = target.date === null ? 'later' : spanLabel(target.date, target.until);
	return [
		{ ...task, status: 'moved', note: `Moved to ${where}` },
		{ ...task, ...target, id: newId, status: 'open', note: '', createdAt: now }
	];
}

/** "Fri, Oct 9" or "Fri–Sat, Oct 9–10" for a span. */
export function spanLabel(date: string, until: string | null): string {
	if (!until || until === date) return shortDay(date);
	const a = fromKey(date);
	const b = fromKey(until);
	const wd = (d: Date) => WEEKDAYS[d.getDay()].slice(0, 3);
	const days =
		a.getMonth() === b.getMonth()
			? `${MONTH_DAY.format(a)}–${b.getDate()}`
			: `${MONTH_DAY.format(a)} – ${MONTH_DAY.format(b)}`;
	return `${wd(a)}–${wd(b)}, ${days}`;
}

/** Whole days from `today` to `due` (negative when overdue). */
export function daysUntil(due: string, today: string): number {
	return Math.round((fromKey(due).getTime() - fromKey(today).getTime()) / 86_400_000);
}

/** Open first, then by due date (undated last), then by text. */
export function sortDeadlines(deadlines: Deadline[]): Deadline[] {
	return deadlines
		.slice()
		.sort(
			(a, b) =>
				Number(a.done) - Number(b.done) ||
				(a.due ?? '9999').localeCompare(b.due ?? '9999') ||
				a.text.localeCompare(b.text)
		);
}

/** What the "When" column shows: the free-text label if set, else the date, else TBD. */
export function deadlineWhen(d: Deadline): string {
	if (d.label.trim()) return d.label.trim();
	return d.due ? shortDay(d.due) : 'TBD';
}

/** "today", "tomorrow", "in 5 days", "2 days ago". */
export function countdown(due: string, today: string): string {
	const n = daysUntil(due, today);
	if (n === 0) return 'today';
	if (n === 1) return 'tomorrow';
	if (n === -1) return 'yesterday';
	return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

/** What a schedule row's buttons ask the page to do. */
export type RowAction = 'done' | 'cancel' | 'move' | 'edit' | 'remove';

/** What a task row's buttons ask the page to do. */
export type TaskAction = 'done' | 'drop' | 'move' | 'edit' | 'remove';
