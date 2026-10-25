import { describe, expect, it } from 'vitest';
import type { Account, Transaction } from './db';
import {
	accountMonthFlow,
	balances,
	categorySuggestions,
	categoryTotals,
	categoryTrend,
	cumulativeSpending,
	formatMoney,
	groupByMonth,
	groupSummaries,
	groupSuggestions,
	matchesSearch,
	monthlySummaries,
	monthlyTotals,
	OTHER,
	personBalances,
	personHistory,
	personStats,
	rangeLabel,
	shortMoney,
	signedAmount,
	transactionsToCsv
} from './finance';
import { applySettings } from './settings.svelte';

const acct = (id: string, startingBalance: number): Account => ({
	id,
	name: id,
	startingBalance,
	order: 0
});

const txn = (t: Partial<Transaction>): Transaction => ({
	id: 'x',
	date: '2026-07-01',
	kind: 'expense',
	category: '',
	amount: 0,
	from: null,
	to: null,
	person: null,
	note: '',
	fixed: false,
	group: null,
	createdAt: 0,
	...t
});

describe('balances', () => {
	it('applies income, expense and transfers to starting balances', () => {
		const accounts = [acct('cash', 1000), acct('bank', 5000)];
		const txns = [
			txn({ kind: 'income', to: 'bank', amount: 2000 }),
			txn({ kind: 'expense', from: 'cash', amount: 300 }),
			txn({ kind: 'transfer', from: 'bank', to: 'cash', amount: 500 })
		];
		const b = balances(accounts, txns);
		expect(b.get('cash')).toBe(1200);
		expect(b.get('bank')).toBe(6500);
	});

	it('ignores transactions pointing at deleted accounts', () => {
		const b = balances([acct('cash', 100)], [txn({ kind: 'expense', from: 'gone', amount: 50 })]);
		expect(b.get('cash')).toBe(100);
	});

	it('moves cash out on lend and in on borrow', () => {
		const b = balances(
			[acct('cash', 1000)],
			[
				txn({ kind: 'lend', from: 'cash', person: 'rahim', amount: 300 }),
				txn({ kind: 'borrow', to: 'cash', person: 'karim', amount: 100 })
			]
		);
		expect(b.get('cash')).toBe(800);
	});
});

describe('accountMonthFlow', () => {
	it('counts both sides of transfers within the month only', () => {
		const flow = accountMonthFlow(
			[
				txn({ date: '2026-07-01', kind: 'income', to: 'bank', amount: 100 }),
				txn({ date: '2026-07-02', kind: 'transfer', from: 'bank', to: 'cash', amount: 40 }),
				txn({ date: '2026-06-02', kind: 'expense', from: 'cash', amount: 999 })
			],
			'2026-07'
		);
		expect(flow.get('bank')).toEqual({ in: 100, out: 40 });
		expect(flow.get('cash')).toEqual({ in: 40, out: 0 });
	});
});

describe('personBalances', () => {
	it('nets lends against borrows per person and drops settled people', () => {
		const txns = [
			txn({ kind: 'lend', person: 'rahim', amount: 500 }),
			txn({ kind: 'borrow', person: 'rahim', amount: 200 }),
			txn({ kind: 'borrow', person: 'karim', amount: 300 }),
			txn({ kind: 'lend', person: 'salma', amount: 400 }),
			txn({ kind: 'borrow', person: 'salma', amount: 400 }),
			txn({ kind: 'expense', person: null, amount: 999 })
		];
		const b = personBalances(txns);
		expect(b.get('rahim')).toBe(300); // owes you
		expect(b.get('karim')).toBe(-300); // you owe
		expect(b.has('salma')).toBe(false);
	});

	it('does not leave floating point dust', () => {
		const b = personBalances([
			txn({ kind: 'lend', person: 'x', amount: 0.1 }),
			txn({ kind: 'lend', person: 'x', amount: 0.2 }),
			txn({ kind: 'borrow', person: 'x', amount: 0.3 })
		]);
		expect(b.size).toBe(0);
	});
});

describe('person history', () => {
	const txns = [
		txn({ id: 'b', date: '2026-07-05', kind: 'borrow', person: 'rahim', amount: 200 }),
		txn({ id: 'a', date: '2026-07-01', kind: 'lend', person: 'rahim', amount: 500 }),
		txn({ id: 'c', date: '2026-07-09', kind: 'borrow', person: 'rahim', amount: 300 }),
		txn({ id: 'd', date: '2026-07-09', kind: 'lend', person: 'karim', amount: 1 })
	];

	it('orders oldest first with a running balance', () => {
		expect(personHistory(txns, 'rahim').map((h) => [h.txn.id, h.balance])).toEqual([
			['a', 500],
			['b', 300],
			['c', 0]
		]);
	});

	it('keeps settled people in stats', () => {
		expect(personStats(txns).get('rahim')).toEqual({
			lent: 500,
			borrowed: 500,
			net: 0,
			count: 3,
			last: '2026-07-09'
		});
	});
});

