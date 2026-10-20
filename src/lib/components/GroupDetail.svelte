<script lang="ts">
	import { addDays, fromKey, monthOf } from '$lib/date';
	import type { Account, Person, Transaction, TransactionKind } from '$lib/db';
	import {
		categoryColor,
		categoryTotals,
		formatMoney,
		groupSummaries,
		rangeLabel,
		signedAmount
	} from '$lib/finance';
	import { SvelteSet } from 'svelte/reactivity';
	import TransactionMonthGroups from './TransactionMonthGroups.svelte';

	let {
		group,
		txns,
		accounts,
		people = [],
		suggest,
		groups,
		onupdate,
		ondelete,
		onduplicate,
		oncategory,
		onrename,
		onfilter
	}: {
		group: string;
		/** Every transaction (newest first) — this component picks out the group's. */
		txns: Transaction[];
		accounts: Account[];
		people?: Person[];
		suggest?: (kind: TransactionKind) => string[];
		groups?: string[];
		onupdate: (txn: Transaction) => void;
		ondelete: (txn: Transaction) => void;
		onduplicate?: (txn: Transaction) => void;
		oncategory?: (category: string, kind: TransactionKind) => void;
		/** Relabel every transaction in the group; an empty name ungroups them. */
		onrename: (name: string) => void;
		/** Apply this group as the page's list filter. */
		onfilter?: () => void;
	} = $props();

	const mine = $derived(txns.filter((t) => t.group === group));
	const summary = $derived(groupSummaries(mine)[0]);
	const byCategory = $derived(categoryTotals(mine, 'expense'));
	const maxCategory = $derived(Math.max(1, ...byCategory.map((c) => c.amount)));
	const allExpenseCategories = $derived(
		txns.filter((t) => t.kind === 'expense').map((t) => t.category)
	);
	const days = $derived(
		summary
			? Math.round((fromKey(summary.last).getTime() - fromKey(summary.first).getTime()) / 864e5) + 1
			: 0
	);

	/** Ungrouped transactions around the group's dates — one click backfills them into the group. */
	const nearby = $derived.by(() => {
		if (!summary) return [];
		const from = addDays(summary.first, -2);
		const to = addDays(summary.last, 2);
		return txns.filter((t) => !t.group && t.date >= from && t.date <= to);
	});

	// Groups are usually short, so every month starts expanded.
	// svelte-ignore state_referenced_locally
	const open = new SvelteSet<string>(mine.map((t) => monthOf(t.date)));

	let renaming = $state(false);
	let name = $state('');

	function startRename() {
		name = group;
		renaming = true;
	}

	function submitRename() {
		const trimmed = name.trim();
		renaming = false;
		if (trimmed && trimmed !== group) onrename(trimmed);
	}

	const SHORT_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
</script>

