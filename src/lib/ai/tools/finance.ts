import { addDays, monthOf, shiftMonth } from '../../date';
import {
	listAccounts,
	listPeople,
	listTransactions,
	newTransactionId,
	type Account,
	type Transaction,
	type TransactionKind
} from '../../db';
import {
	balances,
	categoryTotals,
	formatMoney,
	matchesSearch,
	monthlySummaries,
	personBalances
} from '../../finance';
import { addTransaction, updateTransaction } from '../../ops/records';
import { isValidHandle } from '../../parse';
import { shortDay } from '../../schedule';
import { settings } from '../../settings.svelte';
import {
	cached,
	compact,
	dayKey,
	enumOf,
	num,
	optBool,
	optEnum,
	optInt,
	optNum,
	optStr,
	params,
	str,
	type Tool
} from './registry';

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

// ——— Changes. Money records always go through a card unless Settings say otherwise.

/** An account by name (exact, then prefix), or the only account when none is named. */
function account(accounts: Account[], name: unknown, role: string): Account {
	const wanted = typeof name === 'string' ? name.trim().toLowerCase() : '';
	if (!wanted && accounts.length === 1) return accounts[0];
	const hit =
		accounts.find((a) => a.name.toLowerCase() === wanted) ??
		(wanted ? accounts.find((a) => a.name.toLowerCase().startsWith(wanted)) : undefined);
	if (!hit)
		throw new Error(
			`Which account is the money ${role}? Accounts: ${accounts.map((a) => a.name).join(', ') || 'none yet'}.`
		);
	return hit;
}

const money = formatMoney;

export const addTransactionTool: Tool = {
	area: 'finance',
	kind: 'write',
	label: 'Record money',
	def: {
		name: 'add_transaction',
		description:
			'Record money: expense (leaves an account), income (enters one), transfer (between two accounts), ' +
			'lend (the owner gave a person money — or paid back what they owed) or borrow (a person gave the owner money).',
		parameters: params({
			kind: enumOf(['expense', 'income', 'transfer', 'lend', 'borrow'], 'Kind.'),
			amount: num('Amount, positive.'),
			date: optStr('Day, YYYY-MM-DD, or null for today.'),
			category: optStr('For expense/income: food, transport, salary… Null for the others.'),
			account: optStr(
				'Account the money left (expense, transfer, lend) or entered (income, borrow); null if there is only one.'
			),
			to_account: optStr('For a transfer: the account it went into.'),
			person: optStr('For lend/borrow: their handle, without @.'),
			note: optStr('Note, or null.'),
			fixed: optBool('A recurring bill or income (rent, salary), default false.'),
			group: optStr('Group label tying related records together ("Dhaka trip"), or null.')
		})
	},
	describe: () => 'Preparing a money record',
	async plan(ctx, input) {
		const kind = input.kind as TransactionKind;
		const amount = Number(input.amount);
		if (!(amount > 0)) throw new Error('amount should be more than 0.');
		const accounts = await listAccounts(ctx.uid);
		const date = input.date ? dayKey(input.date) : ctx.today;
		const person = input.person ? String(input.person).replace(/^@/, '') : null;
		if ((kind === 'lend' || kind === 'borrow') && (!person || !isValidHandle(person)))
			throw new Error('person (a handle) is needed for lend and borrow.');
		const leaves = kind === 'expense' || kind === 'transfer' || kind === 'lend';
		const main = account(accounts, input.account, leaves ? 'leaving' : 'going into');
		const into = kind === 'transfer' ? account(accounts, input.to_account, 'going into') : null;
		if (into && into.id === main.id) throw new Error('A transfer needs two different accounts.');
		const category =
			kind === 'expense' || kind === 'income' ? String(input.category ?? '').trim() || 'other' : '';
		const txn: Transaction = {
			id: newTransactionId(ctx.uid),
			date,
			kind,
			category,
			amount,
			from: leaves ? main.id : null,
			to: kind === 'transfer' ? into!.id : leaves ? null : main.id,
			person: kind === 'lend' || kind === 'borrow' ? person : null,
			note: String(input.note ?? '').trim(),
			fixed: input.fixed === true,
			group: String(input.group ?? '').trim() || null,
			createdAt: Date.now()
		};
		const what =
			kind === 'expense'
				? `${money(amount)} on ${category} from ${main.name}`
				: kind === 'income'
					? `${money(amount)} ${category} into ${main.name}`
					: kind === 'transfer'
						? `a ${money(amount)} transfer from ${main.name} to ${into!.name}`
						: kind === 'lend'
							? `${money(amount)} given to @${person} from ${main.name}`
							: `${money(amount)} from @${person} into ${main.name}`;
		return {
			changes: addTransaction(txn),
			summary: `Record ${what}${date === ctx.today ? '' : ` on ${shortDay(date)}`}`
		};
	}
};

export const updateTransactionTool: Tool = {
	area: 'finance',
	kind: 'write',
	label: 'Edit money records',
	def: {
		name: 'update_transaction',
		description:
			'Fix a recorded transaction: amount, date, category, note, fixed or group. Null keeps a field.',
		parameters: params({
			id: str('Transaction id from find_transactions.'),
			amount: optNum('New amount.'),
			date: optStr('New day, YYYY-MM-DD.'),
			category: optStr('New category.'),
			note: optStr('New note ("" clears).'),
			fixed: optBool('Recurring.'),
			group: optStr('New group ("" clears).')
		})
	},
	describe: () => 'Preparing a money fix',
	async plan(ctx, input) {
		const txn = (await listTransactions(ctx.uid)).find((t) => t.id === input.id);
		if (!txn) throw new Error('No transaction with that id. Use find_transactions.');
		const amount = input.amount === null ? txn.amount : Number(input.amount);
		if (!(amount > 0)) throw new Error('amount should be more than 0.');
		const fields = {
			amount,
			date: input.date ? dayKey(input.date) : txn.date,
			category: input.category ? String(input.category).trim() : txn.category,
			note: input.note === null ? txn.note : String(input.note).trim(),
			fixed: typeof input.fixed === 'boolean' ? input.fixed : txn.fixed,
			group: input.group === null ? txn.group : String(input.group).trim() || null
		};
		const changed = Object.entries(fields)
			.filter(([k, v]) => txn[k as keyof typeof fields] !== v)
			.map(([k]) => k);
		const label = `the ${money(txn.amount)} ${txn.kind} on ${shortDay(txn.date)}`;
		if (!changed.length) return { changes: [], summary: `${label} as asked` };
		return {
			changes: updateTransaction(txn, fields),
			summary: `Change the ${changed.join(', ')} of ${label}`
		};
	}
};

export const FINANCE_TOOLS = [
	financeSummary,
	findTransactions,
	addTransactionTool,
	updateTransactionTool
];
