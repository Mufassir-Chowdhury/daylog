import { daysInMonth, monthOf } from './date';
import type { Account, Person, Transaction, TransactionKind } from './db';
import { settings } from './settings.svelte';

export { monthOf };

/** Suggested category presets per kind — the UI also accepts free text. */
export const CATEGORIES: Record<TransactionKind, string[]> = {
	expense: ['payment', 'lunch', 'transport', 'donation', 'gift', 'shopping', 'bills', 'other'],
	income: ['salary', 'income', 'bonus', 'gift', 'other'],
	transfer: ['transfer'],
	lend: ['lend'],
	borrow: ['borrow']
};

export const KIND_LABEL: Record<TransactionKind, string> = {
	expense: 'Expense',
	income: 'Income',
	transfer: 'Transfer',
	lend: 'Lend',
	borrow: 'Borrow'
};

/** Account names offered when the user has none set up yet. */
export const SUGGESTED_ACCOUNTS = ['Cash', 'Islami Bank', 'Sonali Bank', 'bKash'];

/** Only income and expense carry a user-chosen category; the rest use their kind. */
export const hasCategory = (kind: TransactionKind) => kind === 'expense' || kind === 'income';

/**
 * Category suggestions for a kind: presets first, then anything the user has
 * typed before for that kind, most used first.
 */
export function categorySuggestions(txns: Transaction[], kind: TransactionKind): string[] {
	const used = new Map<string, number>();
	for (const t of txns) if (t.kind === kind) used.set(t.category, (used.get(t.category) ?? 0) + 1);
	const custom = [...used.entries()]
		.filter(([c]) => c && !CATEGORIES[kind].includes(c))
		.sort((a, b) => b[1] - a[1])
		.map(([c]) => c);
	return [...CATEGORIES[kind], ...custom];
}

/** Current balance per account id: starting balance + everything in − everything out. */
export function balances(accounts: Account[], txns: Transaction[]): Map<string, number> {
	const map = new Map(accounts.map((a) => [a.id, a.startingBalance]));
	for (const t of txns) {
		if (t.from !== null && map.has(t.from)) map.set(t.from, map.get(t.from)! - t.amount);
		if (t.to !== null && map.has(t.to)) map.set(t.to, map.get(t.to)! + t.amount);
	}
	return map;
}

/** Money into and out of each account during one month (transfers count on both sides). */
export function accountMonthFlow(
	txns: Transaction[],
	month: string
): Map<string, { in: number; out: number }> {
	const map = new Map<string, { in: number; out: number }>();
	const get = (id: string) => {
		let f = map.get(id);
		if (!f) map.set(id, (f = { in: 0, out: 0 }));
		return f;
	};
	for (const t of txns) {
		if (monthOf(t.date) !== month) continue;
		if (t.from !== null) get(t.from).out += t.amount;
		if (t.to !== null) get(t.to).in += t.amount;
	}
	return map;
}

/**
 * Net debt per person handle: lends minus borrows. Positive → they owe you,
 * negative → you owe them; settled (zero) people are dropped.
 */
export function personBalances(txns: Transaction[]): Map<string, number> {
	const map = new Map<string, number>();
	for (const [handle, s] of personStats(txns)) if (s.net !== 0) map.set(handle, s.net);
	return map;
}

export interface PersonStats {
	lent: number;
	borrowed: number;
	/** lent − borrowed: positive → they owe you. */
	net: number;
	count: number;
	/** Day key of the most recent lend/borrow. */
	last: string;
}

/** Lend/borrow totals for everyone you've ever lent to or borrowed from — settled people included. */
export function personStats(txns: Transaction[]): Map<string, PersonStats> {
	const map = new Map<string, PersonStats>();
	for (const t of txns) {
		if (t.person === null || (t.kind !== 'lend' && t.kind !== 'borrow')) continue;
		let s = map.get(t.person);
		if (!s) map.set(t.person, (s = { lent: 0, borrowed: 0, net: 0, count: 0, last: '' }));
		if (t.kind === 'lend') s.lent += t.amount;
		else s.borrowed += t.amount;
		s.net = roundCents(s.lent - s.borrowed);
		s.count += 1;
		if (t.date > s.last) s.last = t.date;
	}
	return map;
}

