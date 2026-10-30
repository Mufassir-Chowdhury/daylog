import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleSlot, Transaction } from '../../db';
import { readDay, recentDays, searchDays } from './days';
import { financeSummary, findTransactions } from './finance';
import { scheduleSnapshot } from './schedule';
import { openPage } from './ui';
import type { ToolContext } from './registry';

const db = vi.hoisted(() => ({
	loadDay: vi.fn(),
	listDays: vi.fn(),
	listSlots: vi.fn(),
	listEvents: vi.fn(),
	listTasks: vi.fn(),
	listDeadlines: vi.fn(),
	listWeekNotes: vi.fn(),
	listTransactions: vi.fn(),
	listAccounts: vi.fn(),
	listPeople: vi.fn()
}));
vi.mock('../../db', () => db);

const ctx = (): ToolContext => ({
	uid: 'u',
	today: '2026-10-29', // a Thursday
	cache: new Map(),
	navigate: vi.fn()
});

beforeEach(() => {
	for (const fn of Object.values(db)) fn.mockReset();
});

describe('day tools', () => {
	it('reads a day as timed and other lines', async () => {
		db.loadDay.mockResolvedValue('call @mom\n21:00 gym\n~~grade DM~~');
		expect(await readDay.run(ctx(), { date: '2026-10-29' })).toEqual({
			date: '2026-10-29',
			weekday: 'Thu',
			timed: [{ text: 'gym', time: '9:00 PM' }],
			lines: [{ text: 'call @mom' }, { text: 'grade DM', done: true }]
		});
	});

	it('rejects a malformed date', async () => {
		await expect(readDay.run(ctx(), { date: 'tomorrow' })).rejects.toThrow('2026-10-30');
	});

	it('searches every word, newest first, within a range', async () => {
		db.listDays.mockResolvedValue([
			{ date: '2026-10-01', text: 'met @rahim about thesis' },
			{ date: '2026-10-20', text: 'thesis draft with @rahim\nlunch' },
			{ date: '2026-10-25', text: 'thesis alone' }
		]);
		const result = (await searchDays.run(ctx(), {
			query: '@rahim thesis',
			from: '2026-10-02',
			to: null,
			limit: null
		})) as { total: number; matches: { date: string }[] };
		expect(result.total).toBe(1);
		expect(result.matches[0].date).toBe('2026-10-20');
	});

	it('finds what was left open on the days before', async () => {
		db.loadDay.mockImplementation(async (_uid: string, date: string) =>
			date === '2026-10-28' ? 'a\n~~b~~' : ''
		);
		expect(await recentDays.run(ctx(), { before: '2026-10-29', days: 2 })).toEqual([
			{ date: '2026-10-28', open: [{ text: 'a' }] }
		]);
	});
});

describe('schedule_snapshot', () => {
	it('defaults to this week and next, with timetable rows, overdue and later tasks', async () => {
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
		const task = (id: string, date: string | null) => ({
			id,
			text: id,
			date,
			until: null,
			start: '',
			end: '',
			status: 'open',
			note: '',
			highlight: false,
			createdAt: 0
		});
		db.listSlots.mockResolvedValue([slot]);
		db.listEvents.mockResolvedValue([]);
		db.listTasks.mockResolvedValue([
			task('old', '2026-10-01'),
			task('later', null),
			task('now', '2026-10-27')
		]);
		db.listDeadlines.mockResolvedValue([
			{ id: 'd', text: 'Grades', due: '2026-11-02', label: '', hard: true, done: false, note: '' }
		]);
		db.listWeekNotes.mockResolvedValue([]);

		const snap = (await scheduleSnapshot.run(ctx(), { from: null, to: null })) as Record<
			string,
			{ id: string }[] & unknown
		>;
		expect(snap.from).toBe('2026-10-25');
		expect(snap.to).toBe('2026-11-07');
		expect(
			(snap.events as unknown as { id: string; timetable: boolean }[]).map((e) => e.id)
		).toEqual(['swe_2026-10-26', 'swe_2026-11-02']);
		expect(snap.tasks.map((t) => t.id)).toEqual(['now']);
		expect(snap.overdueTasks.map((t) => t.id)).toEqual(['old']);
		expect(snap.laterTasks.map((t) => t.id)).toEqual(['later']);
		expect(snap.deadlines).toEqual([
			{ id: 'd', text: 'Grades', due: '2026-11-02', daysLeft: 4, hard: true }
		]);
	});

	it('refuses ranges that are backwards or too long', async () => {
		for (const fn of [
			db.listSlots,
			db.listEvents,
			db.listTasks,
			db.listDeadlines,
			db.listWeekNotes
		])
			fn.mockResolvedValue([]);
		await expect(
			scheduleSnapshot.run(ctx(), { from: '2026-10-10', to: '2026-10-01' })
		).rejects.toThrow('before');
		await expect(
			scheduleSnapshot.run(ctx(), { from: '2026-01-01', to: '2026-12-31' })
		).rejects.toThrow('two months');
	});
});

