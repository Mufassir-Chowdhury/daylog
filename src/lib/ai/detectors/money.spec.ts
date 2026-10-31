import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../db';
import type { DetectorData } from './index';
import { openDebts, openSince, spendingPace, unusualExpense } from './money';

const TODAY = '2026-10-15';
let n = 0;
const txn = (over: Partial<Transaction>): Transaction => ({
	id: `t${++n}`,
	date: TODAY,
	kind: 'expense',
	category: 'food',
	amount: 100,
	from: 'cash',
	to: null,
	person: null,
	note: '',
	fixed: false,
	group: null,
	createdAt: n,
	...over
});
const data = (transactions: Transaction[], today = TODAY): DetectorData => ({
	today,
	days: {},
	deadlines: [],
	tasks: [],
	transactions
});

describe('spendingPace', () => {
	// Last month: 100 a day for 30 days. This month: by the 15th…
	const lastMonth = Array.from({ length: 30 }, (_, i) =>
		txn({ date: `2026-09-${String(i + 1).padStart(2, '0')}` })
	);

	it('raises spending a fifth or more ahead of last month at the same day', () => {
		const now = [txn({ date: '2026-10-02', amount: 1900 })]; // 1900 vs 1500
		const [signal] = spendingPace(data([...lastMonth, ...now]));
		expect(signal).toMatchObject({ key: 'money:pace:2026-10:0.2', type: 'money', priority: 1 });
		expect(signal.about).toContain('1900 so far, against 1500');
		expect(signal.about).toContain('27% more');
	});

	it('raises it again, more urgently, only as it gets clearly worse', () => {
		const now = [txn({ date: '2026-10-02', amount: 3100 })]; // more than double
		expect(spendingPace(data([...lastMonth, ...now]))[0]).toMatchObject({
			key: 'money:pace:2026-10:1',
			priority: 2
		});
	});

	it('ignores fixed bills, small early-month totals and a month without history', () => {
		expect(
			spendingPace(data([...lastMonth, txn({ date: '2026-10-02', amount: 5000, fixed: true })]))
		).toEqual([]);
		expect(spendingPace(data([...lastMonth, txn({ amount: 250 })], '2026-10-01'))).toEqual([]);
		expect(spendingPace(data([txn({ amount: 9000 })]))).toEqual([]);
	});
});

describe('unusualExpense', () => {
	const usual = Array.from({ length: 6 }, (_, i) =>
		txn({ date: `2026-09-${String(i + 10)}`, amount: 120 })
	);

	it('raises a recent expense at 3× its category or more', () => {
		const big = txn({ amount: 1200, note: 'team lunch' });
		const signals = unusualExpense(data([...usual, big]));
		expect(signals.map((s) => s.key)).toEqual([`money:unusual:${big.id}`]);
		expect(signals[0].about).toContain('10× the usual 120');
		expect(signals[0].about).toContain('(team lunch)');
	});

	it('needs enough history, and only looks at the last two days', () => {
		expect(unusualExpense(data([...usual.slice(0, 3), txn({ amount: 1200 })]))).toEqual([]);
		expect(unusualExpense(data([...usual, txn({ amount: 1200, date: '2026-10-12' })]))).toEqual([]);
		expect(unusualExpense(data([...usual, txn({ amount: 300 })]))).toEqual([]);
	});
});

describe('open debts', () => {
	const lend = (date: string, amount: number) =>
		txn({ kind: 'lend', person: 'rahim', category: '', date, amount });
	const borrow = (date: string, amount: number) =>
		txn({ kind: 'borrow', person: 'rahim', category: '', date, amount });

	it('knows since when a balance has been open, restarting after it settles', () => {
		expect(
			openSince([lend('2026-07-01', 500), borrow('2026-07-20', 500), lend('2026-08-10', 300)]).get(
				'rahim'
			)
		).toEqual({ net: 300, since: '2026-08-10' });
		expect(openSince([lend('2026-07-01', 500), borrow('2026-07-20', 500)]).size).toBe(0);
	});

	it('reminds after 30 days, once per 30 days', () => {
		const [signal] = openDebts(data([lend('2026-09-01', 500)]));
		expect(signal).toMatchObject({
			key: 'money:debt:rahim:2026-09-01:1:500',
			title: '@rahim still owes you'
		});
		expect(signal.about).toContain('since 2026-09-01 (44 days)');
		expect(openDebts(data([lend('2026-10-01', 500)]))).toEqual([]);
		expect(openDebts(data([borrow('2026-08-01', 200)]))[0].title).toBe('You still owe @rahim');
	});
});