describe('monthlySummaries', () => {
	it('totals every kind per month, but only income and expense feed net', () => {
		const txns = [
			txn({ date: '2026-06-10', kind: 'income', amount: 1000 }),
			txn({ date: '2026-07-05', kind: 'expense', amount: 200, fixed: true }),
			txn({ date: '2026-07-06', kind: 'expense', amount: 100 }),
			txn({ date: '2026-07-20', kind: 'income', amount: 800 }),
			txn({ date: '2026-07-21', kind: 'transfer', amount: 50 }),
			txn({ date: '2026-07-21', kind: 'lend', person: 'rahim', amount: 70 }),
			txn({ date: '2026-07-21', kind: 'borrow', person: 'karim', amount: 30 })
		];
		expect(monthlySummaries(txns)).toEqual([
			{
				month: '2026-07',
				income: 800,
				expense: 300,
				net: 500,
				fixed: 200,
				lent: 70,
				borrowed: 30,
				transfers: 50,
				count: 6,
				savingsRate: 500 / 800
			},
			{
				month: '2026-06',
				income: 1000,
				expense: 0,
				net: 1000,
				fixed: 0,
				lent: 0,
				borrowed: 0,
				transfers: 0,
				count: 1,
				savingsRate: 1
			}
		]);
	});

	it('has no savings rate without income', () => {
		expect(monthlySummaries([txn({ kind: 'expense', amount: 5 })])[0].savingsRate).toBeNull();
	});
});

describe('categories', () => {
	const txns = [
		txn({ date: '2026-07-01', kind: 'income', category: 'salary', amount: 50000 }),
		txn({ date: '2026-07-02', kind: 'income', category: 'bonus', amount: 5000 }),
		txn({ date: '2026-06-01', kind: 'income', category: 'salary', amount: 50000 }),
		txn({ date: '2026-07-03', kind: 'expense', category: 'lunch', amount: 100 }),
		txn({ date: '2026-07-04', kind: 'expense', category: 'lunch', amount: 150 }),
		txn({ date: '2026-07-04', kind: 'expense', category: 'rent', amount: 9000 })
	];

	it('totals income categories with counts', () => {
		expect(categoryTotals(txns, 'income')).toEqual([
			{ category: 'salary', amount: 100000, count: 2 },
			{ category: 'bonus', amount: 5000, count: 1 }
		]);
		expect(categoryTotals(txns, 'income', '2026-06')).toEqual([
			{ category: 'salary', amount: 50000, count: 1 }
		]);
	});

	it('folds small categories into other for the trend', () => {
		const trend = categoryTrend(txns, 'expense', ['2026-06', '2026-07'], 1);
		expect(trend.categories).toEqual(['rent', OTHER]);
		expect(trend.rows[1]).toEqual({
			month: '2026-07',
			values: { rent: 9000, [OTHER]: 250 },
			total: 9250
		});
		expect(trend.rows[0].total).toBe(0);
	});

	it('totals one category per month', () => {
		expect(monthlyTotals(txns, ['2026-06', '2026-07'], (t) => t.category === 'salary')).toEqual([
			{ month: '2026-06', amount: 50000, count: 1 },
			{ month: '2026-07', amount: 50000, count: 1 }
		]);
	});

	it('suggests presets then previously used categories by frequency', () => {
		const s = categorySuggestions(
			[
				...txns,
				txn({ kind: 'expense', category: 'rent' }),
				txn({ kind: 'expense', category: 'gym' })
			],
			'expense'
		);
		expect(s[0]).toBe('payment');
		expect(s.slice(-2)).toEqual(['rent', 'gym']);
	});
});

describe('cumulativeSpending', () => {
	it('runs a total per day and stops after the cutoff day', () => {
		const series = cumulativeSpending(
			[
				txn({ date: '2026-02-01', kind: 'expense', amount: 10 }),
				txn({ date: '2026-02-03', kind: 'expense', amount: 5 }),
				txn({ date: '2026-02-03', kind: 'income', amount: 999 })
			],
			'2026-02',
			3
		);
		expect(series).toHaveLength(28);
		expect(series.slice(0, 4)).toEqual([10, 10, 15, null]);
	});
});

describe('groupByMonth', () => {
	it('nests days inside months preserving order', () => {
		const groups = groupByMonth([
			txn({ id: '1', date: '2026-07-09' }),
			txn({ id: '2', date: '2026-07-09' }),
			txn({ id: '3', date: '2026-07-01' }),
			txn({ id: '4', date: '2026-06-30' })
		]);
		expect(groups.map((g) => [g.month, g.count, g.days.map((d) => d.date)])).toEqual([
			['2026-07', 3, ['2026-07-09', '2026-07-01']],
			['2026-06', 1, ['2026-06-30']]
		]);
	});
});

