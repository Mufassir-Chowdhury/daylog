<script lang="ts">
	import { resolve } from '$app/paths';
	import { fromKey } from '$lib/date';
	import type { Account, Person, Transaction, TransactionKind } from '$lib/db';
	import { formatMoney, groupByMonth, monthLabel, monthlySummaries } from '$lib/finance';
	import type { SvelteSet } from 'svelte/reactivity';
	import TransactionRow from './TransactionRow.svelte';

	let {
		txns,
		accounts,
		people = [],
		open,
		suggest,
		groups: groupNames,
		onupdate,
		ondelete,
		onduplicate,
		oncategory,
		ongroup
	}: {
		/** Newest first. */
		txns: Transaction[];
		accounts: Account[];
		people?: Person[];
		/** Expanded month keys — owned by the parent so charts can open a month. */
		open: SvelteSet<string>;
		suggest?: (kind: TransactionKind) => string[];
		/** Group labels to suggest when editing a row. */
		groups?: string[];
		onupdate: (txn: Transaction) => void;
		ondelete: (txn: Transaction) => void;
		onduplicate?: (txn: Transaction) => void;
		oncategory?: (category: string, kind: TransactionKind) => void;
		ongroup?: (group: string) => void;
	} = $props();

	const groups = $derived(
		groupByMonth(txns).map((g) => ({
			...g,
			summary: monthlySummaries(g.days.flatMap((d) => d.txns))[0]
		}))
	);

	const DAY = new Intl.DateTimeFormat('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric'
	});

	function dayTotals(list: Transaction[]) {
		let spent = 0;
		let earned = 0;
		for (const t of list) {
			if (t.kind === 'expense') spent += t.amount;
			else if (t.kind === 'income') earned += t.amount;
		}
		return { spent, earned };
	}

	function toggle(month: string) {
		if (open.has(month)) open.delete(month);
		else open.add(month);
	}
</script>

<div class="space-y-2">
	{#each groups as g (g.month)}
		{@const isOpen = open.has(g.month)}
		{@const s = g.summary}
		<section
			id="month-{g.month}"
			class="scroll-mt-20 overflow-hidden rounded-card border border-line bg-card shadow-card"
		>
			<h3>
				<button
					type="button"
					onclick={() => toggle(g.month)}
					aria-expanded={isOpen}
					class="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-tint"
				>
					<span
						class="inline-block w-3 text-xs text-faint transition-transform {isOpen
							? 'rotate-90'
							: ''}"
						aria-hidden="true">▸</span
					>
					<span class="font-display text-sm font-semibold text-ink">{monthLabel(g.month)}</span>
					<span class="text-xs text-faint">{g.count} transaction{g.count === 1 ? '' : 's'}</span>
					<span class="ml-auto flex flex-wrap gap-x-3 text-xs text-mute tabular-nums">
						{#if s.income > 0}
							<span class="text-green-700 dark:text-green-400">+{formatMoney(s.income)}</span>
						{/if}
						{#if s.expense > 0}
							<span class="text-red-600 dark:text-red-400">−{formatMoney(s.expense)}</span>
						{/if}
						{#if s.lent > 0}
							<span class="hidden text-amber-600 sm:inline dark:text-amber-400">
								lent {formatMoney(s.lent)}
							</span>
						{/if}
						{#if s.borrowed > 0}
							<span class="hidden text-violet-600 sm:inline dark:text-violet-400">
								borrowed {formatMoney(s.borrowed)}
							</span>
						{/if}
						{#if s.income > 0 && s.expense > 0}
							<span>net <span class="font-medium text-ink">{formatMoney(s.net)}</span></span>
						{/if}
					</span>
				</button>
			</h3>
			{#if isOpen}
				<!-- Rows only exist while the month is expanded — collapsed months cost nothing to render. -->
				<div class="space-y-3 border-t border-line px-4 py-3">
					{#each g.days as day (day.date)}
						{@const t = dayTotals(day.txns)}
						<div>
							<p class="mb-0.5 flex items-baseline gap-2 text-xs">
								<a
									href={resolve('/day/[date]', { date: day.date })}
									class="font-medium text-mute hover:text-accent hover:underline"
								>
									{DAY.format(fromKey(day.date))}
								</a>
								{#if day.txns.length > 1}
									<span class="ml-auto text-faint tabular-nums">
										{#if t.earned > 0}+{formatMoney(t.earned)}{/if}
										{#if t.earned > 0 && t.spent > 0}·{/if}
										{#if t.spent > 0}−{formatMoney(t.spent)}{/if}
									</span>
								{/if}
							</p>
							<div class="space-y-0.5 border-l-2 border-line pl-3">
								{#each day.txns as txn (txn.id)}
									<TransactionRow
										{txn}
										{accounts}
										{people}
										{suggest}
										groups={groupNames}
										{onupdate}
										{ondelete}
										{onduplicate}
										{oncategory}
										{ongroup}
									/>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/each}
</div>
