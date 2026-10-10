<script lang="ts">
	import { resolve } from '$app/paths';
	import { fromKey, isValidKey } from '$lib/date';
	import type { Account, Person, Transaction, TransactionKind } from '$lib/db';
	import { CATEGORIES, hasCategory as kindHasCategory, signedAmount } from '$lib/finance';

	let {
		txn,
		accounts,
		people = [],
		showDay = false,
		suggest = (kind) => CATEGORIES[kind],
		onupdate,
		ondelete,
		onduplicate,
		oncategory
	}: {
		txn: Transaction;
		accounts: Account[];
		/** Known people — offered when editing a lend/borrow. */
		people?: Person[];
		showDay?: boolean;
		/** Category suggestions per kind (presets + previously used). */
		suggest?: (kind: TransactionKind) => string[];
		onupdate: (txn: Transaction) => void;
		ondelete: (txn: Transaction) => void;
		/** Copy this transaction to today. Omitted → no duplicate button. */
		onduplicate?: (txn: Transaction) => void;
		/** Clicking the category chip drills into that category. Omitted → plain chip. */
		oncategory?: (category: string, kind: TransactionKind) => void;
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
	const needsPerson = $derived(txn.kind === 'lend' || txn.kind === 'borrow');
	const hasCategory = $derived(kindHasCategory(txn.kind));
	const chipClickable = $derived(oncategory !== undefined && hasCategory);

	let editing = $state(false);
	let date = $state('');
	let amount = $state('');
	let category = $state('');
	let from = $state('');
	let to = $state('');
	let person = $state('');
	let note = $state('');
	let fixed = $state(false);
	let invalid = $state('');

	function startEdit() {
		date = txn.date;
		amount = String(txn.amount);
		category = txn.category;
		from = txn.from ?? '';
		to = txn.to ?? '';
		person = txn.person ?? '';
		note = txn.note;
		fixed = txn.fixed;
		invalid = '';
		editing = true;
	}

	function save() {
		const value = Number(amount);
		if (!value || value <= 0) return (invalid = 'enter an amount above 0');
		if (!isValidKey(date)) return (invalid = 'pick a date');
		if (txn.kind === 'transfer' && from === to) return (invalid = 'pick two different accounts');
		onupdate({
			...txn,
			date,
			amount: value,
			category: hasCategory ? category.trim() || 'other' : txn.category,
			from: needsFrom ? from || null : txn.from,
			to: needsTo ? to || null : txn.to,
			person: needsPerson ? person || txn.person : txn.person,
			note: note.trim(),
			fixed: txn.kind === 'expense' ? fixed : false
		});
		editing = false;
	}

	const esc = (e: KeyboardEvent) => e.key === 'Escape' && (editing = false);

	const input = 'rounded-ctl border-line bg-card py-1 text-sm text-ink';
</script>

{#if editing}
	<form
		class="my-1 flex flex-wrap items-end gap-2 rounded-ctl bg-tint p-2 text-sm"
		onsubmit={(e) => {
			e.preventDefault();
			save();
		}}
	>
		<label class="flex flex-col gap-0.5 text-xs text-mute">
			Date
			<input onkeydown={esc} type="date" bind:value={date} class={input} />
		</label>
		<label class="flex flex-col gap-0.5 text-xs text-mute">
			Amount
			<input
				onkeydown={esc}
				type="number"
				min="0"
				step="any"
				bind:value={amount}
				class="w-28 {input}"
			/>
		</label>
		{#if hasCategory}
			<label class="flex flex-col gap-0.5 text-xs text-mute">
				Category
				<input
					onkeydown={esc}
					type="text"
					bind:value={category}
					list="txn-categories-{txn.id}"
					class="w-32 {input}"
				/>
				<datalist id="txn-categories-{txn.id}">
					{#each suggest(txn.kind) as c (c)}
						<option value={c}></option>
					{/each}
				</datalist>
			</label>
		{/if}
		{#if needsPerson}
			<label class="flex flex-col gap-0.5 text-xs text-mute">
				Person
				<select onkeydown={esc} bind:value={person} class={input}>
					{#if !people.some((p) => p.handle === person)}
						<option value={person}>@{person}</option>
					{/if}
					{#each people as p (p.handle)}
						<option value={p.handle}>@{p.handle}{p.name ? ` (${p.name})` : ''}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if needsFrom}
			<label class="flex flex-col gap-0.5 text-xs text-mute">
				From
				<select onkeydown={esc} bind:value={from} class={input}>
					{#each accounts as a (a.id)}
						<option value={a.id}>{a.name}</option>
					{/each}
				</select>
			</label>
		{/if}
		{#if needsTo}
			<label class="flex flex-col gap-0.5 text-xs text-mute">
				To
				<select onkeydown={esc} bind:value={to} class={input}>
					{#each accounts as a (a.id)}
						<option value={a.id}>{a.name}</option>
					{/each}
				</select>
			</label>
		{/if}
		<label class="flex min-w-32 flex-1 flex-col gap-0.5 text-xs text-mute">
			Note
			<input onkeydown={esc} type="text" bind:value={note} class={input} />
		</label>
		{#if txn.kind === 'expense'}
			<label class="flex items-center gap-1 pb-1.5 text-xs text-mute">
				<input onkeydown={esc} type="checkbox" bind:checked={fixed} />
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
			class="rounded-ctl px-2 py-1 text-xs text-mute hover:bg-card"
		>
			cancel
		</button>
		{#if invalid}
			<p class="w-full text-xs text-red-600 dark:text-red-400">{invalid}</p>
		{/if}
	</form>
{:else}
	<div class="group flex items-center gap-2 rounded-ctl py-0.5 text-sm leading-relaxed">
		{#if showDay}
			<a
				href={resolve('/day/[date]', { date: txn.date })}
				class="w-12 shrink-0 text-xs text-faint tabular-nums hover:text-accent hover:underline"
			>
				{DAY_LABEL.format(fromKey(txn.date))}
			</a>
		{/if}
		{#if chipClickable}
			<button
				type="button"
				onclick={() => oncategory?.(txn.category, txn.kind)}
				title="All {txn.category} transactions"
				class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium hover:ring-1 hover:ring-current {KIND_CHIP[
					txn.kind
				]}"
			>
				{txn.category}
			</button>
		{:else}
			<span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium {KIND_CHIP[txn.kind]}">
				{txn.category}
			</span>
		{/if}
		{#if txn.fixed}
			<span class="shrink-0 rounded-full bg-tint px-1.5 py-0.5 text-[10px] text-faint">fixed</span>
		{/if}
		<span class="min-w-0 truncate text-mute">
			{#snippet personLink(handle: string | null)}
				<a
					href={resolve('/people/[handle]', { handle: handle ?? '' })}
					class="text-accent hover:underline">@{handle}</a
				>
			{/snippet}
			{#if txn.kind === 'transfer'}
				{accountName(txn.from)} → {accountName(txn.to)}
			{:else if txn.kind === 'lend'}
				{accountName(txn.from)} → {@render personLink(txn.person)}
			{:else if txn.kind === 'borrow'}
				{@render personLink(txn.person)} → {accountName(txn.to)}
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
			class="reveal flex shrink-0 gap-0.5 group-focus-within:opacity-100 group-hover:opacity-100"
		>
			<button
				type="button"
				onclick={startEdit}
				aria-label="Edit transaction"
				title="Edit"
				class="rounded px-1 text-xs text-faint hover:bg-tint hover:text-mute">✎</button
			>
			{#if onduplicate}
				<button
					type="button"
					onclick={() => onduplicate(txn)}
					aria-label="Duplicate transaction to today"
					title="Copy to today"
					class="rounded px-1 text-xs text-faint hover:bg-tint hover:text-mute">⧉</button
				>
			{/if}
			<button
				type="button"
				onclick={() => ondelete(txn)}
				aria-label="Delete transaction"
				title="Delete"
				class="rounded px-1 text-xs text-faint hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
				>×</button
			>
		</span>
	</div>
{/if}
