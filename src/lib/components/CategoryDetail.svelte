<script lang="ts">
	import { dateKey, fromKey, monthOf, monthsEnding, shiftMonth } from '$lib/date';
	import type { Account, Person, Transaction, TransactionKind } from '$lib/db';
	import { categoryColor, formatMoney, monthLabel, monthlyTotals } from '$lib/finance';
	import { SvelteSet } from 'svelte/reactivity';
	import MonthBars from './MonthBars.svelte';
	import TransactionMonthGroups from './TransactionMonthGroups.svelte';

	let {
		category,
		kind,
		txns,
		accounts,
		people = [],
		suggest,
		groups,
		onupdate,
		ondelete,
		onduplicate,
		ongroup,
		onfilter
	}: {
		category: string;
		kind: TransactionKind;
		/** Every transaction (newest first) — this component picks out the category's. */
		txns: Transaction[];
		accounts: Account[];
		people?: Person[];
		suggest?: (kind: TransactionKind) => string[];
		groups?: string[];
		onupdate: (txn: Transaction) => void;
		ondelete: (txn: Transaction) => void;
		onduplicate?: (txn: Transaction) => void;
		ongroup?: (group: string) => void;
		/** Apply this category as the page's list filter. */
		onfilter?: () => void;
	} = $props();

	const thisMonth = monthOf(dateKey());
	const LONG_DAY = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});

	const mine = $derived(txns.filter((t) => t.kind === kind && t.category === category));
	const color = $derived(
		categoryColor(category, [
			...new Set(txns.filter((t) => t.kind === kind).map((t) => t.category))
		])
	);
	const history = $derived(monthlyTotals(mine, monthsEnding(thisMonth, 12), () => true));

	const stats = $derived.by(() => {
		const total = mine.reduce((s, t) => s + t.amount, 0);
		const yearRows = history.filter((r) => r.amount > 0);
		const yearTotal = yearRows.reduce((s, r) => s + r.amount, 0);
		const largest = mine.reduce<Transaction | null>(
			(best, t) => (best === null || t.amount > best.amount ? t : best),
			null
		);
		const at = (m: string) => history.find((r) => r.month === m)?.amount ?? 0;
		return {
			total,
			count: mine.length,
			avgTxn: mine.length ? total / mine.length : 0,
			avgMonth: yearRows.length ? yearTotal / yearRows.length : 0,
			thisMonth: at(thisMonth),
			lastMonth: at(shiftMonth(thisMonth, -1)),
			largest,
			first: mine.length ? mine[mine.length - 1].date : null
		};
	});

	// The newest month with activity starts expanded.
	// svelte-ignore state_referenced_locally
	const open = new SvelteSet<string>(mine.length ? [monthOf(mine[0].date)] : []);
</script>

<dl class="grid grid-cols-2 gap-2 sm:grid-cols-3">
	{#snippet stat(label: string, value: string, sub = '')}
		<div class="rounded-card border border-line bg-card px-3 py-2 shadow-card">
			<dt class="text-[11px] text-faint">{label}</dt>
			<dd class="text-base font-semibold text-ink">{value}</dd>
			{#if sub}<dd class="text-[11px] text-faint">{sub}</dd>{/if}
		</div>
	{/snippet}
	{@render stat(
		'This month',
		formatMoney(stats.thisMonth),
		`last month ${formatMoney(stats.lastMonth)}`
	)}
	{@render stat(
		'Monthly average',
		formatMoney(Math.round(stats.avgMonth)),
		'active months, last 12'
	)}
	{@render stat(
		'All time',
		formatMoney(stats.total),
		stats.first ? `since ${monthLabel(monthOf(stats.first))}` : ''
	)}
	{@render stat(
		'Transactions',
		String(stats.count),
		`avg ${formatMoney(Math.round(stats.avgTxn))} each`
	)}
	{#if stats.largest}
		{@render stat(
			'Largest',
			formatMoney(stats.largest.amount),
			`${LONG_DAY.format(fromKey(stats.largest.date))}${stats.largest.note ? ` · ${stats.largest.note}` : ''}`
		)}
	{/if}
</dl>

<section class="mt-4 rounded-card border border-line bg-card p-4 shadow-card">
	<h3 class="mb-2 text-xs font-semibold tracking-wide text-mute uppercase">Last 12 months</h3>
	<MonthBars
		rows={history}
		{color}
		label="{category} {kind === 'income' ? 'income' : 'spending'}"
	/>
</section>

<div class="mt-5 mb-2 flex items-baseline">
	<h3 class="text-xs font-semibold tracking-wide text-mute uppercase">Transactions</h3>
	{#if onfilter}
		<button type="button" onclick={onfilter} class="ml-auto text-xs text-accent hover:underline">
			filter the page by “{category}” →
		</button>
	{/if}
</div>
{#if mine.length === 0}
	<p class="text-sm text-faint">No transactions left in this category.</p>
{:else}
	<TransactionMonthGroups
		txns={mine}
		{accounts}
		{people}
		{open}
		{suggest}
		{groups}
		{onupdate}
		{ondelete}
		{onduplicate}
		{ongroup}
	/>
{/if}
