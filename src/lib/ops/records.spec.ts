import { describe, expect, it } from 'vitest';
import type { LongTermTask, Note } from '../db';
import {
	appendLine,
	appendPersonNote,
	appendToNote,
	addSubtask,
	logRoutineValue,
	setLongTermDone,
	setPersonName,
	setSubtaskDone
} from './records';

const thesis: LongTermTask = {
	id: 'lt1',
	text: 'Thesis',
	order: 0,
	createdOn: '2026-10-01',
	completedOn: null,
	subtasks: [{ text: 'Outline', done: false }]
};

describe('appendLine', () => {
	it('adds a trimmed line, or nothing when blank', () => {
		expect(appendLine('2026-10-05', ' call @mom ')).toEqual([
			{
				kind: 'dayLine',
				id: '2026-10-05',
				before: null,
				after: { date: '2026-10-05', line: 'call @mom' }
			}
		]);
		expect(appendLine('2026-10-05', '   ')).toEqual([]);
	});
});

describe('appendToNote', () => {
	it('adds the text on a new line', () => {
		const note: Note = { id: 'n', title: 'Ideas', content: 'one\n', tags: [] };
		expect(appendToNote(note, 'two')[0].after).toMatchObject({ content: 'one\ntwo' });
		expect(appendToNote(note, ' ')).toEqual([]);
	});
});

describe('long-term ops', () => {
	it('adds and crosses out subtasks', () => {
		expect(addSubtask(thesis, 'Draft')[0].after).toMatchObject({
			subtasks: [
				{ text: 'Outline', done: false },
				{ text: 'Draft', done: false }
			]
		});
		expect(setSubtaskDone(thesis, 0, true)[0].after).toMatchObject({
			subtasks: [{ text: 'Outline', done: true }]
		});
		expect(setSubtaskDone(thesis, 0, false)).toEqual([]);
		expect(setSubtaskDone(thesis, 5, true)).toEqual([]);
	});

	it('crosses the task out on a day and back in', () => {
		expect(setLongTermDone(thesis, '2026-10-05')[0].after).toMatchObject({
			completedOn: '2026-10-05'
		});
		expect(setLongTermDone(thesis, null)).toEqual([]);
	});
});

describe('logRoutineValue', () => {
	it('sets, changes and clears, keeping the old value for undo', () => {
		expect(logRoutineValue('2026-10-05', 'r', null, 4)[0]).toMatchObject({
			id: '2026-10-05:r',
			before: null,
			after: { value: 4 }
		});
		expect(logRoutineValue('2026-10-05', 'r', 4, 6)[0]).toMatchObject({
			before: { value: 4 },
			after: { value: 6 }
		});
		expect(logRoutineValue('2026-10-05', 'r', 4, null)[0].after).toBeNull();
		expect(logRoutineValue('2026-10-05', 'r', 4, 4)).toEqual([]);
	});
});

describe('people ops', () => {
	it('appends to the bio and sets the name', () => {
		expect(appendPersonNote({ handle: 'rahim' }, 'Works at BUET')[0].after).toEqual({
			handle: 'rahim',
			bio: 'Works at BUET'
		});
		expect(setPersonName({ handle: 'rahim', name: 'Rahim' }, 'Rahim ')).toEqual([]);
		expect(setPersonName({ handle: 'rahim' }, 'Rahim Uddin')[0].after).toMatchObject({
			name: 'Rahim Uddin'
		});
	});
});
