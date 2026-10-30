/**
 * Whether changes planned a while ago still fit what's stored: every document
 * a change edits must still look like its `before`. The assistant's proposal
 * cards check this before applying, so an old card can't undo newer edits.
 */
import {
	listDeadlines,
	listEvents,
	listLongTermTasks,
	listSlots,
	listTasks,
	listTransactions,
	listWeekNotes,
	loadDay,
	loadNote,
	loadPerson,
	loadRoutineLog
} from '../db';
import type { Change, Kind } from './change';

/** The stored version of a document, or null when there is none. */
async function current(uid: string, c: Change): Promise<unknown> {
	const byId = async <T extends { id: string }>(list: Promise<T[]>) =>
		(await list).find((d) => d.id === c.id) ?? null;
	switch (c.kind) {
		case 'slot':
			return byId(listSlots(uid));
		case 'event':
			return byId(listEvents(uid));
		case 'task':
			return byId(listTasks(uid));
		case 'deadline':
			return byId(listDeadlines(uid));
		case 'transaction':
			return byId(listTransactions(uid));
		case 'longterm':
			return byId(listLongTermTasks(uid));
		case 'weekNote':
			return (await listWeekNotes(uid)).find((n) => n.week === c.id) ?? null;
		case 'note': {
			const note = await loadNote(uid, c.id);
			return note.title || note.content || note.tags.length ? note : null;
		}
		case 'person': {
			const { handle, name = '', bio = '' } = await loadPerson(uid, c.id);
			return { handle, name, bio };
		}
		case 'routineValue': {
			const [date, routineId] = c.id.split(':');
			const value = (await loadRoutineLog(uid, date))[routineId];
			return typeof value === 'number' ? { date, routineId, value } : null;
		}
		case 'dayLine':
			return loadDay(uid, c.id);
	}
}

/** Same content, ignoring key order and blank optional person fields. */
function same(kind: Kind, a: unknown, b: unknown): boolean {
	if (kind === 'person' && a && b) {
		const p = (x: unknown) => {
			const { handle, name = '', bio = '' } = x as { handle: string; name?: string; bio?: string };
			return { handle, name, bio };
		};
		return JSON.stringify(p(a)) === JSON.stringify(p(b));
	}
	return stable(a) === stable(b);
}

function stable(value: unknown): string {
	return JSON.stringify(value, (_, v) =>
		v && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)))
			: v
	);
}

/** The changes whose documents changed since they were planned (empty when all still fit). */
export async function staleChanges(uid: string, changes: Change[]): Promise<Change[]> {
	const out: Change[] = [];
	for (const c of changes) {
		if (c.kind === 'dayLine') {
			// A line to change or remove must still be there; adding always fits.
			if (c.before && !((await current(uid, c)) as string).split('\n').includes(c.before.line))
				out.push(c);
			continue;
		}
		if (!same(c.kind, c.before, await current(uid, c))) out.push(c);
	}
	return out;
}
