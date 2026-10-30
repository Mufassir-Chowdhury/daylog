/**
 * Quick capture: append one line to a day from anywhere — the command palette,
 * or the desktop quick bar (which forwards to the main window). Also how the
 * ops layer adds a line to a day and takes it back out on undo.
 */
import { loadDay, savePerson, saveDay } from './db';
import type { CaptureEntry } from './desktop';
import { extractMentions, joinLine, removeLine } from './parse';

export interface DayEditor {
	append(line: string): void;
	remove(line: string): void;
}

/**
 * Open day pages register an editor so captured lines land in their live
 * text — writing to Firestore behind their back would be overwritten by the
 * page's next autosave.
 */
const live = new Map<string, DayEditor>();

export function registerDayEditor(date: string, editor: DayEditor): () => void {
	live.set(date, editor);
	return () => {
		if (live.get(date) === editor) live.delete(date);
	};
}

/** Appends `line` to the end of a day's text (people it mentions get profiles, as in the editor). */
export async function appendToDay(uid: string, { date, line }: CaptureEntry): Promise<void> {
	const editor = live.get(date);
	if (editor) {
		editor.append(line);
		return;
	}
	const text = await loadDay(uid, date);
	await Promise.all([
		saveDay(uid, date, joinLine(text, line)),
		...extractMentions(line).map((handle) => savePerson(uid, { handle }))
	]);
}

/**
 * Adds and removes lines on one day in order — the ops layer's way of writing
 * day text. Without an open page it loads the text once and saves it once.
 */
export async function editDayLines(
	uid: string,
	date: string,
	edits: { line: string; add: boolean }[]
): Promise<void> {
	const editor = live.get(date);
	if (editor) {
		for (const { line, add } of edits) {
			if (add) editor.append(line);
			else editor.remove(line);
		}
		return;
	}
	const text = await loadDay(uid, date);
	const next = edits.reduce(
		(acc, { line, add }) => (add ? joinLine(acc, line) : removeLine(acc, line)),
		text
	);
	const handles = new Set(edits.filter((e) => e.add).flatMap((e) => extractMentions(e.line)));
	await Promise.all([
		...(next !== text ? [saveDay(uid, date, next)] : []),
		...[...handles].map((handle) => savePerson(uid, { handle }))
	]);
}
