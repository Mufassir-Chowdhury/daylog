<script lang="ts">
	import { dateKey, monthOf, shiftMonth } from '$lib/date';
	import type { Transaction } from '$lib/db';
	import {
		categoryColor,
		categoryTotals,
		formatMoney,
		monthLabel,
		PERCENT,
		percentChange
	} from '$lib/finance';

	type Kind = 'expense' | 'income';

	let {
		txns,
		selected = null,
		onselect
	}: {
		txns: Transaction[];
		/** Category currently drilled into — its row is highlighted. */
		selected?: string | null;
		onselect?: (category: string, kind: Kind) => void;
	} = $props();

	const thisMonth = monthOf(dateKey());

	let tab = $state<Kind | 'both'>('expense');
	/** A month key, or 'all'. */
	let period = $state(thisMonth);

	/** Months that have income/expense, newest first — the period picker's options. */
	const monthsWithData = $derived(
		[
			...new Set(
				txns.filter((t) => t.kind === 'expense' || t.kind === 'income').map((t) => monthOf(t.date))
			)
		]
			.filter((m) => m !== thisMonth && m !== shiftMonth(thisMonth, -1))
			.sort()
			.reverse()
	);

	const month = $derived(period === 'all' ? undefined : period);
	const prevMonth = $derived(month ? shiftMonth(month, -1) : undefined);
	// A month in progress is compared with the same days of the previous month, not all of it.
	const today = dateKey();
	const cutoffDay = $derived(month === thisMonth ? Number(today.slice(8, 10)) : 31);
	const prevTxns = $derived(
		cutoffDay < 31 ? txns.filter((t) => Number(t.date.slice(8, 10)) <= cutoffDay) : txns
	);
	const prevLabel = $derived(
		prevMonth ? `${monthLabel(prevMonth)}${cutoffDay < 31 ? ` 1–${cutoffDay}` : ''}` : ''
	);

	function section(kind: Kind) {
		const totals = categoryTotals(txns, kind, month);
		const prev = prevMonth
			? new Map(categoryTotals(prevTxns, kind, prevMonth).map((c) => [c.category, c.amount]))
			: null;
		const all = [...new Set(txns.filter((t) => t.kind === kind).map((t) => t.category))];
		const sum = totals.reduce((s, c) => s + c.amount, 0);
		const prevSum = prev ? [...prev.values()].reduce((s, v) => s + v, 0) : 0;
		return {
			kind,
			sum,
			change: prev ? percentChange(sum, prevSum) : null,
			max: Math.max(1, ...totals.map((c) => c.amount)),
			rows: totals.map((c) => ({
				...c,
				share: sum > 0 ? c.amount / sum : 0,
				change: prev ? percentChange(c.amount, prev.get(c.category) ?? 0) : null,
				isNew: prev !== null && !prev.has(c.category),
				color: categoryColor(c.category, all)
			}))
		};
	}

	const sections = $derived(
		tab === 'both' ? [section('income'), section('expense')] : [section(tab)]
	);

	const TABS: { value: Kind | 'both'; label: string }[] = [
		{ value: 'expense', label: 'Spending' },
		{ value: 'income', label: 'Income' },
		{ value: 'both', label: 'Both' }
	];
</script>

<div class="mb-3 flex flex-wrap items-center gap-2">
	<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">By category</h2>
	<div class="ml-auto flex flex-wrap items-center gap-2">
		<select
			bind:value={period}
			aria-label="Period"
			class="rounded-ctl border-line bg-card py-1 pr-7 text-xs text-ink"
		>
			<option value={thisMonth}>This month</option>
			<option value={shiftMonth(thisMonth, -1)}>Last month</option>
			{#each monthsWithData as m (m)}
				<option value={m}>{monthLabel(m)}</option>
			{/each}
			<option value="all">All time</option>
		</select>
		<div class="flex overflow-hidden rounded-ctl border border-line text-xs">
			{#each TABS as t (t.value)}
				<button
					type="button"
					onclick={() => (tab = t.value)}
					aria-pressed={tab === t.value}
					class="border-r border-line px-2 py-1 last:border-r-0 {tab === t.value
						? 'bg-accent-fill text-on-accent'
						: 'bg-card text-mute hover:bg-tint'}"
				>
					{t.label}
				</button>
			{/each}
		</div>
	</div>
</div>

{#snippet delta(change: number | null, isNew: boolean, upIsGood: boolean)}
	{#if isNew}
		<span class="text-[10px] text-faint">new</span>
	{:else if change !== null && Math.abs(change) >= 0.005}
		{@const good = change > 0 === upIsGood}
		<span
			class="text-[10px] tabular-nums {good
				? 'text-green-700 dark:text-green-400'
				: 'text-red-600 dark:text-red-400'}"
			title="vs {prevLabel}"
		>
			{change > 0 ? '▲' : '▼'}{PERCENT.format(Math.abs(change))}
		</span>
	{/if}
{/snippet}

<div class="space-y-5">
	{#each sections as s (s.kind)}
		<div>
			<p class="mb-2 flex items-baseline gap-2 text-sm">
				<span class="font-medium text-ink">
					{s.kind === 'income' ? 'Income' : 'Spending'}
				</span>
				<span class="font-semibold text-ink tabular-nums">{formatMoney(s.sum)}</span>
				{@render delta(s.change, false, s.kind === 'income')}
				<span class="ml-auto text-xs text-faint">
					{month ? monthLabel(month) : 'all time'}
				</span>
			</p>
			{#if s.rows.length === 0}
				<p class="rounded-ctl bg-tint py-5 text-center text-sm text-faint">
					No {s.kind === 'income' ? 'income' : 'spending'}
					{month ? `in ${monthLabel(month)}` : 'yet'}.
				</p>
			{:else}
				<ul class="space-y-0.5">
					{#each s.rows as c (c.category)}
						<li>
							<button
								type="button"
								onclick={() => onselect?.(c.category, s.kind)}
								class="grid w-full grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-x-3 rounded-ctl px-1.5 py-1 text-left text-sm hover:bg-tint sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto_3.5rem] {selected ===
								c.category
									? 'bg-tint ring-1 ring-accent/40'
									: ''}"
								title="Show {c.category} transactions"
							>
								<span class="flex min-w-0 items-center gap-1.5">
									<span class="h-2.5 w-2.5 shrink-0 rounded-sm" style:background={c.color}></span>
									<span class="truncate text-ink">{c.category}</span>
								</span>
								<span class="flex min-w-0 items-center gap-2">
									<span class="h-2 flex-1 overflow-hidden rounded-full bg-tint">
										<span
											class="block h-full rounded-full"
											style:width="{(c.amount / s.max) * 100}%"
											style:background={c.color}
										></span>
									</span>
									<span class="w-8 shrink-0 text-right text-xs text-faint tabular-nums">
										{PERCENT.format(c.share)}
									</span>
								</span>
								<span class="text-right">
									<span class="block font-medium text-ink tabular-nums">
										{formatMoney(c.amount)}
									</span>
									<span class="block text-[10px] text-faint tabular-nums sm:hidden">
										{c.count}× {@render delta(c.change, c.isNew, s.kind === 'income')}
									</span>
								</span>
								<span class="hidden text-right leading-tight sm:block">
									<span class="block text-[10px] text-faint tabular-nums">{c.count}×</span>
									{@render delta(c.change, c.isNew, s.kind === 'income')}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/each}
</div>
<p class="mt-3 text-[11px] text-faint">
	Click a category to see its transactions and monthly history.
	{#if month}▲▼ compare with {prevLabel}.{/if}
</p>
