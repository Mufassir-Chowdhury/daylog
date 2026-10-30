/**
 * Quick capture: append one line to a day from anywhere — the command palette,
 * or the desktop quick bar (which forwards to the main window). Also how the
 * ops layer adds a line to a day and takes it back out on undo.
 */
import { loadDay, savePerson, saveDay } from './db';
import type { CaptureEntry } from './desktop';
import { extractMentions, joinLine, replaceLine } from './parse';

export interface DayEditor {
	append(line: string): void;
	/** Replaces the last line reading exactly `from`; null removes it. */
	replace(from: string, to: string | null): void;
}

/** One edit to a day's lines: add (`from` null), change, or remove (`to` null). */
export interface LineEdit {
	from: string | null;
	to: string | null;
}

const applyEdit = (text: string, { from, to }: LineEdit) =>
	from === null ? (to === null ? text : joinLine(text, to)) : replaceLine(text, from, to);

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
 * Adds, changes and removes lines on one day in order — the ops layer's way of
 * writing day text. Without an open page it loads the text once and saves it once.
 */
export async function editDayLines(uid: string, date: string, edits: LineEdit[]): Promise<void> {
	const editor = live.get(date);
	if (editor) {
		for (const { from, to } of edits) {
			if (from === null) {
				if (to !== null) editor.append(to);
			} else editor.replace(from, to);
		}
		return;
	}
	const text = await loadDay(uid, date);
	const next = edits.reduce(applyEdit, text);
	const handles = new Set(edits.flatMap((e) => (e.to ? extractMentions(e.to) : [])));
	await Promise.all([
		...(next !== text ? [saveDay(uid, date, next)] : []),
		...[...handles].map((handle) => savePerson(uid, { handle }))
	]);
}
