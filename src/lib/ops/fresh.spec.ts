import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanTask } from '../db';
import { change } from './change';
import { describeChange } from './describe';
import { staleChanges } from './fresh';

const db = vi.hoisted(() => ({
	listTasks: vi.fn(),
	listEvents: vi.fn(),
	loadDay: vi.fn(),
	loadPerson: vi.fn(),
	saveDay: vi.fn(async () => {}),
	savePerson: vi.fn(async () => {})
}));
vi.mock('../db', () => db);

const task: PlanTask = {
	id: 't1',
	text: 'Grade DM',
	date: '2026-10-30',
	until: null,
	start: '',
	end: '',
	status: 'open',
	note: '',
	highlight: false,
	createdAt: 1
};

beforeEach(() => {
	for (const fn of Object.values(db)) fn.mockReset();
});

describe('staleChanges', () => {
	it('passes changes whose documents still look like `before`', async () => {
		db.listTasks.mockResolvedValue([{ ...task }]);
		const c = change('task', task, { ...task, status: 'done' });
		expect(await staleChanges('u', [c])).toEqual([]);
	});

	it('catches documents edited since, and overrides created since', async () => {
		db.listTasks.mockResolvedValue([{ ...task, text: 'Grade DM and SWE' }]);
		db.listEvents.mockResolvedValue([{ id: 'swe_2026-10-26' }]);
		const edited = change('task', task, { ...task, status: 'done' });
		const override = {
			kind: 'event' as const,
			id: 'swe_2026-10-26',
			before: null,
			after: null
		};
		expect(await staleChanges('u', [edited, override])).toHaveLength(2);
	});

	it('ignores blank optional person fields', async () => {
		db.loadPerson.mockResolvedValue({ handle: 'rahim', name: 'Rahim', updatedAt: 'x' });
		const c = change('person', { handle: 'rahim', name: 'Rahim' }, { handle: 'rahim', name: 'R' });
		expect(await staleChanges('u', [c])).toEqual([]);
	});

	it('needs a line to change to still be on its day', async () => {
		db.loadDay.mockResolvedValue('a\nb');
		const ok = change('dayLine', { date: 'd', line: 'a' }, { date: 'd', line: '~~a~~' });
		const gone = change('dayLine', { date: 'd', line: 'zz' }, null);
		const add = change('dayLine', null, { date: 'd', line: 'new' });
		expect(await staleChanges('u', [ok, gone, add])).toEqual([gone]);
	});
});

describe('describeChange', () => {
	it('lists what changes in plain words', () => {
		expect(
			describeChange(change('task', task, { ...task, status: 'dropped', note: 'Not needed' }))
		).toEqual(['Task Grade DM', 'Status: open → dropped', 'Note: — → Not needed']);
		expect(describeChange(change('task', null, task))).toEqual([
			'New task Grade DM',
			'Date: 2026-10-30',
			'Status: open'
		]);
		expect(describeChange(change('dayLine', { date: '2026-10-30', line: 'gym' }, null))).toEqual([
			'Remove from 2026-10-30: gym'
		]);
	});
});
