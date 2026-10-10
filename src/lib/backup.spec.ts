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
			fixed: false,
			createdAt: 5
		}
	],
	routines: [{ id: 'r1', name: 'Quran', unit: 'pages', threshold: 5, order: 1 }],
	routineLogs: [{ date: '2026-07-01', values: { r1: 6 } }],
	slots: [
		{
			id: 's1',
			title: 'ICA',
			kind: 'class',
			weekday: 0,
			start: '09:00',
			end: '11:00',
			room: '329',
			startsOn: null,
			endsOn: '2026-11-18'
		}
	],
	events: [
		{
			id: 's1_2026-07-05',
			slotId: 's1',
			date: '2026-07-05',
			start: '09:00',
			end: '11:00',
			title: 'ICA',
			kind: 'class',
			room: '329',
			status: 'cancelled',
			note: ''
		}
	],
	tasks: [
		{
			id: 'k1',
			text: 'SWE questions',
			date: '2026-07-03',
			until: '2026-07-04',
			start: '',
			end: '',
			status: 'open',
			note: 'Almost done',
			highlight: false,
			createdAt: 3
		}
	],
	deadlines: [
		{
			id: 'd1',
			text: 'Thesis',
			due: '2026-07-20',
			label: '',
			hard: true,
			done: false,
			note: ''
		}
	],
	weekNotes: [{ week: '2026-07-05', text: 'No CSE classes' }]
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
				fixed: false,
				createdAt: 0
			}
		]);
		expect(parsed.notes).toEqual([]);
		expect(parsed.longTermTasks).toEqual([]);
		expect(parsed.accounts).toEqual([]);
		expect(parsed.routines).toEqual([]);
		expect(parsed.routineLogs).toEqual([]);
		expect(parsed.slots).toEqual([]);
		expect(parsed.events).toEqual([]);
		expect(parsed.tasks).toEqual([]);
		expect(parsed.deadlines).toEqual([]);
		expect(parsed.weekNotes).toEqual([]);
	});

	it('sanitizes schedule entries', () => {
		const parsed = parseBackup(
			JSON.stringify({
				app: 'daylog',
				version: 1,
				slots: [{ id: 's', kind: 'weird', weekday: 9, startsOn: 'nope' }, { title: 'no id' }],
				events: [{ id: 'e', date: '2026-13-01', status: 'weird', kind: 'exam' }],
				tasks: [{ id: 't', status: 'done', date: '2026-07-01', highlight: 'yes' }],
				weekNotes: [{ week: 'nope', text: 'x' }]
			})
		);
		expect(parsed.slots).toEqual([
			{
				id: 's',
				title: '',
				kind: 'class',
				weekday: 6,
				start: '',
				end: '',
				room: '',
				startsOn: null,
				endsOn: null
			}
		]);
		expect(parsed.events[0]).toMatchObject({ date: null, status: 'planned', kind: 'exam' });
		expect(parsed.tasks[0]).toMatchObject({ status: 'done', date: '2026-07-01', highlight: false });
		expect(parsed.weekNotes).toEqual([]);
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
			'1 days, 1 people, 1 notes, 1 long-term tasks, 1 accounts, 1 transactions, 1 routines, 1 routine days, 1 timetable slots, 1 events, 1 plan tasks, 1 deadlines'
		);
	});
});
