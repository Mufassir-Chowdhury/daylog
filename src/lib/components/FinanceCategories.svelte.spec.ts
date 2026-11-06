import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { Transaction } from '$lib/db';
import { applySettings, settings } from '$lib/settings.svelte';
import CategorySettings from './CategorySettings.svelte';
import FinancePanel from './FinancePanel.svelte';

const db = vi.hoisted(() => ({
	saveTransaction: vi.fn(async () => {}),
	saveTransactions: vi.fn(async () => {}),
	saveSettings: vi.fn(async () => {}),
	listTransactions: vi.fn(),
	newTransactionId: vi.fn()
}));
vi.mock('$lib/auth.svelte', () => ({ session: { user: { uid: 'u1' } } }));
vi.mock('$lib/db', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/db')>()),
	...db
}));

const accounts = [{ id: 'cash', name: 'Cash', startingBalance: 0, order: 0 }];
const base: Transaction = {
	id: 'x',
	date: '2026-11-06',
	kind: 'expense',
	category: 'snacks',
	amount: 50,
	from: 'cash',
	to: null,
	person: null,
	note: '',
	fixed: false,
	group: null,
	createdAt: 1
};

beforeEach(() => {
	localStorage.clear();
	applySettings({});
	vi.clearAllMocks();
	let n = 0;
	db.newTransactionId.mockImplementation(() => `id${++n}`);
});

describe('FinancePanel', () => {
	it('saves a fee as a separate Transaction Fee expense', async () => {
		const screen = render(FinancePanel, {
			props: { uid: 'u1', date: '2026-11-06', people: [], onnewperson: vi.fn(), accounts, txns: [] }
		});
		await screen.getByRole('spinbutton', { name: /^Amount/ }).fill('500');
		await screen.getByRole('spinbutton', { name: /^Fee/ }).fill('10');
		await screen.getByRole('button', { name: 'Add', exact: true }).click();
		await vi.waitFor(() => expect(db.saveTransaction).toHaveBeenCalledTimes(2));
		const [, main] = db.saveTransaction.mock.calls[0] as unknown as [string, Transaction];
		const [, fee] = db.saveTransaction.mock.calls[1] as unknown as [string, Transaction];
		expect(main).toMatchObject({ kind: 'expense', amount: 500 });
		expect(fee).toMatchObject({
			kind: 'expense',
			category: 'Transaction Fee',
			amount: 10,
			from: 'cash'
		});
	});

	it('adds a new category from the dropdown and remembers it', async () => {
		const screen = render(FinancePanel, {
			props: { uid: 'u1', date: '2026-11-06', people: [], onnewperson: vi.fn(), accounts, txns: [] }
		});
		await screen.getByRole('combobox').first().selectOptions('+ new category…');
		await screen.getByRole('textbox', { name: 'New category' }).fill('rent');
		await screen.getByRole('button', { name: 'Add', exact: true }).first().click();
		expect(settings.customCategories.expense).toEqual(['rent']);
		expect(db.saveSettings).toHaveBeenCalled();
	});
});

const row = (screen: ReturnType<typeof render>, name: string) =>
	screen.getByRole('listitem').filter({ hasText: new RegExp(`^${name}`) });

describe('CategorySettings', () => {
	it('renames a category and moves its transactions', async () => {
		db.listTransactions.mockResolvedValue([base, { ...base, id: 'y', category: 'lunch' }]);
		const screen = render(CategorySettings);
		await expect.element(screen.getByText('snacks')).toBeVisible();
		await row(screen, 'snacks').getByRole('button', { name: 'Rename' }).click();
		await screen.getByLabelText('New name for snacks').fill('treats');
		await screen.getByRole('button', { name: 'Save' }).click();
		await vi.waitFor(() => expect(db.saveTransactions).toHaveBeenCalled());
		const [, changed] = db.saveTransactions.mock.calls[0] as unknown as [string, Transaction[]];
		expect(changed.map((t) => [t.id, t.category])).toEqual([['x', 'treats']]);
		expect(settings.customCategories.expense).toEqual(['treats']);
		expect(settings.hiddenCategories.expense).toEqual(['snacks']);
	});

	it('removes a built-in category from the list', async () => {
		db.listTransactions.mockResolvedValue([]);
		const screen = render(CategorySettings);
		await expect.element(screen.getByText('gift')).toBeVisible();
		await row(screen, 'gift').getByRole('button', { name: 'Remove' }).click();
		expect(settings.hiddenCategories.expense).toContain('gift');
		await expect.element(row(screen, 'gift')).not.toBeInTheDocument();
	});
});
