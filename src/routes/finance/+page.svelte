<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/auth.svelte';
	import MonthlyChart from '$lib/components/MonthlyChart.svelte';
	import {
		deleteAccount,
		deleteTransaction,
		newAccountId,
		saveAccount,
		type Account,
		type Transaction,
		type TransactionKind
	} from '$lib/db';
	import { fromKey } from '$lib/date';
	import {
		balances,
		formatMoney,
		monthLabel,
		monthlySummaries,
		monthOf,
		personBalances,
		signedAmount,
		SUGGESTED_ACCOUNTS
	} from '$lib/finance';

	let { data } = $props();

	const uid = session.user!.uid;

	let accounts = $derived(data.accounts);
	let txns = $derived(data.txns);
	const people = $derived(data.people);
	let error = $state(false);

	const balance = $derived(balances(accounts, txns));
	const summaries = $derived(monthlySummaries(txns));
	const total = $derived([...balance.values()].reduce((sum, b) => sum + b, 0));

	/** Debts, biggest first — positive means they owe you, negative means you owe them. */
	const owed = $derived([...personBalances(txns)].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])));
	const owedToYou = $derived(owed.reduce((sum, [, a]) => (a > 0 ? sum + a : sum), 0));
	const owedByYou = $derived(owed.reduce((sum, [, a]) => (a < 0 ? sum - a : sum), 0));

	const personName = (handle: string) => people.find((p) => p.handle === handle)?.name;

	/** Transactions grouped by month, newest first (txns already arrive sorted). */
	const monthGroups = $derived.by(() => {
		const groups: { month: string; txns: Transaction[] }[] = [];
		for (const t of txns) {
			const month = monthOf(t.date);
			const last = groups[groups.length - 1];
			if (last?.month === month) last.txns.push(t);
			else groups.push({ month, txns: [t] });
		}
		return groups;
	});

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

	const summaryFor = (month: string) => summaries.find((s) => s.month === month);

	// Account add/edit state.
	let adding = $state(false);
	let editingId: string | null = $state(null);
	let name = $state('');
	let startingBalance = $state('');

	function startAdd(prefill = '') {
		adding = true;
		editingId = null;
		name = prefill;
		startingBalance = '';
	}

	function startEdit(account: Account) {
		editingId = account.id;
		adding = false;
		name = account.name;
		startingBalance = String(account.startingBalance);
	}

	function submitAccount() {
		const trimmed = name.trim();
		if (!trimmed) return;
		const account: Account = editingId
			? {
					...accounts.find((a) => a.id === editingId)!,
					name: trimmed,
					startingBalance: Number(startingBalance) || 0
				}
			: {
					id: newAccountId(uid),
					name: trimmed,
					startingBalance: Number(startingBalance) || 0,
					order: Math.max(0, ...accounts.map((a) => a.order)) + 1
				};
		accounts = editingId
			? accounts.map((a) => (a.id === editingId ? account : a))
			: [...accounts, account];
		adding = false;
		editingId = null;
		saveAccount(uid, account).catch(() => (error = true));
	}

	function removeAccount(account: Account) {
		if (txns.some((t) => t.from === account.id || t.to === account.id)) {
			alert(`"${account.name}" still has transactions — delete those first.`);
			return;
		}
		if (!confirm(`Delete account "${account.name}"?`)) return;
		accounts = accounts.filter((a) => a.id !== account.id);
		deleteAccount(uid, account.id).catch(() => (error = true));
	}

	function removeTxn(txn: Transaction) {
		if (!confirm(`Delete this ${txn.kind} of ${formatMoney(txn.amount)}?`)) return;
		txns = txns.filter((t) => t.id !== txn.id);
		deleteTransaction(uid, txn.id).catch(() => (error = true));
	}

	const dayHref = (key: string) => resolve('/day/[date]', { date: key });
	const suggestionsLeft = $derived(
		SUGGESTED_ACCOUNTS.filter(
			(s) => !accounts.some((a) => a.name.toLowerCase() === s.toLowerCase())
		)
	);
</script>

<h1 class="font-display text-2xl font-bold tracking-tight text-ink">Finance</h1>

{#if accounts.length > 0}
	{@const current = summaries[0]}
	<div class="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
		<div class="rounded-card border border-line bg-card p-4 shadow-card">
			<p class="text-xs font-semibold tracking-wide text-faint uppercase">Total balance</p>
			<p class="mt-1 font-display text-2xl font-bold text-ink tabular-nums">
				{formatMoney(total)}
			</p>
		</div>
		<div class="rounded-card border border-line bg-card p-4 shadow-card">
			<p class="text-xs font-semibold tracking-wide text-faint uppercase">
				{current ? monthLabel(current.month) : 'This month'} net
			</p>
			<p
				class="mt-1 font-display text-2xl font-bold tabular-nums {current && current.net < 0
					? 'text-red-600 dark:text-red-400'
					: 'text-ink'}"
			>
				{formatMoney(current?.net ?? 0)}
			</p>
		</div>
		<div class="rounded-card border border-line bg-card p-4 shadow-card">
			<p class="text-xs font-semibold tracking-wide text-faint uppercase">Owed to you</p>
			<p
				class="mt-1 font-display text-2xl font-bold tabular-nums {owedToYou > 0
					? 'text-amber-600 dark:text-amber-400'
					: 'text-ink'}"
			>
				{formatMoney(owedToYou)}
			</p>
		</div>
		<div class="rounded-card border border-line bg-card p-4 shadow-card">
			<p class="text-xs font-semibold tracking-wide text-faint uppercase">You owe</p>
			<p
				class="mt-1 font-display text-2xl font-bold tabular-nums {owedByYou > 0
					? 'text-violet-600 dark:text-violet-400'
					: 'text-ink'}"
			>
				{formatMoney(owedByYou)}
			</p>
		</div>
	</div>
{/if}

