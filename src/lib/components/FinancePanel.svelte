<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		deleteTransaction,
		newAccountId,
		newTransactionId,
		saveAccount,
		saveTransaction,
		type Account,
		type Person,
		type Transaction,
		type TransactionKind
	} from '$lib/db';
	import { CATEGORIES, SUGGESTED_ACCOUNTS } from '$lib/finance';
	import { isValidHandle } from '$lib/parse';
	import TransactionRow from './TransactionRow.svelte';

	let {
		uid,
		date,
		people,
		onnewperson,
		accounts = $bindable(),
		txns = $bindable()
	}: {
		uid: string;
		date: string;
		people: Person[];
		onnewperson: (handle: string) => void;
		accounts: Account[];
		txns: Transaction[];
	} = $props();

	const KINDS: { kind: TransactionKind; label: string; active: string }[] = [
		{ kind: 'expense', label: 'Expense', active: 'bg-red-600 text-white border-red-600' },
		{ kind: 'income', label: 'Income', active: 'bg-green-700 text-white border-green-700' },
		{ kind: 'transfer', label: 'Transfer', active: 'bg-blue-600 text-white border-blue-600' },
		{ kind: 'lend', label: 'Lend', active: 'bg-amber-500 text-white border-amber-500' },
		{ kind: 'borrow', label: 'Borrow', active: 'bg-violet-600 text-white border-violet-600' }
	];

	const KIND_HINT: Partial<Record<TransactionKind, string>> = {
		lend: 'Money you hand over — they owe you (or it settles what you owed them).',
		borrow: 'Money you receive — you owe them (or it settles what they owed you).'
	};

	let kind: TransactionKind = $state('expense');
	let amount = $state('');
	let category = $state('');
	let from = $state('');
	let to = $state('');
	let person = $state('');
	let note = $state('');
	let fixed = $state(false);
	let error = $state(false);

	// Inline account creation — remembers which select asked for it.
	let addingFor: 'from' | 'to' | null = $state(null);
	let acctName = $state('');
	let acctBalance = $state('');

	// Inline person creation for lend/borrow.
	let addingPerson = $state(false);
	let personHandle = $state('');
	let personInvalid = $state(false);

	// $derived.by keeps TS from narrowing `kind` to its initial value at top level.
	const needsFrom = $derived.by(() => kind !== 'income' && kind !== 'borrow');
	const needsTo = $derived.by(() => kind !== 'expense' && kind !== 'lend');
	const needsPerson = $derived.by(() => kind === 'lend' || kind === 'borrow');
	const hasCategory = $derived.by(() => kind === 'expense' || kind === 'income');

	function pickAccount(which: 'from' | 'to', value: string) {
		if (value === '__new') {
			addingFor = which;
			acctName = '';
			acctBalance = '';
			return;
		}
		if (which === 'from') from = value;
		else to = value;
	}

	function addAccount(prefill?: string) {
		const name = (prefill ?? acctName).trim();
		if (!name) return;
		const account: Account = {
			id: newAccountId(uid),
			name,
			startingBalance: Number(acctBalance) || 0,
			order: Math.max(0, ...accounts.map((a) => a.order)) + 1
		};
		accounts = [...accounts, account];
		saveAccount(uid, account).catch(() => (error = true));
		if (addingFor === 'to') to = account.id;
		else from = account.id;
		addingFor = null;
		acctName = '';
		acctBalance = '';
	}

	function pickPerson(value: string) {
		if (value === '__new') {
			addingPerson = true;
			personHandle = '';
			personInvalid = false;
			return;
		}
		person = value;
	}

	function addPerson() {
		const handle = personHandle.trim().toLowerCase().replace(/^@/, '');
		if (!isValidHandle(handle)) {
			personInvalid = true;
			return;
		}
		if (!people.some((p) => p.handle === handle)) onnewperson(handle);
		person = handle;
		addingPerson = false;
		personHandle = '';
	}

	function addTxn() {
		const value = Number(amount);
		if (!value || value <= 0) return;
		if (needsFrom && !from) return;
		if (needsTo && !to) return;
		if (needsPerson && !person) return;
		if (kind === 'transfer' && from === to) return;
		const txn: Transaction = {
			id: newTransactionId(uid),
			date,
			kind,
			category: hasCategory ? category.trim() || 'other' : kind,
			amount: value,
			from: needsFrom ? from : null,
			to: needsTo ? to : null,
			person: needsPerson ? person : null,
			note: note.trim(),
			fixed: kind === 'expense' ? fixed : false,
			createdAt: Date.now()
		};
		txns = [...txns, txn];
		amount = '';
		category = '';
		note = '';
		fixed = false;
		saveTransaction(uid, txn).catch(() => (error = true));
	}

	function removeTxn(txn: Transaction) {
		txns = txns.filter((t) => t.id !== txn.id);
		deleteTransaction(uid, txn.id).catch(() => (error = true));
	}

	function updateTxn(updated: Transaction) {
		txns = txns.map((t) => (t.id === updated.id ? updated : t));
		saveTransaction(uid, updated).catch(() => (error = true));
	}
