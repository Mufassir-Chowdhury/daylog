/**
 * The ops layer's unit of work: one stored document going from `before` to
 * `after`. Pages, and later the assistant, describe what they want as a list
 * of changes; `commit` writes them, and `invert` gives the undo. Everything in
 * this file is pure.
 */
import type {
	Deadline,
	LongTermTask,
	Note,
	Person,
	PlanTask,
	ScheduleEvent,
	ScheduleSlot,
	Transaction,
	WeekNote
} from '../db';
import type { FollowUp } from '../ai/followup';
import type { MemoryItem } from '../ai/memory';

/** One routine's value on one day. */
export interface RoutineValue {
	date: string;
	routineId: string;
	value: number;
}

/**
 * A line of a day's text. Created = added at the end, removed = taken out,
 * changed = the last line reading `before.line` rewritten as `after.line`.
 */
export interface DayLine {
	date: string;
	line: string;
}

export interface DocTypes {
	slot: ScheduleSlot;
	event: ScheduleEvent;
	task: PlanTask;
	deadline: Deadline;
	weekNote: WeekNote;
	transaction: Transaction;
	note: Note;
	longterm: LongTermTask;
	person: Person;
	routineValue: RoutineValue;
	dayLine: DayLine;
	/** Something the assistant remembers. */
	memory: MemoryItem;
	/** A check-in the assistant scheduled for itself. */
	followup: FollowUp;
}

export type Kind = keyof DocTypes;

/** `before === null` means the change creates the document, `after === null` that it removes it. */
export type Change = {
	[K in Kind]: { kind: K; id: string; before: DocTypes[K] | null; after: DocTypes[K] | null };
}[Kind];

/** The id a document is stored under. */
export function keyOf<K extends Kind>(kind: K, item: DocTypes[K]): string {
	switch (kind) {
		case 'weekNote':
			return (item as WeekNote).week;
		case 'person':
			return (item as Person).handle;
		case 'routineValue': {
			const v = item as RoutineValue;
			return `${v.date}:${v.routineId}`;
		}
		case 'dayLine':
			return (item as DayLine).date;
		default:
			return (item as { id: string }).id;
	}
}

export function change<K extends Kind>(
	kind: K,
	before: DocTypes[K] | null,
	after: DocTypes[K] | null
): Change {
	const item = (after ?? before)!;
	return { kind, id: keyOf(kind, item), before, after } as Change;
}

/** Saving `after` over whatever `list` holds under the same id (nothing = a create). */
export function put<K extends Kind>(kind: K, list: DocTypes[K][], after: DocTypes[K]): Change {
	const id = keyOf(kind, after);
	return change(kind, list.find((item) => keyOf(kind, item) === id) ?? null, after);
}

/** The changes that undo `changes`, in reverse order. */
export function invert(changes: Change[]): Change[] {
	return changes
		.slice()
		.reverse()
		.map((c) => ({ ...c, before: c.after, after: c.before }) as Change);
}

/** Applies the changes of one kind to a list held in page state; new items go at the end. */
export function patch<K extends Kind>(
	list: DocTypes[K][],
	changes: Change[],
	kind: K
): DocTypes[K][] {
	let out = list;
	for (const c of changes) {
		if (c.kind !== kind) continue;
		const rest = out.filter((item) => keyOf(kind, item) !== c.id);
		if (c.after === null) out = rest;
		else if (rest.length === out.length) out = [...out, c.after as DocTypes[K]];
		else out = out.map((item) => (keyOf(kind, item) === c.id ? (c.after as DocTypes[K]) : item));
	}
	return out;
}
