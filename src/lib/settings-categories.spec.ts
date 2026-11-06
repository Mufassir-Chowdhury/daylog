import { afterEach, describe, expect, it } from 'vitest';
import type { Transaction } from './db';
import {
	categoryOptions,
	FEE_CATEGORY,
	feeTransaction,
	manageableCategories,
	moveCategory,
	takesFee
} from './finance';
import { applySettings, settings } from './settings.svelte';

afterEach(() => applySettings({}));

describe('custom categories', () => {
	it('defaults to empty lists and ignores malformed stored values', () => {
		applySettings({});
		expect(settings.customCategories).toEqual({ income: [], expense: [] });
		applySettings({ customCategories: 'nope' as never });
		expect(settings.customCategories).toEqual({ income: [], expense: [] });
		applySettings({ customCategories: { expense: ['rent', 3, '', 'rent'] } as never });
		expect(settings.customCategories).toEqual({ income: [], expense: ['rent'] });
	});

	it('adds the user’s categories after the base list without duplicates', () => {
		applySettings({ customCategories: { income: ['freelance'], expense: ['rent', 'lunch'] } });
		expect(categoryOptions('expense', ['lunch', 'transport'])).toEqual([
			'lunch',
			'transport',
			'rent'
		]);
		expect(categoryOptions('income', ['salary'])).toEqual(['salary', 'freelance']);
		expect(categoryOptions('transfer', ['transfer'])).toEqual(['transfer']);
	});
});

const txn = (over: Partial<Transaction>): Transaction => ({
	id: 't',
	date: '2026-11-06',
	kind: 'expense',
	category: 'lunch',
	amount: 100,
	from: 'cash',
	to: null,
	person: null,
	note: '',
	fixed: false,
	group: null,
	createdAt: 10,
	...over
});

describe('moving a category', () => {
	const txns = [
		txn({ id: 'a', category: 'snacks' }),
		txn({ id: 'b', category: 'snacks' }),
		txn({ id: 'c', category: 'lunch' }),
		txn({ id: 'd', kind: 'income', category: 'snacks' })
	];

	it('renames: rewrites only that kind’s transactions and swaps the custom entry', () => {
		const r = moveCategory(txns, 'expense', 'snacks', 'treats', {
			custom: ['snacks'],
			hidden: []
		});
		expect(r.changed.map((t) => [t.id, t.category])).toEqual([
			['a', 'treats'],
			['b', 'treats']
		]);
		expect(r.custom).toEqual(['treats']);
		expect(r.hidden).toEqual(['snacks']);
	});

	it('merges into an existing preset without adding it to the custom list', () => {
		const r = moveCategory(txns, 'expense', 'snacks', 'lunch', { custom: ['snacks'], hidden: [] });
		expect(r.changed).toHaveLength(2);
		expect(r.custom).toEqual([]);
	});

	it('removing a preset hides it and un-hides the target', () => {
		const r = moveCategory(txns, 'expense', 'lunch', 'other', {
			custom: [],
			hidden: ['other']
		});
		expect(r.changed.map((t) => t.id)).toEqual(['c']);
		expect(r.hidden).toEqual(['lunch']);
	});

	it('hidden categories drop out of the dropdown and the manager unless still used', () => {
		applySettings({ hiddenCategories: { income: [], expense: ['gift', 'lunch'] } });
		expect(categoryOptions('expense', ['gift', 'lunch', 'bills'])).toEqual(['bills']);
		const names = manageableCategories([txn({ category: 'lunch' })], 'expense').map((c) => c.name);
		expect(names).not.toContain('gift');
		expect(names).toContain('lunch');
	});
});

describe('transaction fees', () => {
	it('records the fee as a separate expense from the same account and group', () => {
		const lend = txn({ kind: 'lend', category: 'lend', person: 'rahim', group: 'trip' });
		const fee = feeTransaction(lend, 18.5, 'f1');
		expect(fee).toMatchObject({
			id: 'f1',
			kind: 'expense',
			category: FEE_CATEGORY,
			amount: 18.5,
			from: 'cash',
			person: null,
			group: 'trip',
			note: 'fee on lend'
		});
		expect(fee.createdAt).toBeGreaterThan(lend.createdAt);
		expect(feeTransaction(txn({ note: 'cafe' }), 5, 'f2').note).toBe('fee on lunch · cafe');
	});

	it('applies to money leaving an account only', () => {
		expect(['expense', 'lend', 'transfer'].every((k) => takesFee(k as never))).toBe(true);
		expect(takesFee('income') || takesFee('borrow')).toBe(false);
	});
});
