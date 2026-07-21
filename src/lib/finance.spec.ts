import { describe, expect, it } from 'vitest';
import type { Account, Transaction } from './db';
import { balances, formatMoney, monthlySummaries, personBalances, signedAmount } from './finance';

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
});

describe('monthlySummaries', () => {
	it('totals income and expense per month, excluding transfers and debts, newest first', () => {
		const txns = [
			txn({ date: '2026-06-10', kind: 'income', amount: 1000 }),
			txn({ date: '2026-07-05', kind: 'expense', amount: 200 }),
			txn({ date: '2026-07-20', kind: 'income', amount: 800 }),
			txn({ date: '2026-07-21', kind: 'transfer', amount: 9999 }),
			txn({ date: '2026-07-21', kind: 'lend', person: 'rahim', amount: 9999 }),
			txn({ date: '2026-07-21', kind: 'borrow', person: 'karim', amount: 9999 })
		];
		expect(monthlySummaries(txns)).toEqual([
			{ month: '2026-07', income: 800, expense: 200, net: 600 },
			{ month: '2026-06', income: 1000, expense: 0, net: 1000 }
		]);
	});
});

describe('money formatting', () => {
	it('uses taka with lakh grouping', () => {
		expect(formatMoney(150000)).toBe('৳1,50,000');
	});

	it('signs amounts by kind', () => {
		expect(signedAmount('income', 500)).toBe('+৳500');
		expect(signedAmount('expense', 500)).toBe('−৳500');
		expect(signedAmount('transfer', 500)).toBe('৳500');
		expect(signedAmount('lend', 500)).toBe('−৳500');
		expect(signedAmount('borrow', 500)).toBe('+৳500');
	});
});
