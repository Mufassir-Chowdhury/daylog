import { addDays, monthOf, shiftMonth } from '../../date';
import { listAccounts, listPeople, listTransactions, type Transaction } from '../../db';
import {
	balances,
	categoryTotals,
	matchesSearch,
	monthlySummaries,
	personBalances
} from '../../finance';
import { settings } from '../../settings.svelte';
import { cached, compact, dayKey, optEnum, optInt, optStr, params, type Tool } from './registry';

const KINDS = ['income', 'expense', 'transfer', 'lend', 'borrow'];

/** Spending from the 1st up to the same day of the month. */
function spentBy(txns: Transaction[], month: string, day: number): number {
	return txns
		.filter(
			(t) => t.kind === 'expense' && monthOf(t.date) === month && Number(t.date.slice(8)) <= day
		)
		.reduce((sum, t) => sum + t.amount, 0);
}

export const financeSummary: Tool = {
	area: 'finance',
	kind: 'read',
	def: {
		name: 'finance_summary',
		description:
			"A month's money: income, spending, net, savings rate, top categories, spending pace against last month " +
			'on the same day, account balances now, and who owes whom.',
		parameters: params({ month: optStr('Month, YYYY-MM, or null for this month.') })
	},
	describe: () => 'Looking at your finances',
	async run(ctx, input) {
		const month =
			typeof input.month === 'string' && /^\d{4}-\d{2}$/.test(input.month)
				? input.month
				: monthOf(ctx.today);
		const [txns, accounts] = await Promise.all([
			cached(ctx, 'txns', () => listTransactions(ctx.uid)),
			cached(ctx, 'accounts', () => listAccounts(ctx.uid))
		]);
		const summaries = monthlySummaries(txns);
		const find = (m: string) => summaries.find((s) => s.month === m) ?? null;
		const prev = shiftMonth(month, -1);
		const current = month === monthOf(ctx.today);
		const day = Number(ctx.today.slice(8));
		const balance = balances(accounts, txns);
		return {
			currency: settings.currency,
			month,
			summary: find(month),
			previousMonth: find(prev),
			...(current
				? {
						pace: {
							spentSoFar: spentBy(txns, month, day),
							lastMonthBySameDay: spentBy(txns, prev, day)
						}
					}
				: {}),
			topSpending: categoryTotals(txns, 'expense', month).slice(0, 10),
			income: categoryTotals(txns, 'income', month),
			accounts: accounts.map((a) => ({ name: a.name, balance: balance.get(a.id) ?? 0 })),
			owed: Object.fromEntries(personBalances(txns))
		};
	}
};

export const findTransactions: Tool = {
	area: 'finance',
	kind: 'read',
	def: {
		name: 'find_transactions',
		description:
			'Search transactions, newest first. Every filter is optional (null). Returns the matches and their total.',
		parameters: params({
			query: optStr('Words in the category, note, group, person or account.'),
			from: optStr('Earliest day, YYYY-MM-DD.'),
			to: optStr('Latest day, YYYY-MM-DD.'),
			kind: optEnum(KINDS, 'Only this kind.'),
			person: optStr('Only lends/borrows with this handle (no @).'),
			limit: optInt('Most to return (default 30, max 100).')
		})
	},
	describe: (i) => (i.query ? `Searching transactions for “${i.query}”` : 'Searching transactions'),
	async run(ctx, input) {
		const [txns, accounts, people] = await Promise.all([
			cached(ctx, 'txns', () => listTransactions(ctx.uid)),
			cached(ctx, 'accounts', () => listAccounts(ctx.uid)),
			cached(ctx, 'people', () => listPeople(ctx.uid))
		]);
		const from = input.from ? dayKey(input.from, 'from') : '0000-00-00';
		const to = input.to ? dayKey(input.to, 'to') : addDays(ctx.today, 3650);
		const person = input.person ? String(input.person).replace(/^@/, '') : null;
		const matches = txns.filter(
			(t) =>
				t.date >= from &&
				t.date <= to &&
				(!input.kind || t.kind === input.kind) &&
				(!person || t.person === person) &&
				matchesSearch(t, String(input.query ?? ''), accounts, people)
		);
		const account = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? null;
		const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 100);
		return {
			currency: settings.currency,
			count: matches.length,
			total: matches.reduce((sum, t) => sum + t.amount, 0),
			transactions: matches.slice(0, limit).map((t) =>
				compact({
					id: t.id,
					date: t.date,
					kind: t.kind,
					category: t.category,
					amount: t.amount,
					from: account(t.from),
					to: account(t.to),
					person: t.person,
					note: t.note,
					group: t.group,
					fixed: t.fixed
				})
			)
		};
	}
};

export const FINANCE_TOOLS = [financeSummary, findTransactions];
