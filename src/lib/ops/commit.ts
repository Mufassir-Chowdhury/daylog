/**
 * Writes changes through `db.ts` and wires up undo. `run` is what callers use:
 * it updates the caller's state right away, saves in the background (Firestore's
 * offline cache makes the write durable at once) and shows an Undo toast.
 */
import { editDayLines, type LineEdit } from '../capture';
import {
	deleteDeadline,
	deleteEvent,
	deleteLongTermTask,
	deleteNote,
	deleteSlot,
	deleteTask,
	deleteTransaction,
	saveDeadline,
	saveEvent,
	saveLongTermTask,
	saveNote,
	savePerson,
	saveRoutineValue,
	saveSlot,
	saveTask,
	saveTransaction,
	saveWeekNote
} from '../db';
import { liveEditor } from '../live';
import { saveFailed, toast } from '../toast.svelte';
import { invert, type Change } from './change';

function write(uid: string, c: Change): Promise<void> {
	switch (c.kind) {
		case 'slot':
			return c.after ? saveSlot(uid, c.after) : deleteSlot(uid, c.id);
		case 'event':
			return c.after ? saveEvent(uid, c.after) : deleteEvent(uid, c.id);
		case 'task':
			return c.after ? saveTask(uid, c.after) : deleteTask(uid, c.id);
		case 'deadline':
			return c.after ? saveDeadline(uid, c.after) : deleteDeadline(uid, c.id);
		case 'weekNote':
			// An empty note deletes the doc.
			return saveWeekNote(uid, c.after ?? { week: c.id, text: '' });
		case 'transaction':
			return c.after ? saveTransaction(uid, c.after) : deleteTransaction(uid, c.id);
		case 'note': {
			if (!c.after) return deleteNote(uid, c.id);
			// An open note page shows the change and saves it itself.
			const editor = liveEditor('note', c.id);
			if (editor) return Promise.resolve(editor(c.after));
			return saveNote(uid, c.after);
		}
		case 'longterm':
			return c.after ? saveLongTermTask(uid, c.after) : deleteLongTermTask(uid, c.id);
		case 'person': {
			// Deleting a person rewrites every day that mentions them — never an op.
			if (!c.after) return Promise.reject(new Error('People are not deleted by ops'));
			// savePerson merges, so blank out fields the other side doesn't have.
			const { handle, name = '', bio = '' } = c.after;
			const editor = liveEditor('person', handle);
			if (editor) return Promise.resolve(editor({ handle, name, bio }));
			return savePerson(uid, { handle, name, bio });
		}
		case 'routineValue': {
			const { date, routineId } = (c.after ?? c.before)!;
			return saveRoutineValue(uid, date, routineId, c.after?.value ?? null);
		}
		case 'dayLine':
			// Day lines are written per day in `commit`.
			return Promise.resolve();
	}
}

/** Writes the changes. Lines for the same day are applied together, in order. */
export async function commit(uid: string, changes: Change[]): Promise<void> {
	const days = new Map<string, LineEdit[]>();
	for (const c of changes) {
		if (c.kind !== 'dayLine') continue;
		const edit = { from: c.before?.line ?? null, to: c.after?.line ?? null };
		days.set(c.id, [...(days.get(c.id) ?? []), edit]);
	}
	await Promise.all([
		...changes.map((c) => write(uid, c)),
		...[...days].map(([date, edits]) => editDayLines(uid, date, edits))
	]);
}

export interface RunOptions {
	/**
	 * Applies changes to the caller's own state so the screen updates at once.
	 * Called with the inverse changes on undo.
	 */
	local?: (changes: Change[]) => void;
	/** Toast shown after the change, with an Undo button. */
	message?: string;
}

/** Applies `changes` locally, saves them in the background and offers undo. */
export function run(uid: string, changes: Change[], opts: RunOptions = {}): void {
	if (changes.length === 0) return;
	opts.local?.(changes);
	commit(uid, changes).catch(saveFailed);
	if (opts.message)
		toast(opts.message, {
			undo: () => {
				const back = invert(changes);
				opts.local?.(back);
				commit(uid, back).catch(saveFailed);
			}
		});
}
