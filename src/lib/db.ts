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
	writeBatch,
	type WriteBatch
} from 'firebase/firestore';
import { db } from './firebase';
import { extractMentions, stripMention } from './parse';
import type { AppSettings } from './settings.svelte';

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

export interface Subtask {
	text: string;
	done: boolean;
}

/**
 * A long-standing task (e.g. "master's thesis") lives outside any single day:
 * it shows up on every day page from the day it was added until the day it was
 * crossed out, so nothing needs to be copied forward. Crossing it out on a day
 * keeps it visible (struck through) on that day only.
 */
export interface LongTermTask {
	id: string;
	text: string;
	/** Priority — lower sorts first. */
	order: number;
	/** Day key (`YYYY-MM-DD`) the task was added. */
	createdOn: string;
	/** Day key it was crossed out, or null while still open. */
	completedOn: string | null;
	subtasks: Subtask[];
}

/** A place money lives — bank account, mobile wallet, or cash in hand. */
export interface Account {
	id: string;
	name: string;
	/** Balance before any recorded transactions — set once so running balances line up with reality. */
	startingBalance: number;
	/** Lower sorts first. */
	order: number;
}

/**
 * `lend` = money you handed to a person (they owe you — or it settles what you
 * owed them); `borrow` = money a person handed to you (you owe them — or it
 * settles what they owed you). Debts net out per person from these two kinds.
 */
export type TransactionKind = 'income' | 'expense' | 'transfer' | 'lend' | 'borrow';

export interface Transaction {
	id: string;
	/** Day key (`YYYY-MM-DD`) the transaction happened. */
	date: string;
	kind: TransactionKind;
	/** e.g. salary, lunch, transport — free text, presets suggested in the UI. */
	category: string;
	amount: number;
	/** Account id the money left — null for income and borrow. */
	from: string | null;
	/** Account id the money entered — null for expense and lend. */
	to: string | null;
	/** Person handle on the other side of a lend/borrow — null for other kinds. */
	person: string | null;
	note: string;
	/** Client clock millis — orders transactions within a day. */
	createdAt: number;
}

const settingsDoc = (uid: string) => doc(db, 'users', uid, 'settings', 'app');
const daysCol = (uid: string) => collection(db, 'users', uid, 'days');
const peopleCol = (uid: string) => collection(db, 'users', uid, 'people');
const notesCol = (uid: string) => collection(db, 'users', uid, 'notes');
const longTermCol = (uid: string) => collection(db, 'users', uid, 'longterm');
const accountsCol = (uid: string) => collection(db, 'users', uid, 'accounts');
const txnsCol = (uid: string) => collection(db, 'users', uid, 'transactions');

export async function loadSettings(uid: string): Promise<Partial<AppSettings>> {
	const snap = await getDoc(settingsDoc(uid));
	if (!snap.exists()) return {};
	const data = snap.data();
	delete data.updatedAt;
	return data as Partial<AppSettings>;
}

export async function saveSettings(uid: string, settings: AppSettings): Promise<void> {
	await setDoc(settingsDoc(uid), { ...settings, updatedAt: serverTimestamp() });
}

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

