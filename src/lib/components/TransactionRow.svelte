<script lang="ts">
	import { resolve } from '$app/paths';
	import { fromKey } from '$lib/date';
	import type { Account, Transaction, TransactionKind } from '$lib/db';
	import { CATEGORIES, signedAmount } from '$lib/finance';

	let {
		txn,
		accounts,
		showDay = false,
		onupdate,
		ondelete
	}: {
		txn: Transaction;
		accounts: Account[];
		showDay?: boolean;
		onupdate: (txn: Transaction) => void;
		ondelete: (txn: Transaction) => void;
	} = $props();

	const KIND_CHIP: Record<TransactionKind, string> = {
		expense: 'bg-red-500/10 text-red-700 dark:text-red-300',
		income: 'bg-green-500/10 text-green-700 dark:text-green-300',
		transfer: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
		lend: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
		borrow: 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
	};

	const AMOUNT_TEXT: Record<TransactionKind, string> = {
		expense: 'text-red-600 dark:text-red-400',
		income: 'text-green-700 dark:text-green-400',
		transfer: 'text-blue-600 dark:text-blue-400',
		lend: 'text-amber-600 dark:text-amber-400',
		borrow: 'text-violet-600 dark:text-violet-400'
	};

	const DAY_LABEL = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

	const accountName = (id: string | null) =>
		id === null ? '' : (accounts.find((a) => a.id === id)?.name ?? '(deleted account)');

	const needsFrom = $derived(txn.kind !== 'income' && txn.kind !== 'borrow');
	const needsTo = $derived(txn.kind !== 'expense' && txn.kind !== 'lend');
	const hasCategory = $derived(txn.kind === 'expense' || txn.kind === 'income');
	const dayHref = $derived(resolve('/day/[date]', { date: txn.date }));

	let editing = $state(false);
	let category = $state('');
	let from = $state('');
	let to = $state('');
	let fixed = $state(false);

	function startEdit() {
		category = txn.category;
		from = txn.from ?? '';
		to = txn.to ?? '';
		fixed = txn.fixed;
		editing = true;
	}

	function save() {
		onupdate({
			...txn,
			category: hasCategory ? category.trim() || 'other' : txn.category,
			from: needsFrom ? from || null : txn.from,
			to: needsTo ? to || null : txn.to,
			fixed
		});
		editing = false;
	}
</script>

{#if editing}
	<form
		class="mb-1 flex flex-wrap items-end gap-2 rounded-ctl bg-tint p-2 text-sm"
		onsubmit={(e) => {
			e.preventDefault();
			save();
		}}
	>
		{#if hasCategory}
			<label class="flex flex-col gap-0.5 text-xs text-mute">
				Category
				<input
					type="text"
					bind:value={category}
					list="txn-categories-{txn.id}"
					class="w-32 rounded-ctl border-line bg-card py-1 text-sm text-ink"
				/>
				<datalist id="txn-categories-{txn.id}">
					{#each CATEGORIES[txn.kind] as c (c)}
						<option value={c}></option>
					{/each}
				</datalist>
			</label>
		{/if}
		{#if needsFrom}
			<label class="flex flex-col gap-0.5 text-xs text-mute">
				From
				<select bind:value={from} class="rounded-ctl border-line bg-card py-1 text-sm text-ink">
					{#each accounts as a (a.id)}
						<option value={a.id}>{a.name}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if needsTo}
			<label class="flex flex-col gap-0.5 text-xs text-mute">
				To
				<select bind:value={to} class="rounded-ctl border-line bg-card py-1 text-sm text-ink">
					{#each accounts as a (a.id)}
						<option value={a.id}>{a.name}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if txn.kind === 'expense'}
			<label class="flex items-center gap-1 pb-1.5 text-xs text-mute">
				<input type="checkbox" bind:checked={fixed} />
				fixed
			</label>
		{/if}
		<button
			type="submit"
			class="rounded-ctl bg-accent-fill px-2 py-1 text-xs font-medium text-on-accent hover:opacity-90"
		>
			Save
		</button>
		<button
			type="button"
			onclick={() => (editing = false)}
			class="rounded-ctl px-2 py-1 text-xs text-mute hover:bg-tint"
		>
			cancel
		</button>
	</form>
{:else}
	<p class="group flex items-center gap-2 text-sm leading-relaxed">
		{#if showDay}
			<a
				href={dayHref}
				class="w-12 shrink-0 text-xs text-faint tabular-nums hover:text-accent hover:underline"
			>
				{DAY_LABEL.format(fromKey(txn.date))}
			</a>
		{/if}
		<span class="rounded-full px-2 py-0.5 text-xs font-medium {KIND_CHIP[txn.kind]}">
			{txn.category}
		</span>
		{#if txn.fixed}
			<span class="rounded-full bg-tint px-1.5 py-0.5 text-[10px] text-faint">fixed</span>
		{/if}
		<span class="truncate text-mute">
			{#if txn.kind === 'transfer'}
				{accountName(txn.from)} → {accountName(txn.to)}
			{:else if txn.kind === 'lend'}
				{accountName(txn.from)} → @{txn.person}
			{:else if txn.kind === 'borrow'}
				@{txn.person} → {accountName(txn.to)}
			{:else}
				{accountName(txn.kind === 'expense' ? txn.from : txn.to)}
			{/if}
			{#if txn.note}
				<span class="text-faint">· {txn.note}</span>
			{/if}
		</span>
		<span class="ml-auto shrink-0 font-medium tabular-nums {AMOUNT_TEXT[txn.kind]}">
			{signedAmount(txn.kind, txn.amount)}
		</span>
		<span
			class="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
		>
			<button
				type="button"
				onclick={startEdit}
				aria-label="Edit transaction"
				class="rounded px-1 text-xs text-faint hover:bg-tint hover:text-mute">✎</button
			>
			<button
				type="button"
				onclick={() => ondelete(txn)}
				aria-label="Delete transaction"
				class="rounded px-1 text-xs text-faint hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
				>×</button
			>
		</span>
	</p>
{/if}