/** One person's lends and borrows, oldest first, each with the net balance right after it. */
export function personHistory(
	txns: Transaction[],
	handle: string
): { txn: Transaction; balance: number }[] {
	let balance = 0;
	return txns
		.filter((t) => t.person === handle && (t.kind === 'lend' || t.kind === 'borrow'))
		.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
		.map((txn) => {
			balance = roundCents(balance + (txn.kind === 'lend' ? txn.amount : -txn.amount));
			return { txn, balance };
		});
}

/** Avoids 0.1 + 0.2 style drift leaving people "owing" 0.0000001. */
const roundCents = (n: number) => Math.round(n * 100) / 100;

export interface MonthSummary {
	/** `YYYY-MM` */
	month: string;
	income: number;
	expense: number;
	/** income − expense */
	net: number;
	/** Portion of `expense` marked fixed (recurring bills). */
	fixed: number;
	lent: number;
	borrowed: number;
	transfers: number;
	/** Number of transactions of any kind. */
	count: number;
	/** net / income, or null without income. */
	savingsRate: number | null;
}

const emptySummary = (month: string): MonthSummary => ({
	month,
	income: 0,
	expense: 0,
	net: 0,
	fixed: 0,
	lent: 0,
	borrowed: 0,
	transfers: 0,
	count: 0,
	savingsRate: null
});

/**
 * Per-month totals, newest first. Only income and expense feed `net` —
 * transfers move money between your own accounts and lends/borrows are owed
 * back — but those are totalled too so a month can be described in full.
 */
export function monthlySummaries(txns: Transaction[]): MonthSummary[] {
	const map = new Map<string, MonthSummary>();
	for (const t of txns) {
		const month = monthOf(t.date);
		let s = map.get(month);
		if (!s) map.set(month, (s = emptySummary(month)));
		s.count += 1;
		if (t.kind === 'income') s.income += t.amount;
		else if (t.kind === 'expense') {
			s.expense += t.amount;
			if (t.fixed) s.fixed += t.amount;
		} else if (t.kind === 'lend') s.lent += t.amount;
		else if (t.kind === 'borrow') s.borrowed += t.amount;
		else s.transfers += t.amount;
	}
	for (const s of map.values()) {
		s.net = roundCents(s.income - s.expense);
		s.savingsRate = s.income > 0 ? s.net / s.income : null;
	}
	return [...map.values()].sort((a, b) => b.month.localeCompare(a.month));
}

/** Summaries for exactly these months (oldest first), zero-filled where nothing happened. */
export function summariesFor(summaries: MonthSummary[], months: string[]): MonthSummary[] {
	const byMonth = new Map(summaries.map((s) => [s.month, s]));
	return months.map((m) => byMonth.get(m) ?? emptySummary(m));
}

const MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
const SHORT_MONTH_LABEL = new Intl.DateTimeFormat('en-US', { month: 'short', year: '2-digit' });

export function monthLabel(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return MONTH_LABEL.format(new Date(y, m - 1, 1));
}

/** "Jul '26" — compact axis label. */
export function shortMonthLabel(month: string): string {
	const [y, m] = month.split('-').map(Number);
	return SHORT_MONTH_LABEL.format(new Date(y, m - 1, 1)).replace(' ', " '");
}

export interface CategoryTotal {
	category: string;
	amount: number;
	count: number;
}

