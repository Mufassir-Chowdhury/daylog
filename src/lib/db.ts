import {
	collection,
	deleteDoc,
	deleteField,
	doc,
	getDoc,
	getDocs,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	setDoc,
	where,
	writeBatch,
	type WriteBatch
} from 'firebase/firestore';
import type { ActivityCategory, ActivityGoal, ActivitySpan } from './activity';
import { cleanGoals } from './activity';
import { db } from './firebase';
import { extractMentions, stripMention } from './parse';
import type { EventKind, EventStatus, TaskStatus } from './schedule';
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

/**
 * A daily routine activity tracked with a number per day — reciting Quran,
 * reading hadith, pages read. Days where the value reaches the threshold show
 * green on the day page.
 */
export interface Routine {
	id: string;
	name: string;
	/** What the number counts — "pages", "minutes", "verses"; free text, may be empty. */
	unit: string;
	/** Daily target — reaching it turns the day's card green. 0 means no target. */
	threshold: number;
	/** Lower sorts first. */
	order: number;
}

/** One day's routine values, keyed by routine id. Doc id is the day key. */
export interface RoutineLog {
	date: string;
	values: Record<string, number>;
}

/** A recurring weekly timetable entry — a class or lab that happens every week on one weekday. */
export interface ScheduleSlot {
	id: string;
	/** e.g. "Introduction to Computing Applications (CSE 0612 2102c)". */
	title: string;
	kind: EventKind;
	/** 0 = Sunday … 6 = Saturday. */
	weekday: number;
	/** `HH:MM`, 24-hour. */
	start: string;
	end: string;
	room: string;
	/** Optional day keys bounding when the slot runs (e.g. the semester). */
	startsOn: string | null;
	endsOn: string | null;
}

/**
 * Something on a specific date: a one-off (exam, meeting, invigilation) or the
 * stored state of one timetable occurrence (`slotId` set, id from `overrideId`).
 * `date === null` means the date isn't fixed yet (TBD).
 */
export interface ScheduleEvent {
	id: string;
	slotId: string | null;
	date: string | null;
	start: string;
	end: string;
	title: string;
	kind: EventKind;
	room: string;
	status: EventStatus;
	/** Shown next to the title — "Moved to Thu 9:00", "shifted from Wednesday", "requested by students". */
	note: string;
}

/** A to-do on the task plan — on a day, a span of days, or (`date === null`) "Later". */
export interface PlanTask {
	id: string;
	text: string;
	date: string | null;
	/** Last day of a span ("Fri–Sat"); null for a single day. */
	until: string | null;
	/** Optional suggested time block, `HH:MM`. */
	start: string;
	end: string;
	status: TaskStatus;
	/** Progress or reason — "Almost done", "Not needed — exam postponed". */
	note: string;
	/** Highlighted block (protected time, e.g. thesis or a paid-work block). */
	highlight: boolean;
	/** Client clock millis — orders tasks within a day. */
	createdAt: number;
}

export interface Deadline {
	id: string;
	text: string;
	/** Earliest due day, used for sorting and the countdown; null when not fixed. */
	due: string | null;
	/** Free-text "when" that overrides the date display — "Oct 24 / 25 / 26", "November". */
	label: string;
	/** Hard deadline — shown in red. */
	hard: boolean;
	done: boolean;
	note: string;
}

