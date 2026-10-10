<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { session } from '$lib/auth.svelte';
	import CashFlowChart from '$lib/components/CashFlowChart.svelte';
	import CategoryBreakdown from '$lib/components/CategoryBreakdown.svelte';
	import CategoryDetail from '$lib/components/CategoryDetail.svelte';
	import CategoryTrendChart from '$lib/components/CategoryTrendChart.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import FinancePanel from '$lib/components/FinancePanel.svelte';
	import SpendingPace from '$lib/components/SpendingPace.svelte';
	import TransactionMonthGroups from '$lib/components/TransactionMonthGroups.svelte';
	import {
		deleteAccount,
		deleteTransaction,
		newAccountId,
		newTransactionId,
		saveAccount,
		savePerson,
		saveTransaction,
		type Account,
		type Transaction,
		type TransactionKind
	} from '$lib/db';
	import { dateKey, fromKey, monthOf, shiftMonth } from '$lib/date';
	import {
		accountMonthFlow,
		balances,
		categorySuggestions,
		fixedVsVariable,
		formatMoney,
		KIND_LABEL,
		matchesSearch,
		monthLabel,
		monthlySummaries,
		PERCENT,
		personBalances,
		personHistory,
		signedAmount,
		SUGGESTED_ACCOUNTS,
		transactionsToCsv
	} from '$lib/finance';
	import { saveFailed, toast } from '$lib/toast.svelte';
	import { tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	let { data } = $props();

	const uid = session.user!.uid;
	const today = dateKey();
	const thisMonth = monthOf(today);

	let accounts = $derived(data.accounts);
	let txns = $derived(data.txns);
	let people = $derived(data.people);

	/** Newest first — locally added transactions arrive at the end, so keep the order explicit. */
	const sorted = $derived(
		[...txns].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
	);

	const balance = $derived(balances(accounts, txns));
	const total = $derived([...balance.values()].reduce((sum, b) => sum + b, 0));
	const summaries = $derived(monthlySummaries(txns));
	const current = $derived(summaries.find((s) => s.month === thisMonth));
	const previous = $derived(summaries.find((s) => s.month === shiftMonth(thisMonth, -1)));
	const flow = $derived(accountMonthFlow(txns, thisMonth));

	/** Debts, biggest first — positive means they owe you, negative means you owe them. */
	const owed = $derived([...personBalances(txns)].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])));
	const owedToYou = $derived(owed.reduce((sum, [, a]) => (a > 0 ? sum + a : sum), 0));
	const owedByYou = $derived(owed.reduce((sum, [, a]) => (a < 0 ? sum - a : sum), 0));
	const personName = (handle: string) => people.find((p) => p.handle === handle)?.name;
	const expandedPeople = new SvelteSet<string>();

	const suggest = (kind: TransactionKind) => categorySuggestions(txns, kind);

	// ——— Filters: they scope every chart and the list, and live in the URL so a view can be bookmarked.
	const params = page.url.searchParams;
	let search = $state(params.get('q') ?? '');
	let filterKind = $state(params.get('type') ?? 'all');
	let filterAccount = $state(params.get('account') ?? 'all');
	let filterCategory = $state(params.get('category') ?? 'all');

	const allCategories = $derived([...new Set(txns.map((t) => t.category))].sort());
	const filtersActive = $derived(
		search.trim() !== '' ||
			filterKind !== 'all' ||
			filterAccount !== 'all' ||
			filterCategory !== 'all'
	);
	const filtered = $derived(
		sorted.filter((t) => {
			if (filterKind !== 'all' && t.kind !== filterKind) return false;
			if (filterAccount !== 'all' && t.from !== filterAccount && t.to !== filterAccount)
				return false;
			if (filterCategory !== 'all' && t.category !== filterCategory) return false;
			return matchesSearch(t, search, accounts, people);
		})
	);
	const filteredSummaries = $derived(monthlySummaries(filtered));

	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	/** Query-only navigation on this route; `load` never reads the URL, so nothing is refetched. */
	function setQuery(
		url: URL,
		opts: { replaceState: boolean; noScroll: boolean; keepFocus: boolean }
	) {
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same route, only the query changes
		goto(`${resolve('/finance')}${url.search}`, opts);
	}

	/** Mirrors filters into the URL without a history entry (load doesn't read the URL, so no refetch). */
	function syncUrl(closeDrill = false) {
		clearTimeout(searchTimer);
		const url = new URL(page.url);
		if (closeDrill) {
			url.searchParams.delete('cat');
			url.searchParams.delete('kind');
			drillPushed = false;
		}
		const set = (key: string, value: string, empty: string) =>
			value === empty || value === ''
				? url.searchParams.delete(key)
				: url.searchParams.set(key, value);
		set('q', search.trim(), '');
		set('type', filterKind, 'all');
		set('account', filterAccount, 'all');
		set('category', filterCategory, 'all');
		setQuery(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	function clearFilters() {
		search = '';
		filterKind = 'all';
		filterAccount = 'all';
		filterCategory = 'all';
		syncUrl();
	}

	function toggleAccountFilter(id: string) {
		filterAccount = filterAccount === id ? 'all' : id;
		syncUrl();
	}

	// ——— Month groups: only expanded months render their rows.
	const open = new SvelteSet<string>([thisMonth]);
	const monthsInList = $derived([...new Set(filtered.map((t) => monthOf(t.date)))]);

	async function showMonth(month: string) {
		open.add(month);
		await tick();
		document.getElementById(`month-${month}`)?.scrollIntoView({ behavior: 'smooth' });
	}

	// ——— Category drill-down, opened from charts or chips; `?cat=` makes it linkable and Back closes it.
	const drill = $derived.by(() => {
		const cat = page.url.searchParams.get('cat');
		const kind = page.url.searchParams.get('kind') as TransactionKind | null;
		return cat !== null ? { category: cat, kind: kind ?? 'expense' } : null;
	});
	let drillPushed = false;

	function openCategory(category: string, kind: TransactionKind) {
		const url = new URL(page.url);
		url.searchParams.set('cat', category);
		url.searchParams.set('kind', kind);
		setQuery(url, { replaceState: drill !== null, noScroll: true, keepFocus: true });
		drillPushed = true;
	}

	function closeCategory() {
		if (!drill) return;
		if (drillPushed) {
			drillPushed = false;
			history.back();
			return;
		}
		const url = new URL(page.url);
		url.searchParams.delete('cat');
		url.searchParams.delete('kind');
		setQuery(url, { replaceState: true, noScroll: true, keepFocus: true });
	}

	// ——— Adding transactions straight from this page.
	let adding = $state(false);

	function addPerson(handle: string) {
		people = [...people, { handle }].sort((a, b) => a.handle.localeCompare(b.handle));
		savePerson(uid, { handle }).catch(saveFailed);
	}

	// ——— Transaction edits.
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
		txns = txns.map((t) => (t.id === updated.id ? updated : t));
		saveTransaction(uid, updated).catch(saveFailed);
	}

	function duplicateTxn(txn: Transaction) {
		const copy: Transaction = {
			...txn,
			id: newTransactionId(uid),
			date: today,
			createdAt: Date.now()
		};
		txns = [...txns, copy];
		saveTransaction(uid, copy).catch(saveFailed);
		open.add(thisMonth);
		toast(`Copied ${txn.category} ${formatMoney(txn.amount)} to today.`, {
			undo: () => {
				txns = txns.filter((t) => t.id !== copy.id);
				deleteTransaction(uid, copy.id).catch(saveFailed);
			}
		});
	}

	function exportCsv() {
		const blob = new Blob([transactionsToCsv(filtered, accounts)], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `daylog-transactions-${today}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	// ——— Accounts.
	let addingAccount = $state(false);
	let editingId: string | null = $state(null);
	let name = $state('');
	let startingBalance = $state('');

	function startAdd(prefill = '') {
		addingAccount = true;
		editingId = null;
		name = prefill;
		startingBalance = '';
	}

	function startEdit(account: Account) {
		editingId = account.id;
		addingAccount = false;
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
		addingAccount = false;
		editingId = null;
		saveAccount(uid, account).catch(saveFailed);
	}

	function removeAccount(account: Account) {
		const used = txns.filter((t) => t.from === account.id || t.to === account.id).length;
		if (used > 0) {
			toast(
				`“${account.name}” has ${used} transaction${used === 1 ? '' : 's'} — move or delete them first.`,
				{
					tone: 'error'
				}
			);
			return;
		}
		accounts = accounts.filter((a) => a.id !== account.id);
		deleteAccount(uid, account.id).catch(saveFailed);
		toast(`Deleted account “${account.name}”.`, {
			undo: () => {
				accounts = [...accounts, account].sort((a, b) => a.order - b.order);
				saveAccount(uid, account).catch(saveFailed);
			}
		});
	}

	const suggestionsLeft = $derived(
		SUGGESTED_ACCOUNTS.filter(
			(s) => !accounts.some((a) => a.name.toLowerCase() === s.toLowerCase())
		)
	);

	const fixedSplit = $derived(fixedVsVariable(filtered, thisMonth));
	const fixedTxns = $derived(
		filtered.filter((t) => t.fixed && t.kind === 'expense' && monthOf(t.date) === thisMonth)
	);

	const SHORT_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
	const field = 'rounded-ctl border-line bg-card py-1.5 text-sm text-ink';
	const card = 'rounded-card border border-line bg-card p-4 shadow-card';
</script>

<svelte:head>
	<title>Finance · daylog</title>
</svelte:head>

<div class="flex flex-wrap items-center gap-3">
	<h1 class="font-display text-2xl font-bold tracking-tight text-ink">Finance</h1>
	<div class="ml-auto flex flex-wrap gap-2">
		{#if txns.length > 0}
			<button
				type="button"
				onclick={exportCsv}
				title="Download {filtersActive ? 'the filtered' : 'all'} transactions as CSV"
				class="rounded-ctl border border-line bg-card px-3 py-1.5 text-sm font-medium text-mute hover:bg-tint hover:text-ink"
			>
				Export CSV
			</button>
		{/if}
		<button
			type="button"
			onclick={() => (adding = !adding)}
			aria-expanded={adding}
			class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
		>
			{adding ? 'Close' : '+ Add transaction'}
		</button>
	</div>
</div>

{#if adding}
	<section class="mt-4 {card}">
		<FinancePanel
			{uid}
			date={today}
			{people}
			onnewperson={addPerson}
			bind:accounts
			bind:txns
			{suggest}
			pickDate
			embedded
		/>
	</section>
{/if}

{#if accounts.length > 0}
	<div class="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
		<div class={card}>
			<p class="text-xs font-semibold tracking-wide text-faint uppercase">Total balance</p>
			<p class="mt-1 text-2xl font-bold text-ink">{formatMoney(total)}</p>
			<p class="text-xs text-faint">
				across {accounts.length} account{accounts.length === 1 ? '' : 's'}
			</p>
		</div>
		<div class={card}>
			<p class="text-xs font-semibold tracking-wide text-faint uppercase">
				{monthLabel(thisMonth)}
			</p>
			<p
				class="mt-1 text-2xl font-bold {current && current.net < 0
					? 'text-red-600 dark:text-red-400'
					: 'text-ink'}"
			>
				{formatMoney(current?.net ?? 0)}
			</p>
			<p class="text-xs text-faint tabular-nums">
				+{formatMoney(current?.income ?? 0)} · −{formatMoney(current?.expense ?? 0)}
				{#if current?.savingsRate != null}· saved {PERCENT.format(current.savingsRate)}{/if}
			</p>
			{#if previous}
				<p class="text-[11px] text-faint">last month net {formatMoney(previous.net)}</p>
			{/if}
		</div>
		<div class={card}>
			<p class="text-xs font-semibold tracking-wide text-faint uppercase">Owed to you</p>
			<p
				class="mt-1 text-2xl font-bold {owedToYou > 0
					? 'text-amber-600 dark:text-amber-400'
					: 'text-ink'}"
			>
				{formatMoney(owedToYou)}
			</p>
			<p class="text-xs text-faint">
				{owed.filter(([, a]) => a > 0).length} people
			</p>
		</div>
		<div class={card}>
			<p class="text-xs font-semibold tracking-wide text-faint uppercase">You owe</p>
			<p
				class="mt-1 text-2xl font-bold {owedByYou > 0
					? 'text-violet-600 dark:text-violet-400'
					: 'text-ink'}"
			>
				{formatMoney(owedByYou)}
			</p>
			<p class="text-xs text-faint">
				{owed.filter(([, a]) => a < 0).length} people
			</p>
		</div>
	</div>
{/if}

<section class="mt-6">
	<div class="mb-2 flex items-baseline">
		<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">Accounts</h2>
		<span class="ml-3 text-xs text-faint">click one to filter by it</span>
	</div>
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
		{#snippet accountForm(submitLabel: string, cancel: () => void)}
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
					class="mb-1.5 w-full {field} py-1"
				/>
				<input
					type="number"
					step="any"
					bind:value={startingBalance}
					placeholder="starting balance"
					aria-label="Starting balance"
					class="mb-1.5 w-full {field} py-1"
				/>
				<div class="flex gap-1">
					<button
						type="submit"
						class="rounded-ctl bg-accent-fill px-2 py-1 text-xs font-medium text-on-accent hover:opacity-90"
						>{submitLabel}</button
					>
					<button
						type="button"
						onclick={cancel}
						class="rounded-ctl px-2 py-1 text-xs text-mute hover:bg-tint">cancel</button
					>
				</div>
			</form>
		{/snippet}
		{#each accounts as account (account.id)}
			{#if editingId === account.id}
				{@render accountForm('Save', () => (editingId = null))}
			{:else}
				{@const f = flow.get(account.id)}
				{@const active = filterAccount === account.id}
				<div
					class="group relative rounded-card border bg-card p-3 shadow-card transition-colors {active
						? 'border-accent ring-2 ring-accent/25'
						: 'border-line hover:border-accent/40'}"
				>
					<button
						type="button"
						onclick={() => toggleAccountFilter(account.id)}
						aria-pressed={active}
						class="block w-full text-left"
					>
						<span class="block truncate pr-10 text-sm text-mute">{account.name}</span>
						<span class="mt-0.5 block font-display text-lg font-semibold text-ink tabular-nums">
							{formatMoney(balance.get(account.id) ?? 0)}
						</span>
						<span class="block text-[11px] text-faint tabular-nums">
							{#if f && (f.in > 0 || f.out > 0)}
								this month +{formatMoney(f.in)} · −{formatMoney(f.out)}
							{:else}
								started at {formatMoney(account.startingBalance)}
							{/if}
						</span>
					</button>
					<span
						class="reveal absolute top-2 right-2 flex gap-0.5 group-focus-within:opacity-100 group-hover:opacity-100"
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
				</div>
			{/if}
		{/each}
		{#if addingAccount}
			{@render accountForm('Add', () => (addingAccount = false))}
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
	{#if !addingAccount && editingId === null && suggestionsLeft.length > 0}
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

{#if txns.length > 0}
	<!-- One filter row above everything it scopes: every chart and the list re-render against it. -->
	<section
		class="sticky top-[57px] z-30 -mx-4 mt-6 border-y border-line bg-canvas/90 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10"
	>
		<div class="flex flex-wrap items-center gap-2">
			<input
				type="search"
				bind:value={search}
				oninput={() => {
					clearTimeout(searchTimer);
					searchTimer = setTimeout(() => syncUrl(), 400);
				}}
				placeholder="Search note, category, person, account…"
				aria-label="Search transactions"
				class="min-w-48 flex-1 sm:max-w-xs {field}"
			/>
			<select bind:value={filterKind} onchange={() => syncUrl()} aria-label="Type" class={field}>
				<option value="all">All types</option>
				{#each Object.entries(KIND_LABEL) as [k, label] (k)}
					<option value={k}>{label}</option>
				{/each}
			</select>
			<select
				bind:value={filterAccount}
				onchange={() => syncUrl()}
				aria-label="Account"
				class={field}
			>
				<option value="all">All accounts</option>
				{#each accounts as a (a.id)}
					<option value={a.id}>{a.name}</option>
				{/each}
			</select>
			<select
				bind:value={filterCategory}
				onchange={() => syncUrl()}
				aria-label="Category"
				class={field}
			>
				<option value="all">All categories</option>
				{#each allCategories as c (c)}
					<option value={c}>{c}</option>
				{/each}
			</select>
			{#if filtersActive}
				<span class="text-xs text-mute">{filtered.length} of {txns.length}</span>
				<button type="button" onclick={clearFilters} class="text-xs text-accent hover:underline">
					clear filters
				</button>
			{/if}
		</div>
	</section>
{/if}

<div class="mt-5 grid items-start gap-4 xl:grid-cols-2">
	<section class={card}>
		<CashFlowChart summaries={filteredSummaries} onselect={showMonth} />
	</section>

	<section class={card}>
		<CategoryBreakdown txns={filtered} selected={drill?.category} onselect={openCategory} />
	</section>

	<section class={card}>
		<SpendingPace txns={filtered} />
	</section>

	<section class={card}>
		<CategoryTrendChart txns={filtered} onselect={openCategory} />
	</section>

	<section class={card}>
		<h2 class="mb-3 text-xs font-semibold tracking-wide text-mute uppercase">
			Fixed expenses — {monthLabel(thisMonth)}
		</h2>
		<div class="mb-3 grid grid-cols-2 gap-2">
			<div class="rounded-ctl bg-tint px-3 py-2">
				<p class="text-[11px] text-faint">fixed (recurring)</p>
				<p class="text-sm font-semibold text-ink">{formatMoney(fixedSplit.fixed)}</p>
			</div>
			<div class="rounded-ctl bg-tint px-3 py-2">
				<p class="text-[11px] text-faint">variable</p>
				<p class="text-sm font-semibold text-ink">{formatMoney(fixedSplit.variable)}</p>
			</div>
		</div>
		{#if fixedSplit.fixed + fixedSplit.variable > 0}
			<div class="mb-3 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
				<span
					class="rounded-l-full"
					style:width="{(fixedSplit.fixed / (fixedSplit.fixed + fixedSplit.variable)) * 100}%"
					style:background="var(--t-cat-7)"
				></span>
				<span class="flex-1 rounded-r-full" style:background="var(--t-cat-1)"></span>
			</div>
		{/if}
		{#if fixedTxns.length > 0}
			<div class="space-y-1">
				{#each fixedTxns as t (t.id)}
					<p class="flex items-center justify-between gap-2 text-sm">
						<button
							type="button"
							onclick={() => openCategory(t.category, t.kind)}
							class="truncate text-mute hover:text-accent hover:underline"
						>
							{t.category}{t.note ? ` · ${t.note}` : ''}
						</button>
						<span class="text-ink tabular-nums">{formatMoney(t.amount)}</span>
					</p>
				{/each}
			</div>
		{:else}
			<p class="text-sm text-faint">
				Tick “fixed” when adding or editing an expense to track recurring bills here.
			</p>
		{/if}
	</section>

	<section class={card}>
		<div class="mb-3 flex flex-wrap items-baseline gap-x-3">
			<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">Owed</h2>
			<a href={resolve('/people')} class="ml-auto text-xs text-accent hover:underline">
				all people →
			</a>
		</div>
		{#if owed.length === 0}
			<p class="text-sm text-faint">
				All square — nobody owes you and you owe nobody. Record a Lend or Borrow to track a debt.
			</p>
		{:else}
			<ul class="divide-y divide-line">
				{#each owed as [handle, amount] (handle)}
					{@const expanded = expandedPeople.has(handle)}
					<li class="py-1.5">
						<div class="flex items-center gap-2 text-sm">
							<button
								type="button"
								onclick={() =>
									expanded ? expandedPeople.delete(handle) : expandedPeople.add(handle)}
								aria-expanded={expanded}
								class="flex min-w-0 flex-1 items-center gap-2 rounded-ctl py-0.5 text-left hover:bg-tint"
							>
								<span
									class="inline-block w-3 text-xs text-faint transition-transform {expanded
										? 'rotate-90'
										: ''}"
									aria-hidden="true">▸</span
								>
								<span class="font-medium text-accent">@{handle}</span>
								{#if personName(handle)}
									<span class="truncate text-faint">{personName(handle)}</span>
								{/if}
								<span class="ml-auto shrink-0 text-xs text-mute">
									{amount > 0 ? 'owes you' : 'you owe'}
								</span>
							</button>
							<span
								class="shrink-0 font-medium tabular-nums {amount > 0
									? 'text-amber-600 dark:text-amber-400'
									: 'text-violet-600 dark:text-violet-400'}"
							>
								{formatMoney(Math.abs(amount))}
							</span>
						</div>
						{#if expanded}
							{@const hist = personHistory(txns, handle)}
							<ol class="mt-1 mb-1 ml-5 space-y-0.5 border-l-2 border-line pl-3 text-xs">
								{#each hist.slice(-6).reverse() as { txn, balance: after } (txn.id)}
									<li class="flex items-baseline gap-2">
										<span class="w-12 shrink-0 text-faint tabular-nums">
											{SHORT_DAY.format(fromKey(txn.date))}
										</span>
										<span class="text-mute"
											>{txn.kind === 'lend' ? 'you lent' : 'you borrowed'}</span
										>
										{#if txn.note}<span class="truncate text-faint">· {txn.note}</span>{/if}
										<span class="ml-auto shrink-0 font-medium text-ink tabular-nums">
											{signedAmount(txn.kind, txn.amount)}
										</span>
										<span class="w-20 shrink-0 text-right text-faint tabular-nums">
											bal {formatMoney(after)}
										</span>
									</li>
								{/each}
							</ol>
							<p class="ml-5 flex gap-3 pl-3 text-xs">
								{#if hist.length > 6}<span class="text-faint">+{hist.length - 6} earlier</span>{/if}
								<a
									href="{resolve('/people/[handle]', { handle })}#money"
									class="text-accent hover:underline"
								>
									full history & settle up →
								</a>
							</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<section class="mt-8">
	<div class="mb-2 flex flex-wrap items-baseline gap-x-3">
		<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">Transactions</h2>
		{#if filtered.length > 0}
			<span class="text-xs text-faint">
				{filtered.length} in {monthsInList.length} month{monthsInList.length === 1 ? '' : 's'}
			</span>
			<span class="ml-auto flex gap-3 text-xs">
				<button
					type="button"
					onclick={() => monthsInList.forEach((m) => open.add(m))}
					class="text-accent hover:underline">expand all</button
				>
				<button type="button" onclick={() => open.clear()} class="text-accent hover:underline">
					collapse all
				</button>
			</span>
		{/if}
	</div>
	{#if txns.length === 0}
		<p class="rounded-card border border-dashed border-line p-6 text-center text-sm text-faint">
			Nothing yet — use “+ Add transaction” above, or the Finance panel on any day page.
		</p>
	{:else if filtered.length === 0}
		<p class="text-sm text-faint">
			No transactions match these filters.
			<button type="button" onclick={clearFilters} class="text-accent hover:underline">
				Clear filters
			</button>
		</p>
	{:else}
		<TransactionMonthGroups
			txns={filtered}
			{accounts}
			{people}
			{open}
			{suggest}
			onupdate={updateTxn}
			ondelete={removeTxn}
			onduplicate={duplicateTxn}
			oncategory={openCategory}
		/>
	{/if}
</section>

{#if drill}
	<Drawer onclose={closeCategory}>
		{@const d = drill}
		{#snippet title()}
			<p class="text-xs font-semibold tracking-wide text-faint uppercase">
				{drill.kind === 'income' ? 'Income' : 'Spending'} category
			</p>
			<h2 class="truncate font-display text-xl font-bold text-ink">{drill.category}</h2>
		{/snippet}
		<CategoryDetail
			category={drill.category}
			kind={drill.kind}
			txns={sorted}
			{accounts}
			{people}
			{suggest}
			onupdate={updateTxn}
			ondelete={removeTxn}
			onduplicate={duplicateTxn}
			onfilter={() => {
				filterCategory = d.category;
				filterKind = d.kind;
				syncUrl(true);
			}}
		/>
	</Drawer>
{/if}
