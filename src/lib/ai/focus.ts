/**
 * The focus coach (desktop, opt-in): a nudge when a distraction limit is about
 * to run out or has run out, or when your best focus hours start with nothing
 * planned. At most one nudge an hour, none in quiet hours, each kind once a
 * day. Made locally from this computer's activity — no model call, so it's
 * instant and free. Pure.
 */
import { formatDuration, goalSubject, hourLabel, type GoalProgress } from '../activity';
import type { Block } from './freetime';

export const NUDGE_GAP = 60 * 60_000;
/** A limit counts as nearly used up from here. */
const NEARLY = 0.8;
/** The focus window's nudge only in its first minutes. */
const WINDOW_GRACE = 20;

export interface FocusInput {
	now: Date;
	today: string;
	goals: GoalProgress[];
	/** The two best focus hours start at this hour, if there's enough history. */
	best: { hour: number } | null;
	/** Today's free blocks (minutes since midnight). */
	free: Block[];
	/** Something worth the focus time: a highlighted or dated open task. */
	topTask: string | null;
	/** When the last nudge went out (ms). */
	lastNudge: number;
	/** Keys already sent. */
	sent: Set<string>;
	quiet: boolean;
}

export interface Nudge {
	key: string;
	title: string;
	body: string;
}

export function focusNudge(i: FocusInput): Nudge | null {
	if (i.quiet || i.now.getTime() - i.lastNudge < NUDGE_GAP) return null;
	for (const p of i.goals) {
		if (!p.goal.limit || p.target <= 0) continue;
		const subject = goalSubject(p.goal);
		if (p.ratio >= 1) {
			const key = `over:${p.goal.id}:${i.today}`;
			if (!i.sent.has(key))
				return {
					key,
					title: `${subject}: limit passed`,
					body: `${formatDuration(p.ms)} today, against at most ${formatDuration(p.target)}.`
				};
		} else if (p.ratio >= NEARLY) {
			const key = `limit:${p.goal.id}:${i.today}`;
			if (!i.sent.has(key))
				return {
					key,
					title: `${subject}: ${formatDuration(p.target - p.ms)} left`,
					body: `${formatDuration(p.ms)} of your ${formatDuration(p.target)} for today is used.`
				};
		}
	}
	if (i.best) {
		const start = i.best.hour * 60;
		const minute = i.now.getHours() * 60 + i.now.getMinutes();
		const key = `focus:${i.today}`;
		// Today's free time starts at the next quarter hour.
		const from = Math.ceil(minute / 15) * 15;
		const open = i.free.some((b) => b.start <= from && b.end >= start + 120);
		if (minute >= start && minute - start < WINDOW_GRACE && open && !i.sent.has(key))
			return {
				key,
				title: 'Your best focus hours',
				body:
					`${hourLabel(i.best.hour)}–${hourLabel(i.best.hour + 2)} is usually your most focused time, and nothing is planned.` +
					(i.topTask ? ` A good moment for “${i.topTask}”.` : '')
			};
	}
	return null;
}

/** The task worth the focus time: a highlighted one first, then today's, then overdue. */
export function topTask(
	tasks: { text: string; status: string; date: string | null; highlight: boolean }[],
	today: string
): string | null {
	const open = tasks.filter((t) => t.status === 'open' && t.date !== null && t.date <= today);
	return (
		open.find((t) => t.highlight)?.text ??
		open.find((t) => t.date === today)?.text ??
		open[0]?.text ??
		null
	);
}
