<script lang="ts">
	import { resolve } from '$app/paths';
	import { isValidKey } from '$lib/date';
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
	import {
		CATEGORIES,
		formatMoney,
		hasCategory as kindHasCategory,
		SUGGESTED_ACCOUNTS
	} from '$lib/finance';
	import { isValidHandle } from '$lib/parse';
	import { loadTxnPrefs, rememberCategory, rememberGroup, saveTxnPrefs } from '$lib/prefs';
	import { settings } from '$lib/settings.svelte';
	import { saveFailed, toast } from '$lib/toast.svelte';
	import TransactionRow from './TransactionRow.svelte';

	let {
		uid,
		date,
		people,
		onnewperson,
		accounts = $bindable(),
		txns = $bindable(),
		pickDate = false,
		embedded = false,
		suggest,
		groups
	}: {
		uid: string;
		/** Day new transactions land on (the default when `pickDate` is on). */
		date: string;
		people: Person[];
		onnewperson: (handle: string) => void;
		accounts: Account[];
		txns: Transaction[];
		/** Show a date field — used on the Finance page, where there's no "current day". */
		pickDate?: boolean;
		/** Form only: no card chrome, header or list of the day's transactions. */
		embedded?: boolean;
		/** Category suggestions per kind; defaults to presets + this device's recent picks. */
		suggest?: (kind: TransactionKind) => string[];
		/** Group labels to suggest; defaults to this device's recent groups. */
		groups?: string[];
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

	// Start from whatever this device used last — most entries repeat the same kind and account.
	const prefs = loadTxnPrefs();
	const validAccount = (id: string) => (accounts.some((a) => a.id === id) ? id : '');

	let kind: TransactionKind = $state(prefs.kind);
	// svelte-ignore state_referenced_locally
	let txnDate = $state(date);
	let amount = $state('');
	let category = $state('');
	let from = $state(validAccount(prefs.from) || accounts[0]?.id || '');
	let to = $state(validAccount(prefs.to) || accounts[0]?.id || '');
	let person = $state('');
	let note = $state('');
	let fixed = $state(false);
	// Kept between entries so a trip's expenses can be logged one after another.
	let group = $state('');
	let invalid = $state('');

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
	const hasCategory = $derived(kindHasCategory(kind));

	function suggestions(k: TransactionKind): string[] {
		if (suggest) return suggest(k);
		return [...new Set([...(prefs.recent[k] ?? []), ...CATEGORIES[k]])];
	}

	const groupOptions = $derived([...new Set([...(groups ?? []), ...prefs.groups])]);

	const dayTotals = $derived.by(() => {
		let out = 0;
		let inn = 0;
		for (const t of txns) {
			if (t.kind === 'expense') out += t.amount;
			else if (t.kind === 'income') inn += t.amount;
		}
		return { out, in: inn };
	});

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

	function addAccount() {
		const name = acctName.trim();
		if (!name) return;
		const account: Account = {
			id: newAccountId(uid),
			name,
			startingBalance: Number(acctBalance) || 0,
			order: Math.max(0, ...accounts.map((a) => a.order)) + 1
		};
		accounts = [...accounts, account];
		saveAccount(uid, account).catch(saveFailed);
		if (addingFor === 'to') to = account.id;
		else from = account.id;
		// The very first account fills both sides so the form is ready to go.
		if (accounts.length === 1) from = to = account.id;
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
		invalid = '';
		if (!value || value <= 0) return (invalid = 'Enter an amount above 0.');
		if (pickDate && !isValidKey(txnDate)) return (invalid = 'Pick a date.');
		if (needsFrom && !from) return (invalid = 'Pick the account the money left.');
		if (needsTo && !to) return (invalid = 'Pick the account the money went into.');
		if (needsPerson && !person) return (invalid = 'Pick a person.');
		if (kind === 'transfer' && from === to) return (invalid = 'Pick two different accounts.');
		const cat = hasCategory ? category.trim() || 'other' : kind;
		const txn: Transaction = {
			id: newTransactionId(uid),
			date: pickDate ? txnDate : date,
			kind,
			category: cat,
			amount: value,
			from: needsFrom ? from : null,
			to: needsTo ? to : null,
			person: needsPerson ? person : null,
			note: note.trim(),
			fixed: kind === 'expense' ? fixed : false,
			group: group.trim() || null,
			createdAt: Date.now()
		};
		txns = [...txns, txn];
		amount = '';
		category = '';
		note = '';
		fixed = false;
		prefs.kind = kind;
		if (needsFrom) prefs.from = from;
		if (needsTo) prefs.to = to;
		if (hasCategory) rememberCategory(prefs, kind, cat);
		if (txn.group) rememberGroup(prefs, txn.group);
		saveTxnPrefs(prefs);
		saveTransaction(uid, txn).catch(saveFailed);
		if (embedded) toast(`Added ${kind} of ${formatMoney(value)} on ${txn.date}.`);
	}

	function removeTxn(txn: Transaction) {
		txns = txns.filter((t) => t.id !== txn.id);
		deleteTransaction(uid, txn.id).catch(saveFailed);
		toast(`Deleted ${txn.category} ${formatMoney(txn.amount)}.`, {
			undo: () => {
				txns = [...txns, txn];
				saveTransaction(uid, txn).catch(saveFailed);
			}
		});
	}

	function updateTxn(updated: Transaction) {
		// Moved to another day → it no longer belongs on this day page.
		txns =
			!pickDate && updated.date !== date
				? txns.filter((t) => t.id !== updated.id)
				: txns.map((t) => (t.id === updated.id ? updated : t));
		saveTransaction(uid, updated).catch(saveFailed);
		if (!pickDate && updated.date !== date) toast(`Moved to ${updated.date}.`);
	}

	const field = 'rounded-ctl border-line bg-card py-1.5 text-sm text-ink';
</script>

{#snippet personSelect(label: string)}
	<label class="flex flex-col gap-0.5 text-xs text-mute">
		{label}
		<select value={person} onchange={(e) => pickPerson(e.currentTarget.value)} class={field}>
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
		<select {value} onchange={(e) => pickAccount(which, e.currentTarget.value)} class={field}>
			<option value="" disabled>account…</option>
			{#each accounts as account (account.id)}
				<option value={account.id}>{account.name}</option>
			{/each}
			<option value="__new">+ new account…</option>
		</select>
	</label>
{/snippet}

{#snippet body()}
	{#if !embedded && txns.length > 0}
		<div class="mb-3 space-y-0.5">
			{#each txns as txn (txn.id)}
				<TransactionRow
					{txn}
					{accounts}
					{people}
					suggest={suggestions}
					groups={groupOptions}
					onupdate={updateTxn}
					ondelete={removeTxn}
				/>
			{/each}
		</div>
	{/if}

	{#if accounts.length === 0 && addingFor === null}
		<p class="mb-2 text-sm text-mute">
			Set up an account first — its starting balance is what you have in it right now.
		</p>
		<div class="flex flex-wrap gap-1.5">
			{#each [...SUGGESTED_ACCOUNTS, ''] as name (name)}
				<button
					type="button"
					onclick={() => {
						addingFor = 'from';
						acctName = name;
						acctBalance = '';
					}}
					class="rounded-full border border-emerald-500/40 bg-card px-2.5 py-1 text-xs text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
				>
					+ {name || 'other…'}
				</button>
			{/each}
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
				<input type="text" bind:value={acctName} placeholder="e.g. bKash" class="w-36 {field}" />
			</label>
			<label class="flex flex-col gap-0.5 text-xs text-mute">
				Starting balance ({settings.currency})
				<input
					type="number"
					step="any"
					bind:value={acctBalance}
					placeholder="0"
					class="w-32 {field}"
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
					class="w-36 {field}"
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
			<div
				class="flex overflow-hidden rounded-ctl border border-line"
				role="group"
				aria-label="Type"
			>
				{#each KINDS as k (k.kind)}
					<button
						type="button"
						onclick={() => (kind = k.kind)}
						aria-pressed={kind === k.kind}
						class="border-r border-line px-2.5 py-1.5 text-xs font-medium last:border-r-0 {kind ===
						k.kind
							? k.active
							: 'bg-card text-mute hover:bg-tint'}"
					>
						{k.label}
					</button>
				{/each}
			</div>
			{#if pickDate}
				<label class="flex flex-col gap-0.5 text-xs text-mute">
					Date
					<input type="date" bind:value={txnDate} class={field} />
				</label>
			{/if}
			<label class="flex flex-col gap-0.5 text-xs text-mute">
				Amount ({settings.currency})
				<input
					type="number"
					min="0"
					step="any"
					inputmode="decimal"
					bind:value={amount}
					placeholder="0"
					class="w-28 {field}"
				/>
			</label>
			{#if hasCategory}
				<label class="flex flex-col gap-0.5 text-xs text-mute">
					Category
					<input
						type="text"
						bind:value={category}
						list="finance-categories-{kind}"
						placeholder={suggestions(kind)[0]}
						class="w-32 {field}"
					/>
					<datalist id="finance-categories-{kind}">
						{#each suggestions(kind) as c (c)}
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
				<label class="flex items-center gap-1 pb-1.5 text-xs text-mute" title="Recurring bill">
					<input type="checkbox" bind:checked={fixed} />
					fixed
				</label>
			{/if}
			<label
				class="flex flex-col gap-0.5 text-xs text-mute"
				title="Tie related transactions together, e.g. a trip"
			>
				Group (optional)
				<input
					type="text"
					bind:value={group}
					list="finance-groups"
					placeholder="e.g. Dhaka trip"
					class="w-40 {field}"
				/>
				<datalist id="finance-groups">
					{#each groupOptions as g (g)}
						<option value={g}></option>
					{/each}
				</datalist>
			</label>
			<label class="flex min-w-32 flex-1 flex-col gap-0.5 text-xs text-mute">
				Note (optional)
				<input type="text" bind:value={note} class={field} />
			</label>
			<button
				type="submit"
				class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
			>
				Add
			</button>
			{#if invalid}
				<p class="w-full text-xs text-red-600 dark:text-red-400">{invalid}</p>
			{:else if group.trim()}
				<p class="w-full text-xs text-faint">
					Entries go under “{group.trim()}” until you clear the group field.
				</p>
			{:else if KIND_HINT[kind]}
				<p class="w-full text-xs text-faint">{KIND_HINT[kind]}</p>
			{/if}
		</form>
	{/if}
{/snippet}

{#if embedded}
	{@render body()}
{:else}
	<section class="rounded-card border border-line bg-card p-4 shadow-card">
		<h2
			class="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-semibold tracking-wide text-emerald-600 uppercase dark:text-emerald-400"
		>
			<span class="h-1.5 w-1.5 rounded-full bg-current"></span>
			Finance
			{#if dayTotals.in > 0 || dayTotals.out > 0}
				<span class="ml-2 font-normal text-faint normal-case tabular-nums">
					{#if dayTotals.in > 0}+{formatMoney(dayTotals.in)}{/if}
					{#if dayTotals.in > 0 && dayTotals.out > 0}·{/if}
					{#if dayTotals.out > 0}−{formatMoney(dayTotals.out)} spent{/if}
				</span>
			{/if}
			<a
				href={resolve('/finance')}
				class="ml-auto font-normal text-emerald-600 normal-case hover:underline dark:text-emerald-400"
			>
				all transactions →
			</a>
		</h2>
		{@render body()}
	</section>
{/if}