/** Totals per category for one kind, optionally scoped to a month (`YYYY-MM`), highest first. */
export function categoryTotals(
	txns: Transaction[],
	kind: TransactionKind,
	month?: string
): CategoryTotal[] {
	const map = new Map<string, CategoryTotal>();
	for (const t of txns) {
		if (t.kind !== kind) continue;
		if (month && monthOf(t.date) !== month) continue;
		let c = map.get(t.category);
		if (!c) map.set(t.category, (c = { category: t.category, amount: 0, count: 0 }));
		c.amount += t.amount;
		c.count += 1;
	}
	return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/** Per-month totals of the matching transactions for the given months (oldest first). */
export function monthlyTotals(
	txns: Transaction[],
	months: string[],
	match: (t: Transaction) => boolean
): { month: string; amount: number; count: number }[] {
	const map = new Map(months.map((m) => [m, { month: m, amount: 0, count: 0 }]));
	for (const t of txns) {
		const row = map.get(monthOf(t.date));
		if (!row || !match(t)) continue;
		row.amount += t.amount;
		row.count += 1;
	}
	return [...map.values()];
}

export interface CategoryTrend {
	/** The top categories across the range, biggest first; everything else folds into "other". */
	categories: string[];
	rows: { month: string; values: Record<string, number>; total: number }[];
}

/** Monthly totals of one kind split by its top `topN` categories — the stacked trend chart. */
export function categoryTrend(
	txns: Transaction[],
	kind: TransactionKind,
	months: string[],
	topN = 5
): CategoryTrend {
	const inRange = new Set(months);
	const scoped = txns.filter((t) => t.kind === kind && inRange.has(monthOf(t.date)));
	const ranked = categoryTotals(scoped, kind).map((c) => c.category);
	const top = ranked.slice(0, topN);
	const folded = ranked.length > topN;
	const categories = folded ? [...top, OTHER] : top;
	const rows = months.map((month) => ({
		month,
		values: Object.fromEntries(categories.map((c) => [c, 0])) as Record<string, number>,
		total: 0
	}));
	const byMonth = new Map(rows.map((r) => [r.month, r]));
	for (const t of scoped) {
		const row = byMonth.get(monthOf(t.date))!;
		const key = top.includes(t.category) ? t.category : OTHER;
		row.values[key] += t.amount;
		row.total += t.amount;
	}
	return { categories, rows };
}

/** Bucket name for categories folded out of the trend chart. */
export const OTHER = '…other';

/**
 * Running total of spending through each day of a month: index 0 is day 1.
 * Days after `upToDay` (e.g. the rest of the current month) are null so a
 * line chart stops at today.
 */
export function cumulativeSpending(
	txns: Transaction[],
	month: string,
	upToDay = daysInMonth(month)
): (number | null)[] {
	const daily = new Array<number>(daysInMonth(month)).fill(0);
	for (const t of txns) {
		if (t.kind !== 'expense' || monthOf(t.date) !== month) continue;
		daily[Number(t.date.slice(8, 10)) - 1] += t.amount;
	}
	let sum = 0;
	return daily.map((v, i) => (i < upToDay ? (sum += v) : null));
}

/** Fixed (recurring) vs variable expense total for one month. */
export function fixedVsVariable(
	txns: Transaction[],
	month: string
): { fixed: number; variable: number } {
	let fixed = 0;
	let variable = 0;
	for (const t of txns) {
		if (t.kind !== 'expense' || monthOf(t.date) !== month) continue;
		if (t.fixed) fixed += t.amount;
		else variable += t.amount;
	}
	return { fixed, variable };
}

/** Transactions bucketed by month then day, newest first; input is assumed newest-first already. */
export function groupByMonth(
	txns: Transaction[]
): { month: string; days: { date: string; txns: Transaction[] }[]; count: number }[] {
	const groups: { month: string; days: { date: string; txns: Transaction[] }[]; count: number }[] =
		[];
	for (const t of txns) {
		const month = monthOf(t.date);
		let g = groups[groups.length - 1];
		if (g?.month !== month) groups.push((g = { month, days: [], count: 0 }));
		const d = g.days[g.days.length - 1];
		if (d?.date === t.date) d.txns.push(t);
		else g.days.push({ date: t.date, txns: [t] });
		g.count += 1;
	}
	return groups;
}

/** Case-insensitive match against category, note, person (handle + name) and account names. */
export function matchesSearch(
	t: Transaction,
	query: string,
	accounts: Account[],
	people: Person[]
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	const fields = [t.category, t.note, t.kind, String(t.amount)];
	if (t.person) {
		fields.push(t.person, `@${t.person}`);
		const name = people.find((p) => p.handle === t.person)?.name;
		if (name) fields.push(name);
	}
	for (const id of [t.from, t.to])
		if (id) fields.push(accounts.find((a) => a.id === id)?.name ?? '');
	return fields.some((f) => f.toLowerCase().includes(q));
}

/** Spreadsheet-friendly CSV of transactions (amounts unsigned, kind in its own column). */
export function transactionsToCsv(txns: Transaction[], accounts: Account[]): string {
	const name = (id: string | null) =>
		id === null ? '' : (accounts.find((a) => a.id === id)?.name ?? '');
	const cell = (v: string | number) => {
		const s = String(v);
		return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const header = ['date', 'kind', 'category', 'amount', 'from', 'to', 'person', 'fixed', 'note'];
	const rows = txns.map((t) =>
		[
			t.date,
			t.kind,
			t.category,
			t.amount,
			name(t.from),
			name(t.to),
			t.person ?? '',
			t.fixed ? 'yes' : '',
			t.note
		]
			.map(cell)
			.join(',')
	);
	return [header.join(','), ...rows].join('\r\n');
}

/**
 * Stable color per category, assigned by alphabetical position within the full
 * category set so a filter change never repaints the categories that remain.
 */
export function categoryColor(category: string, allCategories: string[]): string {
	if (category === OTHER) return 'var(--t-faint)';
	const sorted = [...new Set(allCategories)].sort();
	const idx = Math.max(0, sorted.indexOf(category));
	return `var(--t-cat-${(idx % 8) + 1})`;
}

// en-IN grouping matches the Bangladeshi lakh/crore convention (1,00,000).
const MONEY = {
	lakh: new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }),
	thousand: new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
} as const;

