/**
 * Quick capture: append one line to a day from anywhere — the command palette,
 * or the desktop quick bar (which forwards to the main window).
 */
import { loadDay, savePerson, saveDay } from './db';
import type { CaptureEntry } from './desktop';
import { extractMentions, joinLine } from './parse';

/**
 * Open day pages register an appender so a captured line lands in their live
 * text — writing to Firestore behind their back would be overwritten by the
 * page's next autosave.
 */
const live = new Map<string, (line: string) => void>();

export function registerDayAppender(date: string, append: (line: string) => void): () => void {
	live.set(date, append);
	return () => {
		if (live.get(date) === append) live.delete(date);
	};
}

/** Appends `line` to the end of a day's text (people it mentions get profiles, as in the editor). */
export async function appendToDay(uid: string, { date, line }: CaptureEntry): Promise<void> {
	const append = live.get(date);
	if (append) {
		append(line);
		return;
	}
	const text = await loadDay(uid, date);
	await Promise.all([
		saveDay(uid, date, joinLine(text, line)),
		...extractMentions(line).map((handle) => savePerson(uid, { handle }))
	]);
}
