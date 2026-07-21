import {
	collection,
	deleteDoc,
	doc,
	getDoc,
	getDocs,
	orderBy,
	query,
	serverTimestamp,
	setDoc,
	where,
	writeBatch
} from 'firebase/firestore';
import { db } from './firebase';
import { extractMentions, stripMention } from './parse';

export interface DayDoc {
	text: string;
	mentions: string[];
}

export interface Person {
	handle: string;
	name?: string;
	bio?: string;
}

export interface Note {
	id: string;
	title: string;
	content: string;
	tags: string[];
}

const daysCol = (uid: string) => collection(db, 'users', uid, 'days');
const peopleCol = (uid: string) => collection(db, 'users', uid, 'people');
const notesCol = (uid: string) => collection(db, 'users', uid, 'notes');

export async function loadDay(uid: string, key: string): Promise<string> {
	const snap = await getDoc(doc(daysCol(uid), key));
	return snap.exists() ? ((snap.data() as DayDoc).text ?? '') : '';
}

/**
 * Saves a day's raw text and extracts `@mentions` into an indexable array.
 * People docs are NOT created here — a person is only added when the user
 * commits a mention in the editor (space/enter) or picks a suggestion.
 */
export async function saveDay(uid: string, key: string, text: string): Promise<void> {
	await setDoc(doc(daysCol(uid), key), {
		text,
		mentions: extractMentions(text),
		updatedAt: serverTimestamp()
	});
}

export async function listPeople(uid: string): Promise<Person[]> {
	const snap = await getDocs(query(peopleCol(uid), orderBy('handle')));
	return snap.docs.map((d) => d.data() as Person);
}

export async function loadPerson(uid: string, handle: string): Promise<Person> {
	const snap = await getDoc(doc(peopleCol(uid), handle));
	return snap.exists() ? (snap.data() as Person) : { handle };
}

export async function savePerson(uid: string, person: Person): Promise<void> {
	await setDoc(
		doc(peopleCol(uid), person.handle),
		{ ...person, updatedAt: serverTimestamp() },
		{ merge: true }
	);
}

/**
 * Deletes a person and removes every `@mention` of them: each day that
 * mentions the handle is rewritten with the `@` stripped (plain name, no link),
 * then the person doc itself is deleted.
 */
export async function deletePerson(uid: string, handle: string): Promise<void> {
	const days = await daysMentioning(uid, handle);
	const batch = writeBatch(db);
	for (const { date, text } of days) {
		const stripped = stripMention(text, handle);
		batch.set(doc(daysCol(uid), date), {
			text: stripped,
			mentions: extractMentions(stripped),
			updatedAt: serverTimestamp()
		});
	}
	batch.delete(doc(peopleCol(uid), handle));
	await batch.commit();
}

/** All days mentioning a handle, newest first (day doc ids sort chronologically). */
export async function daysMentioning(
	uid: string,
	handle: string
): Promise<{ date: string; text: string }[]> {
	const snap = await getDocs(query(daysCol(uid), where('mentions', 'array-contains', handle)));
	return snap.docs
		.map((d) => ({ date: d.id, text: (d.data() as DayDoc).text }))
		.sort((a, b) => b.date.localeCompare(a.date));
}

/** Reserves a fresh note id without writing anything yet. */
export function newNoteId(uid: string): string {
	return doc(notesCol(uid)).id;
}

export async function listNotes(uid: string): Promise<Note[]> {
	const snap = await getDocs(query(notesCol(uid), orderBy('updatedAt', 'desc')));
	return snap.docs.map((d) => {
		const data = d.data();
		return {
			id: d.id,
			title: (data.title as string) ?? '',
			content: (data.content as string) ?? '',
			tags: (data.tags as string[]) ?? []
		};
	});
}

export async function loadNote(uid: string, id: string): Promise<Note> {
	const snap = await getDoc(doc(notesCol(uid), id));
	if (!snap.exists()) return { id, title: '', content: '', tags: [] };
	const data = snap.data();
	return {
		id,
		title: (data.title as string) ?? '',
		content: (data.content as string) ?? '',
		tags: (data.tags as string[]) ?? []
	};
}

export async function saveNote(uid: string, note: Note): Promise<void> {
	await setDoc(doc(notesCol(uid), note.id), {
		title: note.title,
		content: note.content,
		tags: note.tags,
		updatedAt: serverTimestamp()
	});
}

export async function deleteNote(uid: string, id: string): Promise<void> {
	await deleteDoc(doc(notesCol(uid), id));
}