{#if !summary}
	<p class="text-sm text-faint">No transactions left in this group.</p>
{:else}
	<dl class="grid grid-cols-2 gap-2 sm:grid-cols-3">
		{#snippet stat(label: string, value: string, sub = '')}
			<div class="rounded-card border border-line bg-card px-3 py-2 shadow-card">
				<dt class="text-[11px] text-faint">{label}</dt>
				<dd class="text-base font-semibold text-ink">{value}</dd>
				{#if sub}<dd class="text-[11px] text-faint">{sub}</dd>{/if}
			</div>
		{/snippet}
		{@render stat(
			'Spent',
			formatMoney(summary.spent),
			summary.earned > 0 ? `net ${formatMoney(summary.spent - summary.earned)} after income` : ''
		)}
		{@render stat(
			'Dates',
			rangeLabel(summary.first, summary.last),
			`${days} day${days === 1 ? '' : 's'}`
		)}
		{@render stat(
			'Transactions',
			String(summary.count),
			days > 1 ? `${formatMoney(Math.round(summary.spent / days))} a day` : ''
		)}
		{#if summary.earned > 0}
			{@render stat('Income', formatMoney(summary.earned), 'refunds, reimbursements…')}
		{/if}
		{#if summary.lent > 0}
			{@render stat('Lent', formatMoney(summary.lent))}
		{/if}
		{#if summary.borrowed > 0}
			{@render stat('Borrowed', formatMoney(summary.borrowed))}
		{/if}
	</dl>

	{#if byCategory.length > 0}
		<section class="mt-4 rounded-card border border-line bg-card p-4 shadow-card">
			<h3 class="mb-2 text-xs font-semibold tracking-wide text-mute uppercase">
				Spending by category
			</h3>
			<ul class="space-y-0.5">
				{#each byCategory as c (c.category)}
					{@const color = categoryColor(c.category, allExpenseCategories)}
					<li>
						<button
							type="button"
							onclick={() => oncategory?.(c.category, 'expense')}
							disabled={!oncategory}
							class="grid w-full grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-x-3 rounded-ctl px-1.5 py-1 text-left text-sm enabled:hover:bg-tint"
						>
							<span class="flex min-w-0 items-center gap-1.5">
								<span class="h-2.5 w-2.5 shrink-0 rounded-sm" style:background={color}></span>
								<span class="truncate text-ink">{c.category}</span>
							</span>
							<span class="h-2 overflow-hidden rounded-full bg-tint">
								<span
									class="block h-full rounded-full"
									style:width="{(c.amount / maxCategory) * 100}%"
									style:background={color}
								></span>
							</span>
							<span class="text-right font-medium text-ink tabular-nums">
								{formatMoney(c.amount)}
								<span class="text-[10px] font-normal text-faint">{c.count}×</span>
							</span>
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
{/if}

<div class="mt-5 mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
	<h3 class="text-xs font-semibold tracking-wide text-mute uppercase">Transactions</h3>
	{#if summary}
		<span class="ml-auto flex gap-3 text-xs">
			<button type="button" onclick={startRename} class="text-accent hover:underline">
				rename…
			</button>
			<button type="button" onclick={() => onrename('')} class="text-accent hover:underline">
				ungroup all
			</button>
			{#if onfilter}
				<button type="button" onclick={onfilter} class="text-accent hover:underline">
					filter the page by it →
				</button>
			{/if}
		</span>
	{/if}
</div>
{#if renaming}
	<form
		class="mb-3 flex flex-wrap items-end gap-2 rounded-ctl bg-tint p-2"
		onsubmit={(e) => {
			e.preventDefault();
			submitRename();
		}}
	>
		<label class="flex min-w-48 flex-1 flex-col gap-0.5 text-xs text-mute">
			New name for all {summary?.count} transactions
			<input
				type="text"
				bind:value={name}
				onkeydown={(e) => e.key === 'Escape' && (renaming = false)}
				class="rounded-ctl border-line bg-card py-1 text-sm text-ink"
			/>
		</label>
		<button
			type="submit"
			class="rounded-ctl bg-accent-fill px-2 py-1 text-xs font-medium text-on-accent hover:opacity-90"
		>
			Save
		</button>
		<button
			type="button"
			onclick={() => (renaming = false)}
			class="rounded-ctl px-2 py-1 text-xs text-mute hover:bg-card"
		>
			cancel
		</button>
	</form>
{/if}
{#if mine.length > 0}
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
		{oncategory}
	/>
{/if}

{#if nearby.length > 0}
	<section class="mt-6">
		<h3 class="text-xs font-semibold tracking-wide text-mute uppercase">Around the same dates</h3>
		<p class="mb-2 text-xs text-faint">
			Ungrouped transactions within two days — add any that belong.
		</p>
		<ul class="divide-y divide-line rounded-card border border-line bg-card px-3 shadow-card">
			{#each nearby as t (t.id)}
				<li class="flex items-center gap-2 py-1.5 text-sm">
					<span class="w-12 shrink-0 text-xs text-faint tabular-nums">
						{SHORT_DAY.format(fromKey(t.date))}
					</span>
					<span class="shrink-0 text-ink">{t.category}</span>
					{#if t.note}<span class="min-w-0 truncate text-faint">· {t.note}</span>{/if}
					<span class="ml-auto shrink-0 text-mute tabular-nums">
						{signedAmount(t.kind, t.amount)}
					</span>
					<button
						type="button"
						onclick={() => onupdate({ ...t, group })}
						class="shrink-0 rounded-ctl border border-line px-2 py-0.5 text-xs text-accent hover:bg-tint"
					>
						+ add
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}
