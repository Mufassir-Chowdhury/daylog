import { describe, expect, it } from 'vitest';
import type { Deadline, PlanTask, ScheduleEvent, ScheduleSlot } from './db';
import {
	countdown,
	deadlineWhen,
	formatTimeRange,
	moveEvent,
	moveTask,
	occurrences,
	overrideId,
	rangeLabel,
	sortDeadlines,
	spanLabel,
	tasksInRange,
	undatedEvents,
	weekStart
} from './schedule';

const slot = (over: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
	id: 'ica',
	title: 'ICA',
	kind: 'class',
	weekday: 0,
	start: '09:00',
	end: '11:00',
	room: '329',
	startsOn: null,
	endsOn: null,
	...over
});

const event = (over: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
	id: 'e1',
	slotId: null,
	date: '2026-10-04',
	start: '15:00',
	end: '15:45',
	title: 'Mid-2',
	kind: 'exam',
	room: '629',
	status: 'planned',
	note: '',
	...over
});

const task = (over: Partial<PlanTask> = {}): PlanTask => ({
	id: 't1',
	text: 'task',
	date: '2026-10-07',
	until: null,
	start: '',
	end: '',
	status: 'open',
	note: '',
	highlight: false,
	createdAt: 0,
	...over
});

const deadline = (over: Partial<Deadline> = {}): Deadline => ({
	id: 'd1',
	text: 'thesis',
	due: null,
	label: '',
	hard: false,
	done: false,
	note: '',
	...over
});

describe('weekStart', () => {
	it('returns the Sunday of the week', () => {
		expect(weekStart('2026-10-08')).toBe('2026-10-04'); // Thursday
		expect(weekStart('2026-10-04')).toBe('2026-10-04'); // Sunday itself
		expect(weekStart('2026-10-10')).toBe('2026-10-04'); // Saturday
	});
});

describe('occurrences', () => {
	it('expands weekly slots and merges one-off events in time order', () => {
		const got = occurrences(
			[slot(), slot({ id: 'swe', title: 'SWE', weekday: 1, start: '11:15', end: '12:00' })],
			[event()],
			'2026-10-04',
			'2026-10-10'
		);
		expect(got.map((o) => [o.event.date, o.event.title, o.virtual])).toEqual([
			['2026-10-04', 'ICA', true],
			['2026-10-04', 'Mid-2', false],
			['2026-10-05', 'SWE', true]
		]);
		expect(got[0].event.id).toBe(overrideId('ica', '2026-10-04'));
	});

	it('replaces a slot occurrence with its stored override, once', () => {
		const override = event({
			id: overrideId('ica', '2026-10-04'),
			slotId: 'ica',
			title: 'ICA',
			start: '09:00',
			status: 'done'
		});
		const got = occurrences([slot()], [override], '2026-10-04', '2026-10-04');
		expect(got).toHaveLength(1);
		expect(got[0]).toEqual({ event: override, virtual: false });
	});

	it('respects a slot date range', () => {
		const got = occurrences(
			[slot({ startsOn: '2026-10-05', endsOn: '2026-10-12' })],
			[],
			'2026-10-01',
			'2026-10-31'
		);
		expect(got.map((o) => o.event.date)).toEqual(['2026-10-11']);
	});

	it('leaves out undated events, which undatedEvents returns', () => {
		const tbd = event({ id: 'py', date: null, title: 'Python exam' });
		expect(occurrences([], [tbd], '2026-10-01', '2026-10-31')).toEqual([]);
		expect(undatedEvents([tbd, event()])).toEqual([tbd]);
	});
});

describe('formatTimeRange', () => {
	it('writes the meridiem once when both ends share it', () => {
		expect(formatTimeRange('09:00', '11:00')).toBe('9:00–11:00 AM');
		expect(formatTimeRange('17:00', '20:00')).toBe('5:00–8:00 PM');
		expect(formatTimeRange('12:00', '13:00')).toBe('12:00–1:00 PM');
	});

	it('writes both when the range crosses noon', () => {
		expect(formatTimeRange('11:15', '12:00')).toBe('11:15 AM–12:00 PM');
	});

	it('handles missing times', () => {
		expect(formatTimeRange('', '')).toBe('');
		expect(formatTimeRange('14:00', '')).toBe('2:00 PM');
	});
});

