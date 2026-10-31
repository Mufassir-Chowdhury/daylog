/**
 * Detectors: cheap, local checks that notice something worth the assistant's
 * attention between check-ins. Each is pure — `(data, today) → Signal[]` — and
 * gives every signal a stable `key`, so the same thing is only raised once
 * (see `signals.ts`). Only a signal that's new starts a background run.
 *
 * Step 6 adds more (money watch, pre-event prep, focus); these two prove the
 * engine.
 */
import { addDays } from '../../date';
import type { Deadline, PlanTask } from '../../db';
import { parseDay } from '../../parse';
import { daysUntil } from '../../schedule';

export interface DetectorData {
	today: string;
	/** Day texts by key: at least yesterday's. */
	days: Record<string, string>;
	deadlines: Deadline[];
	tasks: PlanTask[];
}

export interface Signal {
	/** Stable: the same situation always gives the same key. */
	key: string;
	/** Which detector raised it (for feedback, Step 5.7). */
	type: string;
	/** For the card, if the run leaves a note: "Left open yesterday". */
	title: string;
	/** What the background run is told, in a sentence or two, with the facts it needs. */
	about: string;
	/** Higher shows first in the Inbox. */
	priority: number;
	/**
	 * A write tool whose cards already deal with this: if one was made today
	 * (say, by the morning warm-up), the signal needs no run of its own.
	 */
	coveredBy?: string;
}

export type Detector = (data: DetectorData) => Signal[];

/** Lines left open on yesterday's page: offer to carry them over. */
export const carryOver: Detector = ({ today, days }) => {
	const yesterday = addDays(today, -1);
	const { timed, notes } = parseDay(days[yesterday] ?? '');
	const open = [...timed, ...notes].filter((l) => !l.done);
	if (!open.length) return [];
	return [
		{
			key: `carryover:${yesterday}`,
			type: 'carryover',
			title: 'Left open yesterday',
			coveredBy: 'move_line',
			about:
				`${open.length} line${open.length === 1 ? ' was' : 's were'} left open on yesterday's page (${yesterday}): ` +
				open.map((l) => `“${l.raw.trim()}”`).join(', ') +
				'. Propose moving the ones still worth doing to today with move_line; leave the rest.',
			priority: 1
		}
	];
};

/** Words that say what a deadline is about ("DBMS", "thesis"), for matching tasks to it. */
function topicWords(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length >= 3 && !STOP.has(w));
}
const STOP = new Set(['the', 'and', 'for', 'due', 'submit', 'submission', 'deadline', 'with']);

/** A deadline within 5 days with no open task about it: offer a plan. */
export const unplannedDeadline: Detector = ({ today, deadlines, tasks }) => {
	const open = tasks.filter((t) => t.status === 'open');
	return deadlines
		.filter((d) => !d.done && d.due !== null)
		.filter((d) => {
			const left = daysUntil(d.due!, today);
			return left >= 0 && left <= 5;
		})
		.filter((d) => {
			const words = topicWords(d.text);
			return !open.some((t) => topicWords(t.text).some((w) => words.includes(w)));
		})
		.map((d) => {
			const left = daysUntil(d.due!, today);
			return {
				key: `deadline:${d.id}`,
				type: 'deadline',
				title: `Coming up: ${d.text}`,
				about:
					`The deadline “${d.text}”${d.hard ? ' (hard)' : ''} is due ${d.due} (${left === 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`}) ` +
					'and no open task is about it. Check the schedule for free time, then propose 2–4 tasks (add_task with dates and time blocks) that get it done in time.',
				priority: d.hard || left <= 2 ? 2 : 1
			};
		});
};

export const DETECTORS: Detector[] = [carryOver, unplannedDeadline];

export function detect(data: DetectorData, detectors: Detector[] = DETECTORS): Signal[] {
	return detectors.flatMap((d) => d(data));
}
