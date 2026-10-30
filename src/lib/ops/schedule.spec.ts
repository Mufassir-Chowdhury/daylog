import { describe, expect, it } from 'vitest';
import type { PlanTask, ScheduleEvent, ScheduleSlot, WeekNote } from '../db';
import { materialize, occurrences, type Occurrence } from '../schedule';
import { invert, patch } from './change';
import {
	addTask,
	cancelWeekClasses,
	findOccurrence,
	moveEventTo,
	moveTaskTo,
	removeEvent,
	setEventStatus,
	setWeekNote,
	updateEvent
} from './schedule';

// 2026-10-04 is a Sunday.
const slot: ScheduleSlot = {
	id: 'swe',
	title: 'SWE',
	kind: 'class',
	weekday: 1,
	start: '09:00',
	end: '10:30',
	room: '329',
	startsOn: null,
	endsOn: null
};
const virtual: Occurrence = { event: materialize(slot, '2026-10-05'), virtual: true };
const stored: Occurrence = { event: { ...virtual.event, note: 'room swap' }, virtual: false };

const meeting: ScheduleEvent = {
	id: 'm1',
	slotId: null,
	date: null,
	start: '',
	end: '',
	title: 'Dept meeting',
	kind: 'meeting',
	room: '',
	status: 'planned',
	note: ''
};

const task: PlanTask = {
	id: 't1',
	text: 'Grade DM',
	date: '2026-10-05',
	until: null,
	start: '',
	end: '',
	status: 'open',
	note: '',
	highlight: false,
	createdAt: 1
};

describe('event ops', () => {
	it('saving an untouched occurrence creates its override', () => {
		const [c] = setEventStatus(virtual, 'done');
		expect(c.before).toBeNull();
		expect(c.after).toMatchObject({ id: 'swe_2026-10-05', status: 'done' });
	});

	it('saving a stored occurrence updates it and keeps its note unless given one', () => {
		expect(setEventStatus(stored, 'cancelled')[0]).toMatchObject({
			before: stored.event,
			after: { status: 'cancelled', note: 'room swap' }
		});
		expect(setEventStatus(stored, 'cancelled', 'sick')[0].after).toMatchObject({ note: 'sick' });
	});

	it('moves a dated event: the original is crossed out and a new one created', () => {
		const changes = moveEventTo(
			virtual,
			{ date: '2026-10-08', start: '09:00', end: '10:30', room: '304' },
			'new'
		);
		expect(changes).toHaveLength(2);
		expect(changes[0].after).toMatchObject({ id: 'swe_2026-10-05', status: 'moved' });
		expect(changes[1]).toMatchObject({
			before: null,
			after: { id: 'new', slotId: null, date: '2026-10-08', room: '304', status: 'planned' }
		});
	});

	it('moving a TBD event just gives it a date', () => {
		const occ = { event: meeting, virtual: false };
		const changes = moveEventTo(
			occ,
			{ date: '2026-10-07', start: '14:00', end: '', room: '' },
			'x'
		);
		expect(changes).toEqual([
			{
				kind: 'event',
				id: 'm1',
				before: meeting,
				after: { ...meeting, date: '2026-10-07', start: '14:00' }
			}
		]);
	});

	it('removing an untouched occurrence does nothing; a stored one is deleted', () => {
		expect(removeEvent(virtual)).toEqual([]);
		expect(removeEvent(stored)).toEqual([
			{ kind: 'event', id: stored.event.id, before: stored.event, after: null }
		]);
	});

	it('updates fields but never the id', () => {
		expect(updateEvent(stored, { room: '812' })[0].after).toMatchObject({
			id: stored.event.id,
			room: '812'
		});
	});

	it('finds occurrences by id, virtual or not', () => {
		const list = occurrences([slot], [], '2026-10-04', '2026-10-10');
		expect(findOccurrence(list, 'swe_2026-10-05')?.virtual).toBe(true);
		expect(findOccurrence(list, 'nope')).toBeNull();
	});
});

describe('cancelWeekClasses', () => {
	it('cancels planned classes and labs only, and undo restores the timetable', () => {
		const exam: Occurrence = {
			event: { ...meeting, id: 'e1', kind: 'exam', date: '2026-10-06' },
			virtual: false
		};
		const done: Occurrence = {
			event: { ...virtual.event, id: 'swe_2026-10-12', status: 'done' },
			virtual: false
		};
		const changes = cancelWeekClasses([virtual, exam, done]);
		expect(changes.map((c) => c.id)).toEqual(['swe_2026-10-05']);

		let events: ScheduleEvent[] = [];
		events = patch(events, changes, 'event');
		expect(events[0].status).toBe('cancelled');
		events = patch(events, invert(changes), 'event');
		expect(events).toEqual([]);
	});
});

describe('setWeekNote', () => {
	const notes: WeekNote[] = [{ week: '2026-10-04', text: 'Midterms' }];

	it('creates, updates and clears', () => {
		expect(setWeekNote([], '2026-10-11', ' Break ')[0]).toMatchObject({
			before: null,
			after: { week: '2026-10-11', text: 'Break' }
		});
		expect(setWeekNote(notes, '2026-10-04', 'Finals')[0].after).toEqual({
			week: '2026-10-04',
			text: 'Finals'
		});
		expect(setWeekNote(notes, '2026-10-04', '  ')[0].after).toBeNull();
	});

	it('does nothing when the text is unchanged', () => {
		expect(setWeekNote(notes, '2026-10-04', 'Midterms ')).toEqual([]);
		expect(setWeekNote([], '2026-10-04', '')).toEqual([]);
	});
});

describe('task ops', () => {
	it('adds an open task with defaults', () => {
		const [c] = addTask(
			{ text: 'Set questions', date: null, until: null, start: '', end: '' },
			'n1',
			5
		);
		expect(c.after).toEqual({
			id: 'n1',
			text: 'Set questions',
			date: null,
			until: null,
			start: '',
			end: '',
			status: 'open',
			note: '',
			highlight: false,
			createdAt: 5
		});
	});

	it('moves a dated task by leaving a moved copy behind', () => {
		const changes = moveTaskTo(task, { date: '2026-10-07', until: null }, 'n2', 9);
		expect(changes[0].after).toMatchObject({ id: 't1', status: 'moved' });
		expect(changes[1].after).toMatchObject({ id: 'n2', date: '2026-10-07', status: 'open' });
	});

	it('gives a "Later" task its day in place', () => {
		const later = { ...task, date: null };
		const changes = moveTaskTo(later, { date: '2026-10-07', until: null }, 'n2', 9);
		expect(changes).toHaveLength(1);
		expect(changes[0].after).toMatchObject({ id: 't1', date: '2026-10-07', status: 'open' });
	});
});