describe('matchesSearch', () => {
	const accounts = [{ ...acct('a1', 0), name: 'bKash' }];
	const people = [{ handle: 'rahim', name: 'Rahim Uddin' }];
	const t = txn({ kind: 'lend', category: 'lend', from: 'a1', person: 'rahim', note: 'for rent' });

	it('matches note, person name, handle and account', () => {
		for (const q of ['RENT', 'uddin', '@rahim', 'bkash', '']) {
			expect(matchesSearch(t, q, accounts, people)).toBe(true);
		}
		expect(matchesSearch(t, 'lunch', accounts, people)).toBe(false);
	});

	it('matches the group label', () => {
		const grouped = txn({ category: 'transport', group: 'Dhaka trip October 2026' });
		expect(matchesSearch(grouped, 'dhaka', [], [])).toBe(true);
	});
});

describe('groups', () => {
	const trip = 'Dhaka trip October 2026';
	const txns = [
		txn({ id: '1', date: '2026-10-03', category: 'transport', amount: 800, group: trip }),
		txn({ id: '2', date: '2026-10-05', category: 'payment', amount: 1200.1, group: trip }),
		txn({
			id: '3',
			date: '2026-10-04',
			kind: 'income',
			category: 'refund',
			amount: 300,
			group: trip
		}),
		txn({ id: '4', date: '2026-10-06', kind: 'lend', amount: 500, person: 'rahim', group: trip }),
		txn({ id: '5', date: '2026-09-01', category: 'payment', amount: 99, group: 'Eid 2026' }),
		txn({ id: '6', date: '2026-10-10', category: 'lunch', amount: 150 })
	];

	it('totals each group by kind and spans its dates', () => {
		const [dhaka, eid, ...rest] = groupSummaries(txns);
		expect(rest).toEqual([]);
		expect(dhaka).toEqual({
			group: trip,
			spent: 2000.1,
			earned: 300,
			lent: 500,
			borrowed: 0,
			count: 4,
			first: '2026-10-03',
			last: '2026-10-06'
		});
		expect(eid).toMatchObject({ group: 'Eid 2026', spent: 99, count: 1 });
	});

	it('suggests the most recently active groups first', () => {
		expect(groupSuggestions(txns)).toEqual([trip, 'Eid 2026']);
		expect(groupSuggestions([])).toEqual([]);
	});

	it('labels a date span compactly', () => {
		expect(rangeLabel('2026-10-03', '2026-10-03')).toBe('Oct 3, 2026');
		expect(rangeLabel('2026-10-03', '2026-10-06').replace(/\s/g, ' ')).toBe('Oct 3 – 6, 2026');
	});
});

describe('transactionsToCsv', () => {
	it('names accounts and quotes fields with commas and quotes', () => {
		const csv = transactionsToCsv(
			[txn({ kind: 'expense', category: 'food', amount: 12.5, from: 'a1', note: 'tea, "chai"' })],
			[{ ...acct('a1', 0), name: 'Cash' }]
		);
		expect(csv.split('\r\n')).toEqual([
			'date,kind,category,amount,from,to,person,fixed,group,note',
			'2026-07-01,expense,food,12.5,Cash,,,,,"tea, ""chai"""'
		]);
	});
});

describe('money formatting', () => {
	it('uses taka with lakh grouping by default', () => {
		expect(formatMoney(150000)).toBe('৳1,50,000');
	});

	it('follows the currency and grouping settings', () => {
		applySettings({ currency: '$', grouping: 'thousand' });
		try {
			expect(formatMoney(150000)).toBe('$150,000');
		} finally {
			applySettings({});
		}
	});

	it('puts the sign before the currency', () => {
		expect(formatMoney(-500)).toBe('−৳500');
	});

	it('abbreviates axis labels per grouping', () => {
		expect(shortMoney(150000)).toBe('৳1.5L');
		expect(shortMoney(2500)).toBe('৳2.5k');
		applySettings({ grouping: 'thousand' });
		try {
			expect(shortMoney(1500000)).toBe('৳1.5M');
		} finally {
			applySettings({});
		}
	});

	it('signs amounts by kind', () => {
		expect(signedAmount('income', 500)).toBe('+৳500');
		expect(signedAmount('expense', 500)).toBe('−৳500');
		expect(signedAmount('transfer', 500)).toBe('৳500');
		expect(signedAmount('lend', 500)).toBe('−৳500');
		expect(signedAmount('borrow', 500)).toBe('+৳500');
	});
});
