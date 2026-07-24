import { describe, expect, it } from 'vitest';
import { backupSummary, parseBackup, serializeBackup } from './backup';
import type { UserData } from './db';

const data: UserData = {
	settings: { currency: '$', grouping: 'thousand', showFinancePanel: false },
	days: [{ date: '2026-07-01', text: 'hello @rahim' }],
	people: [{ handle: 'rahim', name: 'Rahim' }],
	notes: [{ id: 'n1', title: 'ideas', content: 'stuff', tags: ['x'] }],
	longTermTasks: [
		{
			id: 'l1',
			text: 'thesis',
			order: 1,
			createdOn: '2026-07-01',
			completedOn: null,
			subtasks: [{ text: 'outline', done: true }]
		}
	],
	accounts: [{ id: 'a1', name: 'Cash', startingBalance: 100, order: 1 }],
	transactions: [
		{
			id: 't1',
			date: '2026-07-01',
			kind: 'expense',
			category: 'lunch',
			amount: 50,
			from: 'a1',
			to: null,
			person: null,
			note: '',
			createdAt: 5
		}
	],
	routines: [{ id: 'r1', name: 'Quran', unit: 'pages', threshold: 5, order: 1 }],
	routineLogs: [{ date: '2026-07-01', values: { r1: 6 } }]
};

describe('backup round-trip', () => {
	it('parses its own serialized output back unchanged', () => {
		expect(parseBackup(serializeBackup(data))).toEqual(data);
	});
});

describe('parseBackup', () => {
	it('rejects non-JSON', () => {
		expect(() => parseBackup('not json')).toThrow('not valid JSON');
	});

	it('rejects files that are not daylog backups', () => {
		expect(() => parseBackup('{"app":"other"}')).toThrow('not a daylog backup');
	});

	it('rejects unknown versions', () => {
		expect(() => parseBackup('{"app":"daylog","version":2}')).toThrow('version');
	});

	it('drops invalid entries and defaults missing fields', () => {
		const parsed = parseBackup(
			JSON.stringify({
				app: 'daylog',
				version: 1,
				settings: { currency: 7, grouping: 'weird', showNotePanel: false, junk: true },
				days: [
					{ date: 'nope', text: 'x' },
					{ date: '2026-02-30', text: 'x' },
					{ date: '2026-07-01' }
				],
				people: [{}, { handle: 'ok', bio: 42 }],
				transactions: [{ id: 't', date: '2026-07-01', kind: 'weird', amount: 'NaN' }, { id: 't2' }]
			})
		);
		expect(parsed.settings).toEqual({ showNotePanel: false });
		expect(parsed.days).toEqual([{ date: '2026-07-01', text: '' }]);
		expect(parsed.people).toEqual([{ handle: 'ok' }]);
		expect(parsed.transactions).toEqual([
			{
				id: 't',
				date: '2026-07-01',
				kind: 'expense',
				category: '',
				amount: 0,
				from: null,
				to: null,
				person: null,
				note: '',
				createdAt: 0
			}
		]);
		expect(parsed.notes).toEqual([]);
		expect(parsed.longTermTasks).toEqual([]);
		expect(parsed.accounts).toEqual([]);
		expect(parsed.routines).toEqual([]);
		expect(parsed.routineLogs).toEqual([]);
	});

	it('drops non-numeric routine values and invalid log dates', () => {
		const parsed = parseBackup(
			JSON.stringify({
				app: 'daylog',
				version: 1,
				routines: [{ id: 'r1', name: 'Quran' }, { name: 'no id' }],
				routineLogs: [
					{ date: '2026-07-01', values: { r1: 6, bad: 'six', worse: NaN } },
					{ date: 'nope', values: { r1: 1 } }
				]
			})
		);
		expect(parsed.routines).toEqual([
			{ id: 'r1', name: 'Quran', unit: '', threshold: 0, order: 0 }
		]);
		expect(parsed.routineLogs).toEqual([{ date: '2026-07-01', values: { r1: 6 } }]);
	});
});

describe('backupSummary', () => {
	it('counts every collection', () => {
		expect(backupSummary(data)).toBe(
			'1 days, 1 people, 1 notes, 1 long-term tasks, 1 accounts, 1 transactions, 1 routines, 1 routine days'
		);
	});
});