<section class="mt-6">
	<div class="mb-2 flex items-baseline">
		<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">Accounts</h2>
		{#if accounts.length > 0}
			<span class="ml-auto text-sm text-mute">
				Total <span class="font-semibold text-ink tabular-nums">{formatMoney(total)}</span>
			</span>
		{/if}
	</div>
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
		{#each accounts as account (account.id)}
			{#if editingId === account.id}
				<form
					class="rounded-card border border-accent/50 bg-card p-3"
					onsubmit={(e) => {
						e.preventDefault();
						submitAccount();
					}}
				>
					<input
						type="text"
						bind:value={name}
						aria-label="Account name"
						class="mb-1.5 w-full rounded-ctl border-line bg-card py-1 text-sm text-ink"
					/>
					<input
						type="number"
						step="any"
						bind:value={startingBalance}
						aria-label="Starting balance"
						placeholder="starting balance"
						class="mb-1.5 w-full rounded-ctl border-line bg-card py-1 text-sm text-ink"
					/>
					<div class="flex gap-1">
						<button
							type="submit"
							class="rounded-ctl bg-accent-fill px-2 py-1 text-xs font-medium text-on-accent hover:opacity-90"
							>Save</button
						>
						<button
							type="button"
							onclick={() => (editingId = null)}
							class="rounded-ctl px-2 py-1 text-xs text-mute hover:bg-tint">cancel</button
						>
					</div>
				</form>
			{:else}
				<div class="group rounded-card border border-line bg-card p-3 shadow-card">
					<p class="flex items-baseline text-sm text-mute">
						<span class="truncate">{account.name}</span>
						<span
							class="ml-auto flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
						>
							<button
								type="button"
								onclick={() => startEdit(account)}
								aria-label="Edit {account.name}"
								class="rounded px-1 text-xs text-faint hover:bg-tint hover:text-mute">✎</button
							>
							<button
								type="button"
								onclick={() => removeAccount(account)}
								aria-label="Delete {account.name}"
								class="rounded px-1 text-xs text-faint hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
								>×</button
							>
						</span>
					</p>
					<p class="mt-0.5 font-display text-lg font-semibold text-ink tabular-nums">
						{formatMoney(balance.get(account.id) ?? 0)}
					</p>
					<p class="text-xs text-faint tabular-nums">
						started at {formatMoney(account.startingBalance)}
					</p>
				</div>
			{/if}
		{/each}
		{#if adding}
			<form
				class="rounded-card border border-accent/50 bg-card p-3"
				onsubmit={(e) => {
					e.preventDefault();
					submitAccount();
				}}
			>
				<input
					type="text"
					bind:value={name}
					placeholder="account name"
					aria-label="Account name"
					class="mb-1.5 w-full rounded-ctl border-line bg-card py-1 text-sm text-ink"
				/>
				<input
					type="number"
					step="any"
					bind:value={startingBalance}
					placeholder="starting balance"
					aria-label="Starting balance"
					class="mb-1.5 w-full rounded-ctl border-line bg-card py-1 text-sm text-ink"
				/>
				<div class="flex gap-1">
					<button
						type="submit"
						class="rounded-ctl bg-accent-fill px-2 py-1 text-xs font-medium text-on-accent hover:opacity-90"
						>Add</button
					>
					<button
						type="button"
						onclick={() => (adding = false)}
						class="rounded-ctl px-2 py-1 text-xs text-mute hover:bg-tint">cancel</button
					>
				</div>
			</form>
		{:else}
			<button
				type="button"
				onclick={() => startAdd()}
				class="rounded-card border border-dashed border-line p-3 text-sm text-faint hover:border-accent/50 hover:text-accent"
			>
				+ add account
			</button>
		{/if}
	</div>
	{#if !adding && editingId === null && suggestionsLeft.length > 0 && accounts.length > 0}
		<p class="mt-2 text-xs text-faint">
			quick add:
			{#each suggestionsLeft as s (s)}
				<button
					type="button"
					onclick={() => startAdd(s)}
					class="ml-1.5 text-accent hover:underline"
				>
					{s}
				</button>
			{/each}
		</p>
	{/if}
</section>

<div class="mt-6 grid items-start gap-4 xl:grid-cols-2">
	<section class="rounded-card border border-line bg-card p-4 shadow-card">
		<h2 class="mb-3 text-xs font-semibold tracking-wide text-mute uppercase">Monthly overview</h2>
		{#if summaries.length > 0}
			{@const current = summaries[0]}
			<div class="mb-4 grid grid-cols-3 gap-2 text-center">
				<div class="rounded-ctl bg-tint p-2">
					<p class="text-xs text-faint">{monthLabel(current.month)} in</p>
					<p class="text-base font-semibold text-green-700 tabular-nums dark:text-green-400">
						{formatMoney(current.income)}
					</p>
				</div>
				<div class="rounded-ctl bg-tint p-2">
					<p class="text-xs text-faint">out</p>
					<p class="text-base font-semibold text-red-600 tabular-nums dark:text-red-400">
						{formatMoney(current.expense)}
					</p>
				</div>
				<div class="rounded-ctl bg-tint p-2">
					<p class="text-xs text-faint">net</p>
					<p
						class="text-base font-semibold tabular-nums {current.net >= 0
							? 'text-ink'
							: 'text-red-600 dark:text-red-400'}"
					>
						{formatMoney(current.net)}
					</p>
				</div>
			</div>
		{/if}
		<MonthlyChart {summaries} />
	</section>

	{#if owed.length > 0}
		<section class="rounded-card border border-line bg-card p-4 shadow-card">
			<div class="mb-3 flex flex-wrap items-baseline gap-x-3">
				<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">Owed</h2>
				<span class="ml-auto text-xs text-mute tabular-nums">
					{#if owedToYou > 0}
						owed to you
						<span class="font-medium text-amber-600 dark:text-amber-400"
							>{formatMoney(owedToYou)}</span
						>
					{/if}
					{#if owedToYou > 0 && owedByYou > 0}·{/if}
					{#if owedByYou > 0}
						you owe
						<span class="font-medium text-violet-600 dark:text-violet-400"
							>{formatMoney(owedByYou)}</span
						>
					{/if}
				</span>
			</div>
			<div class="space-y-1">
				{#each owed as [handle, amount] (handle)}
					<p class="flex items-center gap-2 text-sm leading-relaxed">
						<a
							href={resolve('/people/[handle]', { handle })}
							class="font-medium text-accent hover:underline"
						>
							@{handle}
						</a>
						{#if personName(handle)}
							<span class="truncate text-faint">{personName(handle)}</span>
						{/if}
						<span class="text-mute">{amount > 0 ? 'owes you' : 'you owe'}</span>
						<span
							class="ml-auto font-medium tabular-nums {amount > 0
								? 'text-amber-600 dark:text-amber-400'
								: 'text-violet-600 dark:text-violet-400'}"
						>
							{formatMoney(Math.abs(amount))}
						</span>
					</p>
				{/each}
			</div>
			<p class="mt-2 text-xs text-faint">
				Settle up by lending to someone you owe, or recording a borrow from someone who owes you.
			</p>
		</section>
	{/if}
</div>

<section class="mt-6">
	<h2 class="mb-2 text-xs font-semibold tracking-wide text-mute uppercase">All transactions</h2>
	{#if txns.length === 0}
		<p class="text-sm text-faint">
			Nothing yet — add transactions from the Finance panel on any day page.
		</p>
	{/if}
	<div class="space-y-4">
		{#each monthGroups as group (group.month)}
			{@const s = summaryFor(group.month)}
			<div class="rounded-card border border-line bg-card p-4 shadow-card">
				<p class="mb-2 flex flex-wrap items-baseline gap-x-3 border-b border-line pb-2">
					<span class="font-display text-sm font-semibold text-ink">{monthLabel(group.month)}</span>
					{#if s}
						<span class="ml-auto text-xs text-mute tabular-nums">
							<span class="text-green-700 dark:text-green-400">+{formatMoney(s.income)}</span>
							·
							<span class="text-red-600 dark:text-red-400">−{formatMoney(s.expense)}</span>
							· net <span class="font-medium text-ink">{formatMoney(s.net)}</span>
						</span>
					{/if}
				</p>
				<div class="space-y-1">
					{#each group.txns as txn (txn.id)}
						<p class="group flex items-center gap-2 text-sm leading-relaxed">
							<a
								href={dayHref(txn.date)}
								class="w-12 shrink-0 text-xs text-faint tabular-nums hover:text-accent hover:underline"
							>
								{DAY_LABEL.format(fromKey(txn.date))}
							</a>
							<span class="rounded-full px-2 py-0.5 text-xs font-medium {KIND_CHIP[txn.kind]}">
								{txn.category}
							</span>
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
							<button
								type="button"
								onclick={() => removeTxn(txn)}
								aria-label="Delete transaction"
								class="rounded px-1 text-xs text-faint opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
								>×</button
							>
						</p>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</section>

{#if error}
	<p class="mt-4 text-xs text-red-500 dark:text-red-400">
		save failed — some changes may not be stored
	</p>
{/if}
