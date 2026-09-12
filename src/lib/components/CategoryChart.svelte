<script lang="ts">
	import { dateKey } from '$lib/date';
	import type { Transaction, TransactionKind } from '$lib/db';
	import { categoryColor, categoryTotals, formatMoney, monthLabel } from '$lib/finance';

	let { txns, kind = 'expense' }: { txns: Transaction[]; kind?: TransactionKind } = $props();

	let scope: 'month' | 'all' = $state('month');
	const thisMonth = dateKey().slice(0, 7);

	const totals = $derived(categoryTotals(txns, kind, scope === 'month' ? thisMonth : undefined));
	const allCategories = $derived([
		...new Set(txns.filter((t) => t.kind === kind).map((t) => t.category))
	]);
	const max = $derived(Math.max(1, ...totals.map((c) => c.amount)));
	const sum = $derived(totals.reduce((s, c) => s + c.amount, 0));
</script>

<div class="mb-3 flex items-center justify-between gap-2">
	<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">
		{kind === 'expense' ? 'Spending' : 'Income'} by category
	</h2>
	<div class="flex shrink-0 overflow-hidden rounded-ctl border border-line text-xs">
		<button
			type="button"
			onclick={() => (scope = 'month')}
			class="px-2 py-1 {scope === 'month'
				? 'bg-accent-fill text-on-accent'
				: 'bg-card text-mute hover:bg-tint'}"
		>
			{monthLabel(thisMonth)}
		</button>
		<button
			type="button"
			onclick={() => (scope = 'all')}
			class="border-l border-line px-2 py-1 {scope === 'all'
				? 'bg-accent-fill text-on-accent'
				: 'bg-card text-mute hover:bg-tint'}"
		>
			All time
		</button>
	</div>
</div>

{#if totals.length === 0}
	<p class="py-6 text-center text-sm text-faint">Nothing here yet.</p>
{:else}
	<div class="space-y-2">
		{#each totals as c (c.category)}
			<div class="flex items-center gap-2 text-sm">
				<span class="w-20 shrink-0 truncate text-mute" title={c.category}>{c.category}</span>
				<div class="h-2 flex-1 overflow-hidden rounded-full bg-tint">
					<div
						class="h-full rounded-full"
						style="width:{(c.amount / max) * 100}%; background:{categoryColor(
							c.category,
							allCategories
						)}"
					></div>
				</div>
				<span class="w-20 shrink-0 text-right text-ink tabular-nums">{formatMoney(c.amount)}</span>
				<span class="w-9 shrink-0 text-right text-xs text-faint tabular-nums">
					{sum > 0 ? Math.round((c.amount / sum) * 100) : 0}%
				</span>
			</div>
		{/each}
	</div>
{/if}