</script>

{#snippet personSelect(label: string)}
	<label class="flex flex-col gap-0.5 text-xs text-mute">
		{label}
		<select
			value={person}
			onchange={(e) => pickPerson(e.currentTarget.value)}
			class="rounded-ctl border-line bg-card py-1.5 text-sm text-ink"
		>
			<option value="" disabled>person…</option>
			{#each people as p (p.handle)}
				<option value={p.handle}>@{p.handle}{p.name ? ` (${p.name})` : ''}</option>
			{/each}
			<option value="__new">+ new person…</option>
		</select>
	</label>
{/snippet}

{#snippet accountSelect(which: 'from' | 'to', label: string, value: string)}
	<label class="flex flex-col gap-0.5 text-xs text-mute">
		{label}
		<select
			{value}
			onchange={(e) => pickAccount(which, e.currentTarget.value)}
			class="rounded-ctl border-line bg-card py-1.5 text-sm text-ink"
		>
			<option value="" disabled>account…</option>
			{#each accounts as account (account.id)}
				<option value={account.id}>{account.name}</option>
			{/each}
			<option value="__new">+ new account…</option>
		</select>
	</label>
{/snippet}

<section class="rounded-card border border-line bg-card p-4 shadow-card">
	<h2
		class="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-emerald-600 uppercase dark:text-emerald-400"
	>
		<span class="h-1.5 w-1.5 rounded-full bg-current"></span>
		Finance
		<a
			href={resolve('/finance')}
			class="ml-auto font-normal text-emerald-600 normal-case hover:underline dark:text-emerald-400"
		>
			all transactions →
		</a>
	</h2>

	{#if txns.length > 0}
		<div class="mb-3 space-y-1">
			{#each txns as txn (txn.id)}
				<TransactionRow {txn} {accounts} onupdate={updateTxn} ondelete={removeTxn} />
			{/each}
		</div>
	{/if}

	{#if accounts.length === 0 && addingFor === null}
		<p class="mb-2 text-sm text-mute">
			Set up an account first — its starting balance is what you have in it right now.
		</p>
		<div class="flex flex-wrap gap-1.5">
			{#each SUGGESTED_ACCOUNTS as name (name)}
				<button
					type="button"
					onclick={() => {
						addingFor = 'from';
						acctName = name;
						acctBalance = '';
					}}
					class="rounded-full border border-emerald-500/40 bg-card px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
				>
					+ {name}
				</button>
			{/each}
			<button
				type="button"
				onclick={() => {
					addingFor = 'from';
					acctName = '';
					acctBalance = '';
				}}
				class="rounded-full border border-emerald-500/40 bg-card px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
			>
				+ other…
			</button>
		</div>
	{/if}

	{#if addingFor !== null}
		<form
			class="mb-2 flex flex-wrap items-end gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				addAccount();
			}}
		>
			<label class="flex flex-col gap-0.5 text-xs text-mute">
				Account name
				<input
					type="text"
					bind:value={acctName}
					placeholder="e.g. bKash"
					class="w-36 rounded-ctl border-line bg-card py-1.5 text-sm text-ink"
				/>
			</label>
			<label class="flex flex-col gap-0.5 text-xs text-mute">
				Starting balance (৳)
				<input
					type="number"
					min="0"
					step="any"
					bind:value={acctBalance}
					placeholder="0"
					class="w-32 rounded-ctl border-line bg-card py-1.5 text-sm text-ink"
				/>
			</label>
			<button
				type="submit"
				class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
			>
				Add account
			</button>
			<button
				type="button"
				onclick={() => (addingFor = null)}
				class="rounded-ctl px-2 py-1.5 text-sm text-mute hover:bg-tint"
			>
				cancel
			</button>
		</form>
	{/if}

	{#if addingPerson}
		<form
			class="mb-2 flex flex-wrap items-end gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				addPerson();
			}}
		>
			<label class="flex flex-col gap-0.5 text-xs text-mute">
				Person handle
				<input
					type="text"
					bind:value={personHandle}
					oninput={() => (personInvalid = false)}
					placeholder="e.g. rahim"
					class="w-36 rounded-ctl border-line bg-card py-1.5 text-sm text-ink"
				/>
			</label>
			<button
				type="submit"
				class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
			>
				Add person
			</button>
			<button
				type="button"
				onclick={() => (addingPerson = false)}
				class="rounded-ctl px-2 py-1.5 text-sm text-mute hover:bg-tint"
			>
				cancel
			</button>
			{#if personInvalid}
				<span class="text-xs text-red-500 dark:text-red-400">letters, numbers and _ . - only</span>
			{/if}
		</form>
	{/if}

	{#if accounts.length > 0}
		<form
			class="flex flex-wrap items-end gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				addTxn();
			}}
		>
			<div class="flex overflow-hidden rounded-ctl border border-line">
				{#each KINDS as k (k.kind)}
					<button
						type="button"
						onclick={() => (kind = k.kind)}
						class="border-r border-line px-2.5 py-1.5 text-xs font-medium last:border-r-0 {kind ===
						k.kind
							? k.active
							: 'bg-card text-mute hover:bg-tint'}"
					>
						{k.label}
					</button>
				{/each}
			</div>
			<label class="flex flex-col gap-0.5 text-xs text-mute">
				Amount (৳)
				<input
					type="number"
					min="0"
					step="any"
					bind:value={amount}
					placeholder="0"
					class="w-28 rounded-ctl border-line bg-card py-1.5 text-sm text-ink"
				/>
			</label>
			{#if hasCategory}
				<label class="flex flex-col gap-0.5 text-xs text-mute">
					Category
					<input
						type="text"
						bind:value={category}
						list="finance-categories-{kind}"
						placeholder={CATEGORIES[kind][0]}
						class="w-32 rounded-ctl border-line bg-card py-1.5 text-sm text-ink"
					/>
					<datalist id="finance-categories-{kind}">
						{#each CATEGORIES[kind] as c (c)}
							<option value={c}></option>
						{/each}
					</datalist>
				</label>
			{/if}
			{#if kind === 'borrow'}
				{@render personSelect('From whom')}
			{/if}
			{#if needsFrom}
				{@render accountSelect('from', 'From', from)}
			{/if}
			{#if needsTo}
				{@render accountSelect('to', 'To', to)}
			{/if}
			{#if kind === 'lend'}
				{@render personSelect('To whom')}
			{/if}
			{#if kind === 'expense'}
				<label class="flex items-center gap-1 pb-1.5 text-xs text-mute">
					<input type="checkbox" bind:checked={fixed} />
					fixed
				</label>
			{/if}
			<label class="flex min-w-32 flex-1 flex-col gap-0.5 text-xs text-mute">
				Note (optional)
				<input
					type="text"
					bind:value={note}
					placeholder=""
					class="rounded-ctl border-line bg-card py-1.5 text-sm text-ink"
				/>
			</label>
			<button
				type="submit"
				class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
			>
				Add
			</button>
			{#if KIND_HINT[kind]}
				<p class="w-full text-xs text-faint">{KIND_HINT[kind]}</p>
			{/if}
		</form>
	{/if}

	{#if error}
		<p class="mt-2 text-xs text-red-500 dark:text-red-400">
			save failed — some changes may not be stored
		</p>
	{/if}
</section>
