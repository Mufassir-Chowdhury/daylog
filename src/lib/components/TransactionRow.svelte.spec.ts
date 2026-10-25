import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Transaction } from '$lib/db';
import TransactionRow from './TransactionRow.svelte';

const txn: Transaction = {
	id: 't1',
	date: '2026-10-03',
	kind: 'expense',
	category: 'transport',
	amount: 850,
	from: 'cash',
	to: null,
	person: null,
	note: 'bus from Sylhet to Dhaka, Green Line AC',
	fixed: false,
	group: 'Dhaka trip October 2026',
	createdAt: 0
};
const accounts = [{ id: 'cash', name: 'Cash', startingBalance: 0, order: 0 }];

describe('TransactionRow card', () => {
	it('shows everything and labels its actions', async () => {
		const ondelete = vi.fn();
		const screen = render(TransactionRow, {
			props: { txn, accounts, card: true, onupdate: vi.fn(), ondelete }
		});
		await expect.element(screen.getByText('Dhaka trip October 2026')).toBeVisible();
		await expect.element(screen.getByText(/Green Line AC/)).toBeVisible();

		await screen.getByRole('button', { name: 'Edit transaction' }).click();
		await expect.element(screen.getByRole('button', { name: 'Save' })).toBeVisible();
		await screen.getByRole('button', { name: 'cancel' }).click();

		await screen.getByRole('button', { name: 'Delete transaction' }).click();
		expect(ondelete).toHaveBeenCalledWith(txn);
	});
});
