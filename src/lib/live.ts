/**
 * Pages that edit a document in place (a note, a person's name and bio)
 * register here while open. Changes made elsewhere — by the assistant, or an
 * undo — then go through the page, which shows them and saves them itself;
 * writing to Firestore behind its back would be overwritten by its next
 * autosave. (Day text has its own registry in capture.ts.)
 */
import type { Note, Person } from './db';

interface LiveDocs {
	note: Note;
	person: Person;
}

const editors = new Map<string, (doc: never) => void>();

export function registerLive<K extends keyof LiveDocs>(
	kind: K,
	id: string,
	apply: (doc: LiveDocs[K]) => void
): () => void {
	const key = `${kind}:${id}`;
	editors.set(key, apply);
	return () => {
		if (editors.get(key) === apply) editors.delete(key);
	};
}

/** The open page's editor for this document, if one is open. */
export function liveEditor<K extends keyof LiveDocs>(
	kind: K,
	id: string
): ((doc: LiveDocs[K]) => void) | undefined {
	return editors.get(`${kind}:${id}`) as ((doc: LiveDocs[K]) => void) | undefined;
}