describe('finance tools', () => {
	const txn = (t: Partial<Transaction>): Transaction => ({
		id: 'x',
		date: '2026-10-05',
		kind: 'expense',
		category: 'food',
		amount: 100,
		from: 'cash',
		to: null,
		person: null,
		note: '',
		fixed: false,
		group: null,
		createdAt: 0,
		...t
	});

	beforeEach(() => {
		db.listAccounts.mockResolvedValue([
			{ id: 'cash', name: 'Cash', startingBalance: 1000, order: 0 }
		]);
		db.listPeople.mockResolvedValue([]);
		db.listTransactions.mockResolvedValue([
			txn({ id: 'a', date: '2026-10-20', amount: 300, category: 'transport' }),
			txn({ id: 'b', date: '2026-10-05', amount: 100 }),
			txn({ id: 'c', date: '2026-09-10', amount: 50 }),
			txn({ id: 'd', date: '2026-09-30', amount: 999 }),
			txn({ id: 'e', kind: 'lend', category: '', person: 'rahim', amount: 200, date: '2026-10-02' })
		]);
	});

	it("summarises this month with pace against last month's same days", async () => {
		const out = (await financeSummary.run(ctx(), { month: null })) as Record<string, unknown>;
		expect(out.month).toBe('2026-10');
		expect(out.pace).toEqual({ spentSoFar: 400, lastMonthBySameDay: 50 });
		expect((out.topSpending as { category: string }[]).map((c) => c.category)).toEqual([
			'transport',
			'food'
		]);
		expect(out.accounts).toEqual([{ name: 'Cash', balance: 1000 - 300 - 100 - 50 - 999 - 200 }]);
		expect(out.owed).toEqual({ rahim: 200 });
	});

	it('finds transactions by words, kind and person', async () => {
		const byWord = (await findTransactions.run(ctx(), {
			query: 'transport',
			from: null,
			to: null,
			kind: null,
			person: null,
			limit: null
		})) as { count: number; total: number; transactions: { from: string }[] };
		expect(byWord).toMatchObject({ count: 1, total: 300 });
		expect(byWord.transactions[0].from).toBe('Cash');

		const lends = (await findTransactions.run(ctx(), {
			query: null,
			from: null,
			to: null,
			kind: 'lend',
			person: '@rahim',
			limit: null
		})) as { count: number };
		expect(lends.count).toBe(1);
	});
});

describe('open_page', () => {
	it('opens pages and days, and needs a target where it should', async () => {
		const c = ctx();
		expect(await openPage.run(c, { page: 'finance', target: null })).toBe('Opened finance.');
		await openPage.run(c, { page: 'day', target: null });
		expect(c.navigate).toHaveBeenLastCalledWith('/day/2026-10-29');
		await expect(openPage.run(c, { page: 'person', target: null })).rejects.toThrow('handle');
	});
});
