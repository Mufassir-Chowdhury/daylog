/**
 * Schedule operations — timetable occurrences, one-off events, the task plan,
 * deadlines, week notes and the weekly timetable — as pure functions that
 * return changes. The Schedule page's buttons and the assistant's tools both
 * go through these.
 */
import type { Deadline, PlanTask, ScheduleEvent, ScheduleSlot, WeekNote } from '../db';
import {
	moveEvent,
	moveTask,
	type EventStatus,
	type Occurrence,
	type TaskStatus
} from '../schedule';
import { change, type Change } from './change';

/** Saves an occurrence; an untouched (virtual) one has nothing stored yet, so it's a create. */
function putOccurrence(o: Occurrence, after: ScheduleEvent): Change {
	return change('event', o.virtual ? null : o.event, after);
}

/** The occurrence with this id, virtual or stored — how ids from a snapshot are looked up. */
export function findOccurrence(list: Occurrence[], id: string): Occurrence | null {
	return list.find((o) => o.event.id === id) ?? null;
}

// ——— Events and timetable occurrences.

export function addEvent(event: ScheduleEvent): Change[] {
	return [change('event', null, event)];
}

/** Sets an event's status; `note === null` keeps the current note. */
export function setEventStatus(
	o: Occurrence,
	status: EventStatus,
	note: string | null = null
): Change[] {
	return [putOccurrence(o, { ...o.event, status, note: note ?? o.event.note })];
}

export function updateEvent(
	o: Occurrence,
	fields: Partial<Omit<ScheduleEvent, 'id' | 'slotId'>>
): Change[] {
	return [putOccurrence(o, { ...o.event, ...fields })];
}

/**
 * Moves an event to another day, time or room. A dated one stays behind, crossed
 * out, next to a new standalone event; a TBD one just gets its date.
 */
export function moveEventTo(
	o: Occurrence,
	target: { date: string; start: string; end: string; room: string },
	newId: string
): Change[] {
	if (o.event.date === null) return [putOccurrence(o, { ...o.event, ...target })];
	const [moved, created] = moveEvent(o.event, target, newId);
	return [putOccurrence(o, moved), change('event', null, created)];
}

/**
 * Deletes a one-off event, or resets a changed timetable occurrence to the
 * timetable. An untouched occurrence has nothing to remove.
 */
export function removeEvent(o: Occurrence): Change[] {
	return o.virtual ? [] : [change('event', o.event, null)];
}

/** Cancels every planned class and lab in the list — "no classes this week". */
export function cancelWeekClasses(list: Occurrence[]): Change[] {
	return list
		.filter(
			(o) => (o.event.kind === 'class' || o.event.kind === 'lab') && o.event.status === 'planned'
		)
		.flatMap((o) => setEventStatus(o, 'cancelled'));
}

export function setWeekNote(notes: WeekNote[], week: string, text: string): Change[] {
	const before = notes.find((n) => n.week === week) ?? null;
	const trimmed = text.trim();
	if ((before?.text ?? '') === trimmed) return [];
	return [change('weekNote', before, trimmed ? { week, text: trimmed } : null)];
}

// ——— Tasks.

export function addTask(
	fields: Pick<PlanTask, 'text' | 'date' | 'until' | 'start' | 'end'> & Partial<PlanTask>,
	id: string,
	now: number
): Change[] {
	return [
		change('task', null, {
			status: 'open',
			note: '',
			highlight: false,
			...fields,
			id,
			createdAt: now
		})
	];
}

export function updateTask(task: PlanTask, fields: Partial<Omit<PlanTask, 'id'>>): Change[] {
	return [change('task', task, { ...task, ...fields })];
}

/** Sets a task's status; `note === null` keeps the current note. */
export function setTaskStatus(
	task: PlanTask,
	status: TaskStatus,
	note: string | null = null
): Change[] {
	return updateTask(task, { status, note: note ?? task.note });
}

/**
 * Moves a task to another day, span or "Later". A dated one stays behind,
 * marked moved, next to a fresh copy; a "Later" one just gets its day.
 */
export function moveTaskTo(
	task: PlanTask,
	target: { date: string | null; until: string | null },
	newId: string,
	now: number
): Change[] {
	if (task.date === null) return updateTask(task, target);
	const [moved, created] = moveTask(task, target, newId, now);
	return [change('task', task, moved), change('task', null, created)];
}

export function removeTask(task: PlanTask): Change[] {
	return [change('task', task, null)];
}

// ——— Deadlines.

export function addDeadline(deadline: Deadline): Change[] {
	return [change('deadline', null, deadline)];
}

export function updateDeadline(
	deadline: Deadline,
	fields: Partial<Omit<Deadline, 'id'>>
): Change[] {
	return [change('deadline', deadline, { ...deadline, ...fields })];
}

export function removeDeadline(deadline: Deadline): Change[] {
	return [change('deadline', deadline, null)];
}

// ——— Weekly timetable.

export function addSlot(slot: ScheduleSlot): Change[] {
	return [change('slot', null, slot)];
}

export function updateSlot(
	slot: ScheduleSlot,
	fields: Partial<Omit<ScheduleSlot, 'id'>>
): Change[] {
	return [change('slot', slot, { ...slot, ...fields })];
}

/** Removes the timetable entry only — overrides it left behind are ignored once it's gone. */
export function removeSlot(slot: ScheduleSlot): Change[] {
	return [change('slot', slot, null)];
}
