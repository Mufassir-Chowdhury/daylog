/**
 * Desktop reminders: a notification when a timed line comes due (`21:00 gym`)
 * and ten minutes before a class, lab, exam or meeting starts. The renderer
 * works out what's coming up for today and tomorrow; the desktop shell owns
 * the timers, since a hidden window's timers get throttled.
 */
import { addDays, dateKey, fromKey } from './date';
import { listEvents, listSlots, loadDay } from './db';
import { desktop, type Reminder } from './desktop';
import { dayHref } from './nav';
import { parseDay, type ParsedDay } from './parse';
import { EVENT_KINDS, minutes, occurrences } from './schedule';
import type { ScheduleEvent, ScheduleSlot } from './db';

const HEADS_UP_MIN = 10;

const at = (day: string, mins: number) => fromKey(day).getTime() + mins * 60_000;

/** Reminders for the given days' timed lines and scheduled events, after `now`. */
export function buildReminders(
	days: { date: string; parsed: ParsedDay }[],
	slots: ScheduleSlot[],
	events: ScheduleEvent[],
	now: number
): Reminder[] {
	const out: Reminder[] = [];
	for (const { date, parsed } of days) {
		for (const line of parsed.timed) {
			if (line.done || line.time === null) continue;
			out.push({
				at: at(date, line.time),
				title: line.timeLabel ?? 'Reminder',
				body:
					line.segments
						.map((s) => s.text)
						.join('')
						.trim() || 'Timed task',
				route: dayHref(date)
			});
		}
	}
	if (days.length) {
		const from = days[0].date;
		const to = days[days.length - 1].date;
		for (const { event } of occurrences(slots, events, from, to)) {
			if (event.status !== 'planned' || !event.date) continue;
			const start = minutes(event.start);
			if (!Number.isFinite(start) || start >= 24 * 60) continue;
			const kind = EVENT_KINDS.find((k) => k.id === event.kind)?.label ?? 'Event';
			out.push({
				at: at(event.date, start - HEADS_UP_MIN),
				title: `${kind} in ${HEADS_UP_MIN} min`,
				body: [event.title, event.room].filter(Boolean).join(' · '),
				route: '/schedule'
			});
		}
	}
	return out.filter((r) => r.at > now).sort((a, b) => a.at - b.at);
}

/** Recomputes today's and tomorrow's reminders and hands them to the desktop shell. */
export async function syncReminders(uid: string): Promise<void> {
	if (!desktop) return;
	const today = dateKey();
	const tomorrow = addDays(today, 1);
	const [todayText, tomorrowText, slots, events] = await Promise.all([
		loadDay(uid, today),
		loadDay(uid, tomorrow),
		listSlots(uid),
		listEvents(uid)
	]);
	desktop.setReminders(
		buildReminders(
			[
				{ date: today, parsed: parseDay(todayText) },
				{ date: tomorrow, parsed: parseDay(tomorrowText) }
			],
			slots,
			events,
			Date.now()
		)
	);
}