/** A free-text remark under one week's table. Doc id is the week's Sunday key. */
export interface WeekNote {
	week: string;
	text: string;
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
	/** Recurring bill/income (rent, subscriptions, salary) — tracked separately from one-off spending. */
	fixed: boolean;
	/**
	 * Free-text label tying related transactions together across days and kinds —
	 * e.g. "Dhaka trip October 2026". Null when the transaction isn't grouped.
	 */
	group: string | null;
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
const routinesCol = (uid: string) => collection(db, 'users', uid, 'routines');
const routineLogsCol = (uid: string) => collection(db, 'users', uid, 'routineLogs');
const slotsCol = (uid: string) => collection(db, 'users', uid, 'slots');
const eventsCol = (uid: string) => collection(db, 'users', uid, 'events');
const tasksCol = (uid: string) => collection(db, 'users', uid, 'tasks');
const deadlinesCol = (uid: string) => collection(db, 'users', uid, 'deadlines');
const weekNotesCol = (uid: string) => collection(db, 'users', uid, 'weekNotes');
const activityCol = (uid: string) => collection(db, 'users', uid, 'activity');
const activityGoalsCol = (uid: string) => collection(db, 'users', uid, 'activityGoals');
const activityConfigDoc = (uid: string) => doc(db, 'users', uid, 'activityConfig', 'main');

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

/** Reserves a fresh routine id without writing anything yet. */
export function newRoutineId(uid: string): string {
	return doc(routinesCol(uid)).id;
}

export async function listRoutines(uid: string): Promise<Routine[]> {
	const snap = await getDocs(query(routinesCol(uid), orderBy('order')));
	return snap.docs.map((d) => {
		const data = d.data();
		return {
			id: d.id,
			name: (data.name as string) ?? '',
			unit: (data.unit as string) ?? '',
			threshold: (data.threshold as number) ?? 0,
			order: (data.order as number) ?? 0
		};
	});
}

export async function saveRoutine(uid: string, routine: Routine): Promise<void> {
	const { id, ...rest } = routine;
	await setDoc(doc(routinesCol(uid), id), { ...rest, updatedAt: serverTimestamp() });
}

/** Deletes the routine definition only — day values it left behind are ignored by the UI. */
export async function deleteRoutine(uid: string, id: string): Promise<void> {
	await deleteDoc(doc(routinesCol(uid), id));
}

/** One day's routine values ({} when nothing was logged). */
export async function loadRoutineLog(uid: string, key: string): Promise<Record<string, number>> {
	const snap = await getDoc(doc(routineLogsCol(uid), key));
	return snap.exists() ? ((snap.data().values as Record<string, number>) ?? {}) : {};
}

/** Sets (or clears, with null) one routine's value for a day without touching the others. */
export async function saveRoutineValue(
	uid: string,
	key: string,
	routineId: string,
	value: number | null
): Promise<void> {
	await setDoc(
		doc(routineLogsCol(uid), key),
		{
			values: { [routineId]: value === null ? deleteField() : value },
			updatedAt: serverTimestamp()
		},
		{ merge: true }
	);
}

/** Every day's routine values, oldest first (doc ids are `YYYY-MM-DD`). */
export async function listRoutineLogs(uid: string): Promise<RoutineLog[]> {
	const snap = await getDocs(routineLogsCol(uid));
	return snap.docs
		.map((d) => ({ date: d.id, values: (d.data().values as Record<string, number>) ?? {} }))
		.sort((a, b) => a.date.localeCompare(b.date));
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
		fixed: (data.fixed as boolean) ?? false,
		group: (data.group as string | null) || null,
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

/** Every lend/borrow (any transaction, really) involving one person, newest first. */
export async function listPersonTransactions(uid: string, handle: string): Promise<Transaction[]> {
	const snap = await getDocs(query(txnsCol(uid), where('person', '==', handle)));
	return snap.docs
		.map((d) => toTransaction(d.id, d.data()))
		.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

export async function saveTransaction(uid: string, txn: Transaction): Promise<void> {
	const { id, ...rest } = txn;
	await setDoc(doc(txnsCol(uid), id), { ...rest, updatedAt: serverTimestamp() });
}

export async function deleteTransaction(uid: string, id: string): Promise<void> {
	await deleteDoc(doc(txnsCol(uid), id));
}

/** Reserves a fresh id in one of the schedule collections without writing anything yet. */
export function newScheduleId(
	uid: string,
	kind: 'slots' | 'events' | 'tasks' | 'deadlines'
): string {
	return doc(collection(db, 'users', uid, kind)).id;
}

function toSlot(id: string, data: Record<string, unknown>): ScheduleSlot {
	return {
		id,
		title: (data.title as string) ?? '',
		kind: (data.kind as EventKind) ?? 'class',
		weekday: (data.weekday as number) ?? 0,
		start: (data.start as string) ?? '',
		end: (data.end as string) ?? '',
		room: (data.room as string) ?? '',
		startsOn: (data.startsOn as string | null) ?? null,
		endsOn: (data.endsOn as string | null) ?? null
	};
}

function toEvent(id: string, data: Record<string, unknown>): ScheduleEvent {
	return {
		id,
		slotId: (data.slotId as string | null) ?? null,
		date: (data.date as string | null) ?? null,
		start: (data.start as string) ?? '',
		end: (data.end as string) ?? '',
		title: (data.title as string) ?? '',
		kind: (data.kind as EventKind) ?? 'other',
		room: (data.room as string) ?? '',
		status: (data.status as EventStatus) ?? 'planned',
		note: (data.note as string) ?? ''
	};
}

function toTask(id: string, data: Record<string, unknown>): PlanTask {
	return {
		id,
		text: (data.text as string) ?? '',
		date: (data.date as string | null) ?? null,
		until: (data.until as string | null) ?? null,
		start: (data.start as string) ?? '',
		end: (data.end as string) ?? '',
		status: (data.status as TaskStatus) ?? 'open',
		note: (data.note as string) ?? '',
		highlight: (data.highlight as boolean) ?? false,
		createdAt: (data.createdAt as number) ?? 0
	};
}

function toDeadline(id: string, data: Record<string, unknown>): Deadline {
	return {
		id,
		text: (data.text as string) ?? '',
		due: (data.due as string | null) ?? null,
		label: (data.label as string) ?? '',
		hard: (data.hard as boolean) ?? false,
		done: (data.done as boolean) ?? false,
		note: (data.note as string) ?? ''
	};
}

export async function listSlots(uid: string): Promise<ScheduleSlot[]> {
	const snap = await getDocs(slotsCol(uid));
	return snap.docs.map((d) => toSlot(d.id, d.data()));
}

export async function saveSlot(uid: string, slot: ScheduleSlot): Promise<void> {
	const { id, ...rest } = slot;
	await setDoc(doc(slotsCol(uid), id), { ...rest, updatedAt: serverTimestamp() });
}

/** Deletes the timetable entry only — overrides it left behind are ignored once the slot is gone. */
export async function deleteSlot(uid: string, id: string): Promise<void> {
	await deleteDoc(doc(slotsCol(uid), id));
}

export async function listEvents(uid: string): Promise<ScheduleEvent[]> {
	const snap = await getDocs(eventsCol(uid));
	return snap.docs.map((d) => toEvent(d.id, d.data()));
}

/** One day's events — one-offs and timetable overrides — for the day page. */
export async function listDayEvents(uid: string, key: string): Promise<ScheduleEvent[]> {
	const snap = await getDocs(query(eventsCol(uid), where('date', '==', key)));
	return snap.docs.map((d) => toEvent(d.id, d.data()));
}

export async function saveEvent(uid: string, event: ScheduleEvent): Promise<void> {
	const { id, ...rest } = event;
	await setDoc(doc(eventsCol(uid), id), { ...rest, updatedAt: serverTimestamp() });
}

export async function deleteEvent(uid: string, id: string): Promise<void> {
	await deleteDoc(doc(eventsCol(uid), id));
}

export async function listTasks(uid: string): Promise<PlanTask[]> {
	const snap = await getDocs(tasksCol(uid));
	return snap.docs.map((d) => toTask(d.id, d.data()));
}

export async function saveTask(uid: string, task: PlanTask): Promise<void> {
	const { id, ...rest } = task;
	await setDoc(doc(tasksCol(uid), id), { ...rest, updatedAt: serverTimestamp() });
}

export async function deleteTask(uid: string, id: string): Promise<void> {
	await deleteDoc(doc(tasksCol(uid), id));
}

export async function listDeadlines(uid: string): Promise<Deadline[]> {
	const snap = await getDocs(deadlinesCol(uid));
	return snap.docs.map((d) => toDeadline(d.id, d.data()));
}

export async function saveDeadline(uid: string, deadline: Deadline): Promise<void> {
	const { id, ...rest } = deadline;
	await setDoc(doc(deadlinesCol(uid), id), { ...rest, updatedAt: serverTimestamp() });
}

export async function deleteDeadline(uid: string, id: string): Promise<void> {
	await deleteDoc(doc(deadlinesCol(uid), id));
}

export async function listWeekNotes(uid: string): Promise<WeekNote[]> {
	const snap = await getDocs(weekNotesCol(uid));
	return snap.docs.map((d) => ({ week: d.id, text: (d.data().text as string) ?? '' }));
}

/** Saves a week's remark; an empty one deletes the doc. */
export async function saveWeekNote(uid: string, note: WeekNote): Promise<void> {
	const ref = doc(weekNotesCol(uid), note.week);
	if (note.text.trim() === '') await deleteDoc(ref);
	else await setDoc(ref, { text: note.text, updatedAt: serverTimestamp() });
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
	routines: Routine[];
	routineLogs: RoutineLog[];
	slots: ScheduleSlot[];
	events: ScheduleEvent[];
	tasks: PlanTask[];
	deadlines: Deadline[];
	weekNotes: WeekNote[];
}

export async function exportUserData(uid: string): Promise<UserData> {
	const [
		settings,
		days,
		people,
		notes,
		longTermTasks,
		accounts,
		transactions,
		routines,
		routineLogs,
		slots,
		events,
		tasks,
		deadlines,
		weekNotes
	] = await Promise.all([
		loadSettings(uid),
		listDays(uid),
		listPeople(uid),
		listNotes(uid),
		listLongTermTasks(uid),
		listAccounts(uid),
		listTransactions(uid),
		listRoutines(uid),
		listRoutineLogs(uid),
		listSlots(uid),
		listEvents(uid),
		listTasks(uid),
		listDeadlines(uid),
		listWeekNotes(uid)
	]);
	return {
		settings,
		days,
		people,
		notes,
		longTermTasks,
		accounts,
		transactions,
		routines,
		routineLogs,
		slots,
		events,
		tasks,
		deadlines,
		weekNotes
	};
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
	for (const routine of data.routines) {
		const { id, ...rest } = routine;
		ops.push((b) => b.set(doc(routinesCol(uid), id), { ...rest, updatedAt: serverTimestamp() }));
	}
	for (const log of data.routineLogs)
		ops.push((b) =>
			b.set(doc(routineLogsCol(uid), log.date), {
				values: log.values,
				updatedAt: serverTimestamp()
			})
		);
	for (const slot of data.slots) {
		const { id, ...rest } = slot;
		ops.push((b) => b.set(doc(slotsCol(uid), id), { ...rest, updatedAt: serverTimestamp() }));
	}
	for (const event of data.events) {
		const { id, ...rest } = event;
		ops.push((b) => b.set(doc(eventsCol(uid), id), { ...rest, updatedAt: serverTimestamp() }));
	}
	for (const task of data.tasks) {
		const { id, ...rest } = task;
		ops.push((b) => b.set(doc(tasksCol(uid), id), { ...rest, updatedAt: serverTimestamp() }));
	}
	for (const deadline of data.deadlines) {
		const { id, ...rest } = deadline;
		ops.push((b) => b.set(doc(deadlinesCol(uid), id), { ...rest, updatedAt: serverTimestamp() }));
	}
	for (const note of data.weekNotes)
		ops.push((b) =>
			b.set(doc(weekNotesCol(uid), note.week), { text: note.text, updatedAt: serverTimestamp() })
		);
	// Firestore caps a batch at 500 writes, so commit in chunks.
	for (let i = 0; i < ops.length; i += 450) {
		const batch = writeBatch(db);
		for (const op of ops.slice(i, i + 450)) op(batch);
		await batch.commit();
	}
}

// ——— Activity (see src/lib/activity.ts) ———

/** Pseudo-device for time added by hand on the Activity page. */
export const MANUAL_DEVICE = 'manual';

/**
 * One computer's recorded activity for one day (or the day's manual entries).
 * Doc id is `${date}_${device}`, so computers never overwrite each other.
 */
export interface ActivityDayDoc {
	date: string;
	device: string;
	deviceName: string;
	spans: ActivitySpan[];
}

/** Category overrides and default goals, shared by every device. */
export interface ActivityConfig {
	categories: Record<string, ActivityCategory>;
	defaultGoals: ActivityGoal[];
}

const activityDocId = (date: string, device: string) => `${date}_${device}`;

function toActivityDayDoc(data: Record<string, unknown>): ActivityDayDoc {
	return {
		date: String(data.date ?? ''),
		device: String(data.device ?? ''),
		deviceName: String(data.deviceName ?? ''),
		spans: Array.isArray(data.spans) ? (data.spans as ActivitySpan[]) : []
	};
}

export async function saveActivityDay(uid: string, day: ActivityDayDoc): Promise<void> {
	// Firestore rejects `undefined` fields; a JSON round trip drops them.
	const spans = JSON.parse(JSON.stringify(day.spans)) as ActivitySpan[];
	await setDoc(doc(activityCol(uid), activityDocId(day.date, day.device)), {
		...day,
		spans,
		updatedAt: serverTimestamp()
	});
}

export async function loadActivityDay(
	uid: string,
	date: string,
	device: string
): Promise<ActivityDayDoc | null> {
	const snap = await getDoc(doc(activityCol(uid), activityDocId(date, device)));
	return snap.exists() ? toActivityDayDoc(snap.data()) : null;
}

/** Live view of every device's docs for days `from`–`to`; returns an unsubscribe function. */
export function watchActivity(
	uid: string,
	from: string,
	to: string,
	callback: (docs: ActivityDayDoc[]) => void
): () => void {
	const q = query(activityCol(uid), where('date', '>=', from), where('date', '<=', to));
	return onSnapshot(
		q,
		(snap) => callback(snap.docs.map((d) => toActivityDayDoc(d.data()))),
		() => callback([])
	);
}

/** Deletes every device's activity, manual entries included (goals and settings stay). */
export async function deleteAllActivity(uid: string): Promise<void> {
	const snap = await getDocs(activityCol(uid));
	for (let i = 0; i < snap.docs.length; i += 450) {
		const batch = writeBatch(db);
		for (const d of snap.docs.slice(i, i + 450)) batch.delete(d.ref);
		await batch.commit();
	}
}

export function watchActivityConfig(
	uid: string,
	callback: (config: ActivityConfig) => void
): () => void {
	return onSnapshot(activityConfigDoc(uid), (snap) => {
		const data = snap.data() ?? {};
		callback({
			categories: (data.categories as Record<string, ActivityCategory>) ?? {},
			defaultGoals: cleanGoals(data.defaultGoals)
		});
	});
}

export async function saveActivityConfig(
	uid: string,
	patch: Partial<ActivityConfig>
): Promise<void> {
	await setDoc(activityConfigDoc(uid), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
}

/** A day's own goals, or null when it uses the default goals. */
export function watchActivityGoals(
	uid: string,
	date: string,
	callback: (goals: ActivityGoal[] | null) => void
): () => void {
	return onSnapshot(doc(activityGoalsCol(uid), date), (snap) =>
		callback(snap.exists() ? cleanGoals(snap.data().goals) : null)
	);
}

/** Sets a day's own goals; null goes back to the default goals. */
export async function saveActivityGoals(
	uid: string,
	date: string,
	goals: ActivityGoal[] | null
): Promise<void> {
	const ref = doc(activityGoalsCol(uid), date);
	if (goals === null) await deleteDoc(ref);
	else await setDoc(ref, { goals, updatedAt: serverTimestamp() });
}
