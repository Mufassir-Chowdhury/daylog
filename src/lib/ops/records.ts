/**
 * Operations on everything outside the schedule — day text, finance, notes,
 * long-term tasks, routines and people — as pure functions that return changes.
 */
import type { LongTermTask, Note, Person, Transaction } from '../db';
import { joinLine } from '../parse';
import { change, type Change } from './change';

// ——— Days.

/** Adds a line at the end of a day's text. */
export function appendLine(date: string, line: string): Change[] {
	const text = line.trim();
	return text ? [change('dayLine', null, { date, line: text })] : [];
}

// ——— Finance.

export function addTransaction(txn: Transaction): Change[] {
	return [change('transaction', null, txn)];
}

export function updateTransaction(
	txn: Transaction,
	fields: Partial<Omit<Transaction, 'id'>>
): Change[] {
	return [change('transaction', txn, { ...txn, ...fields })];
}

// ——— Notes.

export function createNote(note: Note): Change[] {
	return [change('note', null, note)];
}

export function appendToNote(note: Note, text: string): Change[] {
	const line = text.trim();
	return line ? [change('note', note, { ...note, content: joinLine(note.content, line) })] : [];
}

// ——— Long-term tasks.

export function addLongTerm(task: LongTermTask): Change[] {
	return [change('longterm', null, task)];
}

export function addSubtask(task: LongTermTask, text: string): Change[] {
	const line = text.trim();
	if (!line) return [];
	return [
		change('longterm', task, { ...task, subtasks: [...task.subtasks, { text: line, done: false }] })
	];
}

export function setSubtaskDone(task: LongTermTask, index: number, done: boolean): Change[] {
	if (!task.subtasks[index] || task.subtasks[index].done === done) return [];
	return [
		change('longterm', task, {
			...task,
			subtasks: task.subtasks.map((s, i) => (i === index ? { ...s, done } : s))
		})
	];
}

/** Crosses a long-term task out on `date`, or back in with null. */
export function setLongTermDone(task: LongTermTask, date: string | null): Change[] {
	return task.completedOn === date
		? []
		: [change('longterm', task, { ...task, completedOn: date })];
}

// ——— Routines.

/**
 * Sets one routine's value for a day; null clears it. `current` is what's
 * logged now (null when nothing is), so the change can be undone.
 */
export function logRoutineValue(
	date: string,
	routineId: string,
	current: number | null,
	value: number | null
): Change[] {
	if (current === value) return [];
	return [
		change(
			'routineValue',
			current === null ? null : { date, routineId, value: current },
			value === null ? null : { date, routineId, value }
		)
	];
}

// ——— People.

/** Adds a line to a person's bio — how their profile grows over time. */
export function appendPersonNote(person: Person, text: string): Change[] {
	const line = text.trim();
	return line
		? [change('person', person, { ...person, bio: joinLine(person.bio ?? '', line) })]
		: [];
}

export function setPersonName(person: Person, name: string): Change[] {
	const trimmed = name.trim();
	return (person.name ?? '') === trimmed
		? []
		: [change('person', person, { ...person, name: trimmed })];
}