export function formatMoney(amount: number): string {
	const sign = amount < 0 ? '−' : '';
	return `${sign}${settings.currency}${MONEY[settings.grouping].format(Math.abs(amount))}`;
}

/** Compact axis label — "৳1.5L" with lakh grouping, "৳150k" with thousands. */
export function shortMoney(n: number): string {
	const sign = n < 0 ? '−' : '';
	const abs = Math.abs(n);
	const trim = (v: number) => String(Math.round(v * 10) / 10);
	const c = settings.currency;
	if (settings.grouping === 'lakh') {
		if (abs >= 1e7) return `${sign}${c}${trim(abs / 1e7)}Cr`;
		if (abs >= 1e5) return `${sign}${c}${trim(abs / 1e5)}L`;
	} else {
		if (abs >= 1e9) return `${sign}${c}${trim(abs / 1e9)}B`;
		if (abs >= 1e6) return `${sign}${c}${trim(abs / 1e6)}M`;
	}
	if (abs >= 1e3) return `${sign}${c}${trim(abs / 1e3)}k`;
	return `${sign}${c}${trim(abs)}`;
}

/** "+৳500" / "−৳500" / "৳500" by whether cash moved into or out of the user's accounts. */
export function signedAmount(kind: TransactionKind, amount: number): string {
	if (kind === 'income' || kind === 'borrow') return `+${formatMoney(amount)}`;
	if (kind === 'expense' || kind === 'lend') return `−${formatMoney(amount)}`;
	return formatMoney(amount);
}

/** "+12%" / "−8%" change from `prev` to `cur`, or null when there's nothing to compare against. */
export function percentChange(cur: number, prev: number): number | null {
	if (prev === 0) return null;
	return (cur - prev) / prev;
}

export const PERCENT = new Intl.NumberFormat('en-US', {
	style: 'percent',
	maximumFractionDigits: 0
});