/** Every day's raw text, oldest first (doc ids are `YYYY-MM-DD`, so they sort chronologically). */
export async function listDays(uid: string): Promise<{ date: string; text: string }[]> {
	const snap = await getDocs(daysCol(uid));
	return snap.docs
		.map((d) => ({ date: d.id, text: (d.data() as DayDoc).text ?? '' }))
		.sort((a, b) => a.date.localeCompare(b.date));
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

/** Reserves a fresh long-term task id without writing anything yet. */
export function newLongTermId(uid: string): string {
	return doc(longTermCol(uid)).id;
}

export async function listLongTermTasks(uid: string): Promise<LongTermTask[]> {
	const snap = await getDocs(query(longTermCol(uid), orderBy('order')));
	return snap.docs.map((d) => {
		const data = d.data();
		return {
			id: d.id,
			text: (data.text as string) ?? '',
			order: (data.order as number) ?? 0,
			createdOn: (data.createdOn as string) ?? '',
			completedOn: (data.completedOn as string | null) ?? null,
			subtasks: (data.subtasks as Subtask[]) ?? []
		};
	});
}

export async function saveLongTermTask(uid: string, task: LongTermTask): Promise<void> {
	const { id, ...rest } = task;
	await setDoc(doc(longTermCol(uid), id), { ...rest, updatedAt: serverTimestamp() });
}

export async function deleteLongTermTask(uid: string, id: string): Promise<void> {
	await deleteDoc(doc(longTermCol(uid), id));
}

/** Reserves a fresh account id without writing anything yet. */
export function newAccountId(uid: string): string {
	return doc(accountsCol(uid)).id;
}

export async function listAccounts(uid: string): Promise<Account[]> {
	const snap = await getDocs(query(accountsCol(uid), orderBy('order')));
	return snap.docs.map((d) => {
		const data = d.data();
		return {
			id: d.id,
			name: (data.name as string) ?? '',
			startingBalance: (data.startingBalance as number) ?? 0,
			order: (data.order as number) ?? 0
		};
	});
}

export async function saveAccount(uid: string, account: Account): Promise<void> {
	const { id, ...rest } = account;
	await setDoc(doc(accountsCol(uid), id), { ...rest, updatedAt: serverTimestamp() });
}

export async function deleteAccount(uid: string, id: string): Promise<void> {
	await deleteDoc(doc(accountsCol(uid), id));
}

/** Reserves a fresh transaction id without writing anything yet. */
export function newTransactionId(uid: string): string {
	return doc(txnsCol(uid)).id;
}

function toTransaction(id: string, data: Record<string, unknown>): Transaction {
	return {
		id,
		date: (data.date as string) ?? '',
		kind: (data.kind as TransactionKind) ?? 'expense',
		category: (data.category as string) ?? '',
		amount: (data.amount as number) ?? 0,
		from: (data.from as string | null) ?? null,
		to: (data.to as string | null) ?? null,
		person: (data.person as string | null) ?? null,
		note: (data.note as string) ?? '',
		createdAt: (data.createdAt as number) ?? 0
	};
}

/** All transactions, newest day first; stable within a day by entry time. */
export async function listTransactions(uid: string): Promise<Transaction[]> {
	const snap = await getDocs(query(txnsCol(uid), orderBy('date', 'desc')));
	return snap.docs
		.map((d) => toTransaction(d.id, d.data()))
		.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

/** A single day's transactions in the order they were entered. */
export async function listDayTransactions(uid: string, key: string): Promise<Transaction[]> {
	const snap = await getDocs(query(txnsCol(uid), where('date', '==', key)));
	return snap.docs
		.map((d) => toTransaction(d.id, d.data()))
		.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveTransaction(uid: string, txn: Transaction): Promise<void> {
	const { id, ...rest } = txn;
	await setDoc(doc(txnsCol(uid), id), { ...rest, updatedAt: serverTimestamp() });
}

export async function deleteTransaction(uid: string, id: string): Promise<void> {
	await deleteDoc(doc(txnsCol(uid), id));
}

/** Everything a user has stored — the unit of backup export/import. */
export interface UserData {
	settings: Partial<AppSettings>;
	days: { date: string; text: string }[];
	people: Person[];
	notes: Note[];
	longTermTasks: LongTermTask[];
	accounts: Account[];
	transactions: Transaction[];
}

export async function exportUserData(uid: string): Promise<UserData> {
	const [settings, days, people, notes, longTermTasks, accounts, transactions] = await Promise.all([
		loadSettings(uid),
		listDays(uid),
		listPeople(uid),
		listNotes(uid),
		listLongTermTasks(uid),
		listAccounts(uid),
		listTransactions(uid)
	]);
	return { settings, days, people, notes, longTermTasks, accounts, transactions };
}

/**
 * Writes a backup into the user's data. Docs are keyed the same way the app
 * writes them (days by date, people by handle, the rest by id), so importing
 * overwrites matching docs and leaves everything else untouched — re-running
 * a partially failed import is safe.
 */
export async function importUserData(uid: string, data: UserData): Promise<void> {
	const ops: ((batch: WriteBatch) => void)[] = [];
	if (Object.keys(data.settings).length > 0)
		ops.push((b) => b.set(settingsDoc(uid), { ...data.settings, updatedAt: serverTimestamp() }));
	for (const day of data.days)
		ops.push((b) =>
			b.set(doc(daysCol(uid), day.date), {
				text: day.text,
				mentions: extractMentions(day.text),
				updatedAt: serverTimestamp()
			})
		);
	for (const person of data.people)
		ops.push((b) =>
			b.set(doc(peopleCol(uid), person.handle), { ...person, updatedAt: serverTimestamp() })
		);
	for (const note of data.notes) {
		const { id, ...rest } = note;
		ops.push((b) => b.set(doc(notesCol(uid), id), { ...rest, updatedAt: serverTimestamp() }));
	}
	for (const task of data.longTermTasks) {
		const { id, ...rest } = task;
		ops.push((b) => b.set(doc(longTermCol(uid), id), { ...rest, updatedAt: serverTimestamp() }));
	}
	for (const account of data.accounts) {
		const { id, ...rest } = account;
		ops.push((b) => b.set(doc(accountsCol(uid), id), { ...rest, updatedAt: serverTimestamp() }));
	}
	for (const txn of data.transactions) {
		const { id, ...rest } = txn;
		ops.push((b) => b.set(doc(txnsCol(uid), id), { ...rest, updatedAt: serverTimestamp() }));
	}
	// Firestore caps a batch at 500 writes, so commit in chunks.
	for (let i = 0; i < ops.length; i += 450) {
		const batch = writeBatch(db);
		for (const op of ops.slice(i, i + 450)) op(batch);
		await batch.commit();
	}
}
