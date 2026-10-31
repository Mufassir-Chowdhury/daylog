/**
 * Money watch: spending running well ahead of last month, an expense far
 * above its category's usual, and money between you and someone left open
 * for over a month. Pure; part of the 30-minute scan (engine.ts). Amounts are
 * plain numbers here — the run writes them with the currency from the facts.
 */
import { addDays, monthOf, shiftMonth } from '../../date';
import type { Transaction } from '../../db';
import { daysUntil } from '../../schedule';
import type { FactSource } from '../facts';
import type { Detector, Signal } from './index';

/** This far ahead of last month at the same day (a fifth) counts as running ahead. */
const PACE_AHEAD = 0.2;
/** …and only once this month's spending is at least this many times a typical day of last month. */
const PACE_MIN_DAYS = 3;
/** An expense this many times its category's median is unusual… */
const UNUSUAL_TIMES = 3;
/** …given at least this many earlier ones in the last 90 days to compare with. */
const UNUSUAL_HISTORY = 5;
/** Money between you open this long is worth a reminder, then again every as long. */
const DEBT_DAYS = 30;

const round = (n: number) => Math.round(n * 100) / 100;
const spending = (t: Transaction) => t.kind === 'expense';

const SUMMARY: FactSource = {
	label: 'Money this month',
	tool: 'finance_summary',
	input: { month: null }
};

/** This month's spending against last month up to the same day of the month. */
export const spendingPace: Detector = ({ today, transactions = [] }) => {
	const month = monthOf(today);
	const last = shiftMonth(month, -1);
	const day = today.slice(8);
	const sum = (from: string, to: string) =>
		transactions
			.filter((t) => spending(t) && !t.fixed && t.date >= from && t.date <= to)
			.reduce((s, t) => s + t.amount, 0);
	const now = sum(`${month}-01`, today);
	const before = sum(`${last}-01`, `${last}-${day}`);
	const typicalDay = sum(`${last}-01`, `${last}-31`) / 30;
	if (before <= 0 || now < typicalDay * PACE_MIN_DAYS) return [];
	const ratio = now / before - 1;
	if (ratio < PACE_AHEAD) return [];
	// Raised again only if it gets clearly worse: at 20%, 50%, 100%, 200% ahead.
	const band = [2, 1, 0.5, 0.2].find((b) => ratio >= b)!;
	return [
		{
			key: `money:pace:${month}:${band}`,
			type: 'money',
			title: 'Spending is running ahead',
			about:
				`Day-to-day spending this month is ${round(now)} so far, against ${round(before)} by the same day last month (${Math.round(ratio * 100)}% more; fixed bills left out). ` +
				'Say which categories drive it (from <facts>) in two or three sentences, with both totals. No cards unless something is clearly wrong.',
			priority: ratio >= 0.5 ? 2 : 1,
			facts: [SUMMARY]
		}
	];
};

function median(values: number[]): number {
	const sorted = values.slice().sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** An expense in the last two days far above what that category usually costs. */
export const unusualExpense: Detector = ({ today, transactions = [] }) => {
	const out: Signal[] = [];
	const since = addDays(today, -90);
	for (const t of transactions) {
		if (!spending(t) || t.date < addDays(today, -1) || t.date > today) continue;
		const category = t.category.trim().toLowerCase();
		const earlier = transactions
			.filter(
				(o) =>
					o.id !== t.id &&
					spending(o) &&
					o.category.trim().toLowerCase() === category &&
					o.date >= since &&
					o.date <= today
			)
			.map((o) => o.amount);
		if (earlier.length < UNUSUAL_HISTORY) continue;
		const usual = median(earlier);
		if (usual <= 0 || t.amount < usual * UNUSUAL_TIMES) continue;
		out.push({
			key: `money:unusual:${t.id}`,
			type: 'money',
			title: `Unusual: ${t.category || 'expense'}`,
			about:
				`An expense of ${t.amount} for “${t.category}” on ${t.date}${t.note ? ` (${t.note})` : ''} (id ${t.id}) is ${Math.round(t.amount / usual)}× the usual ${round(usual)} for that category over the last 90 days. ` +
				'In one or two sentences, point it out in case it is a typo (an extra zero) or belongs to another category; propose update_transaction only if the note or the page makes the right amount clear.',
			priority: 1,
			facts: [
				{
					label: 'That day’s money',
					tool: 'find_transactions',
					input: { query: null, from: t.date, to: t.date, kind: null, person: null, limit: 30 }
				},
				{ label: 'That day’s page', tool: 'read_day', input: { date: t.date } }
			]
		});
	}
	return out;
};

/** Since when each person's balance with you has been open (not back to zero). */
export function openSince(
	transactions: Transaction[]
): Map<string, { net: number; since: string }> {
	const byPerson = new Map<string, Transaction[]>();
	for (const t of transactions) {
		if (t.person === null || (t.kind !== 'lend' && t.kind !== 'borrow')) continue;
		byPerson.set(t.person, [...(byPerson.get(t.person) ?? []), t]);
	}
	const out = new Map<string, { net: number; since: string }>();
	for (const [person, list] of byPerson) {
		let net = 0;
		let since = '';
		for (const t of list.sort(
			(a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt
		)) {
			const before = net;
			net = round(net + (t.kind === 'lend' ? t.amount : -t.amount));
			// Opened, or flipped to the other side: the clock starts again.
			if (before === 0 || Math.sign(before) !== Math.sign(net)) since = t.date;
		}
		if (net !== 0) out.set(person, { net, since });
	}
	return out;
}

/** Money between you and someone, open for over a month. */
export const openDebts: Detector = ({ today, transactions = [] }) => {
	const out: Signal[] = [];
	for (const [person, { net, since }] of openSince(transactions)) {
		const days = daysUntil(today, since);
		if (days < DEBT_DAYS) continue;
		const theyOwe = net > 0;
		out.push({
			// Once per 30 days open, and again if the amount changes.
			key: `money:debt:${person}:${since}:${Math.floor(days / DEBT_DAYS)}:${Math.abs(net)}`,
			type: 'money',
			title: theyOwe ? `@${person} still owes you` : `You still owe @${person}`,
			about:
				`${theyOwe ? `@${person} has owed you` : `You have owed @${person}`} ${Math.abs(net)} since ${since} (${days} days). ` +
				'Mention it in one or two sentences with the amount and since when, and the latest mention of them if it helps. No cards.',
			priority: 1,
			facts: [{ label: `About @${person}`, tool: 'get_person', input: { handle: person } }]
		});
	}
	return out;
};

export const MONEY_DETECTORS = [spendingPace, unusualExpense, openDebts];