describe('labels', () => {
	it('formats week ranges', () => {
		expect(rangeLabel('2026-10-04', '2026-10-10')).toBe('Oct 4 – 10');
		expect(rangeLabel('2026-09-27', '2026-10-03')).toBe('Sep 27 – Oct 3');
	});

	it('formats task spans', () => {
		expect(spanLabel('2026-10-09', null)).toBe('Fri, Oct 9');
		expect(spanLabel('2026-10-09', '2026-10-10')).toBe('Fri–Sat, Oct 9–10');
	});

	it('counts down to a date', () => {
		expect(countdown('2026-10-20', '2026-10-10')).toBe('in 10 days');
		expect(countdown('2026-10-10', '2026-10-10')).toBe('today');
		expect(countdown('2026-10-11', '2026-10-10')).toBe('tomorrow');
		expect(countdown('2026-10-07', '2026-10-10')).toBe('3 days ago');
	});
});

describe('moveEvent', () => {
	it('marks the original moved and creates a standalone copy at the target', () => {
		const original = event({
			id: overrideId('dbms', '2026-10-07'),
			slotId: 'dbms',
			date: '2026-10-07'
		});
		const [moved, created] = moveEvent(
			original,
			{ date: '2026-10-08', start: '09:00', end: '11:00', room: '304' },
			'new'
		);
		expect(moved).toMatchObject({ status: 'moved', note: 'Moved to Thu, Oct 8 9:00–11:00 AM' });
		expect(created).toMatchObject({
			id: 'new',
			slotId: null,
			date: '2026-10-08',
			room: '304',
			status: 'planned',
			note: 'Moved from Wed, Oct 7'
		});
	});
});

describe('tasks', () => {
	it('selects tasks overlapping a range, spans included, Later excluded', () => {
		const tasks = [
			task({ id: 'a', date: '2026-10-09', until: '2026-10-10' }),
			task({ id: 'b', date: '2026-10-03' }),
			task({ id: 'c', date: null }),
			task({ id: 'd', date: '2026-10-10', start: '09:00' }),
			task({ id: 'e', date: '2026-10-10', start: '08:00' })
		];
		expect(tasksInRange(tasks, '2026-10-10', '2026-10-16').map((t) => t.id)).toEqual([
			'a',
			'e',
			'd'
		]);
	});

	it('moves a task, leaving a trace', () => {
		const [old, fresh] = moveTask(
			task({ status: 'open' }),
			{ date: '2026-10-09', until: '2026-10-10' },
			'n',
			7
		);
		expect(old).toMatchObject({ status: 'moved', note: 'Moved to Fri–Sat, Oct 9–10' });
		expect(fresh).toMatchObject({ id: 'n', status: 'open', date: '2026-10-09', createdAt: 7 });
	});
});

describe('deadlines', () => {
	it('sorts open before done, then by date with undated last', () => {
		const sorted = sortDeadlines([
			deadline({ id: 'tbd' }),
			deadline({ id: 'done', due: '2026-10-01', done: true }),
			deadline({ id: 'late', due: '2026-10-24' }),
			deadline({ id: 'soon', due: '2026-10-20' })
		]);
		expect(sorted.map((d) => d.id)).toEqual(['soon', 'late', 'tbd', 'done']);
	});

	it('prefers the free-text label for display', () => {
		expect(deadlineWhen(deadline({ due: '2026-10-24', label: 'Oct 24 / 25 / 26' }))).toBe(
			'Oct 24 / 25 / 26'
		);
		expect(deadlineWhen(deadline({ due: '2026-10-20' }))).toBe('Tue, Oct 20');
		expect(deadlineWhen(deadline())).toBe('TBD');
	});
});
