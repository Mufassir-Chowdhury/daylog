import type { Account, Transaction, TransactionKind } from './db';
import { settings } from './settings.svelte';

/** Suggested category presets per kind — the UI also accepts free text. */
export const CATEGORIES: Record<TransactionKind, string[]> = {
	expense: ['payment', 'lunch', 'transport', 'donation', 'gift', 'shopping', 'bills', 'other'],
	income: ['salary', 'income', 'bonus', 'gift', 'other'],
	transfer: ['transfer'],
	lend: ['lend'],
	borrow: ['borrow']
};

/** Account names offered when the user has none set up yet. */
export const SUGGESTED_ACCOUNTS = ['Cash', 'Islami Bank', 'Sonali Bank', 'bKash'];

/** Current balance per account id: starting balance + everything in − everything out. */
export function balances(accounts: Account[], txns: Transaction[]): Map<string, number> {
	const map = new Map(accounts.map((a) => [a.id, a.startingBalance]));
	for (const t of txns) {
		if (t.from !== null && map.has(t.from)) map.set(t.from, map.get(t.from)! - t.amount);
		if (t.to !== null && map.has(t.to)) map.set(t.to, map.get(t.to)! + t.amount);
	}
	return map;
}

/**
 * Net debt per person handle: lends minus borrows. Positive → they owe you,
 * negative → you owe them; settled (zero) people are dropped.
 */
export function personBalances(txns: Transaction[]): Map<string, number> {
	const map = new Map<string, number>();
	for (const t of txns) {
		if (t.person === null || (t.kind !== 'lend' && t.kind !== 'borrow')) continue;
		const delta = t.kind === 'lend' ? t.amount : -t.amount;
		map.set(t.person, (map.get(t.person) ?? 0) + delta);
	}
	for (const [handle, amount] of map) if (amount === 0) map.delete(handle);
	return map;
}

export interface MonthSummary {
	/** `YYYY-MM` */
	month: string;
	income: number;
	expense: number;
	net: number;
}

/** Month key (`YYYY-MM`) of a day key. */
export function monthOf(dateKey: string): string {
	return dateKey.slice(0, 7);
}

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

export function monthLabel(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return MONTH_LABEL.format(new Date(y, m - 1, 1));
}

/**
 * Income/expense totals per month, newest first. Transfers move money between
 * accounts and lends/borrows are owed back, so neither counts as income or
 * spending.
 */
export function monthlySummaries(txns: Transaction[]): MonthSummary[] {
	const map = new Map<string, MonthSummary>();
	for (const t of txns) {
		if (t.kind !== 'income' && t.kind !== 'expense') continue;
		const month = monthOf(t.date);
		let s = map.get(month);
		if (!s) {
			s = { month, income: 0, expense: 0, net: 0 };
			map.set(month, s);
		}
		if (t.kind === 'income') s.income += t.amount;
		else s.expense += t.amount;
		s.net = s.income - s.expense;
	}
	return [...map.values()].sort((a, b) => b.month.localeCompare(a.month));
}

// en-IN grouping matches the Bangladeshi lakh/crore convention (1,00,000).
const MONEY = {
	lakh: new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }),
	thousand: new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
} as const;

export function formatMoney(amount: number): string {
	return `${settings.currency}${MONEY[settings.grouping].format(amount)}`;
}

/** "+৳500" / "−৳500" / "৳500" by whether cash moved into or out of the user's accounts. */
export function signedAmount(kind: TransactionKind, amount: number): string {
	if (kind === 'income' || kind === 'borrow') return `+${formatMoney(amount)}`;
	if (kind === 'expense' || kind === 'lend') return `−${formatMoney(amount)}`;
	return formatMoney(amount);
}
