import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Transaction } from '$lib/db';
import GroupDetail from './GroupDetail.svelte';

const trip = 'Dhaka trip October 2026';
const txn = (t: Partial<Transaction>): Transaction => ({
	id: 'x',
	date: '2026-10-03',
	kind: 'expense',
	category: 'payment',
	amount: 0,
	from: 'cash',
	to: null,
	person: null,
	note: '',
	fixed: false,
	group: null,
	createdAt: 0,
	...t
});

const txns = [
	txn({ id: 'near', date: '2026-10-07', category: 'lunch', amount: 150 }),
	txn({ id: 'b', date: '2026-10-05', category: 'transport', amount: 800, group: trip }),
	txn({ id: 'a', date: '2026-10-03', category: 'payment', amount: 1200, group: trip }),
	txn({ id: 'far', date: '2026-09-01', category: 'lunch', amount: 99 })
];
const accounts = [{ id: 'cash', name: 'Cash', startingBalance: 0, order: 0 }];

const setup = () => {
	const onupdate = vi.fn();
	const onrename = vi.fn();
	const screen = render(GroupDetail, {
		props: { group: trip, txns, accounts, onupdate, ondelete: vi.fn(), onrename }
	});
	return { screen, onupdate, onrename };
};

describe('GroupDetail', () => {
	it('totals the group and breaks spending down by category', async () => {
		const { screen } = setup();
		await expect.element(screen.getByText('৳2,000').first()).toBeVisible();
		await expect.element(screen.getByText('3 days')).toBeVisible();
		await expect.element(screen.getByText('Spending by category')).toBeVisible();
	});

	it('offers nearby ungrouped transactions and adds them to the group', async () => {
		const { screen, onupdate } = setup();
		const add = screen.getByRole('button', { name: '+ add' });
		expect(add.elements()).toHaveLength(1);
		await add.click();
		expect(onupdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'near', group: trip }));
	});

	it('renames every transaction through onrename', async () => {
		const { screen, onrename } = setup();
		await screen.getByRole('button', { name: 'rename…' }).click();
		await screen.getByRole('textbox').fill('Dhaka 2026');
		await screen.getByRole('button', { name: 'Save' }).click();
		expect(onrename).toHaveBeenCalledWith('Dhaka 2026');
	});
});
