import { describe, expect, it } from 'vitest';
import type { PlanTask, WeekNote } from '../db';
import { change, invert, keyOf, patch, put, type Change } from './change';

const task = (id: string, text = id): PlanTask => ({
	id,
	text,
	date: '2026-10-05',
	until: null,
	start: '',
	end: '',
	status: 'open',
	note: '',
	highlight: false,
	createdAt: 0
});

describe('keyOf', () => {
	it('uses the field each kind is stored under', () => {
		expect(keyOf('task', task('t1'))).toBe('t1');
		expect(keyOf('weekNote', { week: '2026-10-04', text: 'x' })).toBe('2026-10-04');
		expect(keyOf('person', { handle: 'rahim' })).toBe('rahim');
		expect(keyOf('routineValue', { date: '2026-10-05', routineId: 'r1', value: 3 })).toBe(
			'2026-10-05:r1'
		);
		expect(keyOf('dayLine', { date: '2026-10-05', line: 'x' })).toBe('2026-10-05');
	});
});

describe('put', () => {
	it('is a create when nothing has the id, an update otherwise', () => {
		const list = [task('a')];
		expect(put('task', list, task('b')).before).toBeNull();
		expect(put('task', list, task('a', 'renamed')).before).toEqual(task('a'));
	});
});

describe('invert', () => {
	it('swaps before and after and reverses the order', () => {
		const changes: Change[] = [change('task', null, task('a')), change('task', task('b'), null)];
		expect(invert(changes)).toEqual([
			change('task', null, task('b')),
			change('task', task('a'), null)
		]);
	});
});

describe('patch', () => {
	it('creates, updates and removes items of one kind, ignoring others', () => {
		const list = [task('a'), task('b')];
		const changes: Change[] = [
			change('task', null, task('c')),
			change('task', task('a'), task('a', 'renamed')),
			change('task', task('b'), null),
			change('weekNote', null, { week: '2026-10-04', text: 'x' })
		];
		expect(patch(list, changes, 'task')).toEqual([task('a', 'renamed'), task('c')]);
	});

	it('undoes cleanly with the inverse changes', () => {
		const list = [task('a'), task('b')];
		const changes = [change('task', task('a'), task('a', 'x')), change('task', null, task('z'))];
		expect(patch(patch(list, changes, 'task'), invert(changes), 'task')).toEqual(list);
	});

	it('matches week notes by week', () => {
		const notes: WeekNote[] = [{ week: '2026-10-04', text: 'old' }];
		const changes = [change('weekNote', notes[0], { week: '2026-10-04', text: 'new' })];
		expect(patch(notes, changes, 'weekNote')).toEqual([{ week: '2026-10-04', text: 'new' }]);
	});
});
