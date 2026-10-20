<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { session } from '$lib/auth.svelte';
	import LineView from '$lib/components/LineView.svelte';
	import {
		deleteTransaction,
		newTransactionId,
		savePerson,
		saveTransaction,
		type Transaction
	} from '$lib/db';
	import { dateKey, fromKey, humanDate, isValidKey } from '$lib/date';
	import { formatMoney, personHistory, personStats, signedAmount } from '$lib/finance';
	import { linesMentioning } from '$lib/parse';
	import { loadTxnPrefs } from '$lib/prefs';
	import { settings } from '$lib/settings.svelte';
	import { saveFailed, toast } from '$lib/toast.svelte';

	let { data } = $props();

	const uid = session.user!.uid;
	const handle = $derived(data.handle);

	// Overridable deriveds: reset on navigation, editable in place.
	let name = $derived(data.person.name ?? '');
	let bio = $derived(data.person.bio ?? '');
	let txns = $derived(data.txns);
	const accounts = $derived(data.accounts);

	let saveState: 'saved' | 'pending' | 'error' = $state('saved');
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let pending: { handle: string; name: string; bio: string } | null = null;

	function onInput() {
		pending = { handle, name, bio };
		saveState = 'pending';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(flush, 600);
	}

	function flush() {
		clearTimeout(saveTimer);
		if (!pending) return;
		savePerson(uid, pending).catch(() => {
			saveState = 'error';
			saveFailed();
		});
		pending = null;
		saveState = 'saved';
	}

	beforeNavigate(flush);

	// ——— Money: everything lent to / borrowed from this person.
	const stats = $derived(personStats(txns).get(handle));
	const net = $derived(stats?.net ?? 0);
	/** Newest first, each with the balance right after it. */
	const history = $derived(personHistory(txns, handle).reverse());

	const accountName = (id: string | null) =>
		id === null ? '' : (accounts.find((a) => a.id === id)?.name ?? '(deleted account)');

	// Settle-up / record form. Defaults to whatever squares the balance.
	const prefs = loadTxnPrefs();
	let formKind: 'lend' | 'borrow' | null = $state(null);
	let formAmount = $state('');
	let formAccount = $state('');
	let formDate = $state(dateKey());
	let formNote = $state('');
	let formError = $state('');

	function openForm(kind: 'lend' | 'borrow', amount?: number) {
		formKind = kind;
		formAmount = amount ? String(amount) : '';
		const preferred = kind === 'lend' ? prefs.from : prefs.to;
		formAccount = accounts.some((a) => a.id === preferred) ? preferred : (accounts[0]?.id ?? '');
		formDate = dateKey();
		formNote = amount ? 'settle up' : '';
		formError = '';
	}

	function submitForm() {
		const value = Number(formAmount);
		if (!formKind) return;
		if (!value || value <= 0) return (formError = 'Enter an amount above 0.');
		if (!formAccount) return (formError = 'Pick an account.');
		if (!isValidKey(formDate)) return (formError = 'Pick a date.');
		const txn: Transaction = {
			id: newTransactionId(uid),
			date: formDate,
			kind: formKind,
			category: formKind,
			amount: value,
			from: formKind === 'lend' ? formAccount : null,
			to: formKind === 'borrow' ? formAccount : null,
			person: handle,
			note: formNote.trim(),
			fixed: false,
			group: null,
			createdAt: Date.now()
		};
		txns = [txn, ...txns];
		saveTransaction(uid, txn).catch(saveFailed);
		toast(`Recorded ${formKind === 'lend' ? 'lending' : 'borrowing'} ${formatMoney(value)}.`);
		formKind = null;
	}

	function removeTxn(txn: Transaction) {
		txns = txns.filter((t) => t.id !== txn.id);
		deleteTransaction(uid, txn.id).catch(saveFailed);
		toast(`Deleted ${txn.kind} of ${formatMoney(txn.amount)}.`, {
			undo: () => {
				txns = [...txns, txn];
				saveTransaction(uid, txn).catch(saveFailed);
			}
		});
	}

	const SHORT = new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		year: 'numeric'
	});
	const field = 'rounded-ctl border-line bg-card py-1.5 text-sm text-ink';
</script>

<svelte:head>
	<title>@{handle} · daylog</title>
</svelte:head>

<svelte:window onvisibilitychange={() => document.hidden && flush()} />

<a href={resolve('/people')} class="text-sm text-mute hover:text-ink">← People</a>
<div class="mt-2 flex flex-wrap items-baseline gap-3">
	<h1 class="font-display text-2xl font-bold tracking-tight text-accent">@{handle}</h1>
	{#if name}<span class="text-lg text-ink">{name}</span>{/if}
	<span class="text-xs text-faint">
		{#if saveState === 'error'}
			<span class="text-red-500 dark:text-red-400">save failed</span>
		{:else}
			{saveState === 'saved' ? 'saved' : '…'}
		{/if}
	</span>
	{#if net !== 0}
		<span
			class="ml-auto rounded-full px-3 py-1 text-sm font-medium {net > 0
				? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
				: 'bg-violet-500/10 text-violet-700 dark:text-violet-300'}"
		>
			{net > 0 ? 'owes you' : 'you owe'}
			{formatMoney(Math.abs(net))}
		</span>
	{/if}
</div>

<div class="mt-4 grid items-start gap-5 xl:grid-cols-2">
	<div class="min-w-0 space-y-5">
		<div class="space-y-3 rounded-card border border-line bg-card p-4 shadow-card">
			<label class="block">
				<span class="text-xs font-semibold tracking-wide text-mute uppercase">Name</span>
				<input
					type="text"
					bind:value={name}
					oninput={onInput}
					placeholder="Full name"
					class="mt-1 w-full rounded-ctl border-line bg-card text-sm text-ink"
				/>
			</label>
			<label class="block">
				<span class="text-xs font-semibold tracking-wide text-mute uppercase">Bio / notes</span>
				<textarea
					bind:value={bio}
					oninput={onInput}
					rows={Math.max(4, bio.split('\n').length + 1)}
					placeholder="Anything worth remembering about this person.
Append a line each time you learn something new — over time this becomes their bio."
					class="mt-1 w-full rounded-ctl border-line bg-card font-mono text-sm leading-relaxed text-ink"
				></textarea>
			</label>
		</div>

		<section
			id="money"
			class="scroll-mt-20 rounded-card border border-line bg-card p-4 shadow-card"
		>
			<h2
				class="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-emerald-600 uppercase dark:text-emerald-400"
			>
				<span class="h-1.5 w-1.5 rounded-full bg-current"></span>
				Money
			</h2>

			<p class="text-lg font-semibold text-ink">
				{#if !stats}
					No lending or borrowing with @{handle} yet.
				{:else if net > 0}
					@{handle} owes you
					<span class="text-amber-600 dark:text-amber-400">{formatMoney(net)}</span>
				{:else if net < 0}
					You owe @{handle}
					<span class="text-violet-600 dark:text-violet-400">{formatMoney(-net)}</span>
				{:else}
					All settled with @{handle} ✓
				{/if}
			</p>

			{#if stats}
				<dl class="mt-3 grid grid-cols-3 gap-2">
					<div class="rounded-ctl bg-tint px-3 py-2">
						<dt class="text-[11px] text-faint">You lent</dt>
						<dd class="text-sm font-semibold text-ink">{formatMoney(stats.lent)}</dd>
					</div>
					<div class="rounded-ctl bg-tint px-3 py-2">
						<dt class="text-[11px] text-faint">You borrowed</dt>
						<dd class="text-sm font-semibold text-ink">{formatMoney(stats.borrowed)}</dd>
					</div>
					<div class="rounded-ctl bg-tint px-3 py-2">
						<dt class="text-[11px] text-faint">Last activity</dt>
						<dd class="text-sm font-semibold text-ink">{SHORT.format(fromKey(stats.last))}</dd>
					</div>
				</dl>
			{/if}

			{#if accounts.length === 0}
				<p class="mt-3 text-sm text-faint">
					Add an account on the <a href={resolve('/finance')} class="text-accent hover:underline"
						>Finance page</a
					> to record lending and borrowing.
				</p>
			{:else if formKind === null}
				<div class="mt-3 flex flex-wrap gap-2">
					{#if net !== 0}
						<button
							type="button"
							onclick={() => openForm(net > 0 ? 'borrow' : 'lend', Math.abs(net))}
							class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
						>
							{net > 0 ? `They paid back ${formatMoney(net)}` : `Pay back ${formatMoney(-net)}`}
						</button>
					{/if}
					<button
						type="button"
						onclick={() => openForm('lend')}
						class="rounded-ctl border border-line px-3 py-1.5 text-sm text-mute hover:bg-tint hover:text-ink"
					>
						+ Lend
					</button>
					<button
						type="button"
						onclick={() => openForm('borrow')}
						class="rounded-ctl border border-line px-3 py-1.5 text-sm text-mute hover:bg-tint hover:text-ink"
					>
						+ Borrow
					</button>
				</div>
			{:else}
				<form
					class="mt-3 flex flex-wrap items-end gap-2 rounded-ctl bg-tint p-3"
					onsubmit={(e) => {
						e.preventDefault();
						submitForm();
					}}
				>
					<p class="w-full text-xs text-mute">
						{formKind === 'lend'
							? `Money you hand to @${handle} — out of your account.`
							: `Money @${handle} hands you — into your account.`}
					</p>
					<label class="flex flex-col gap-0.5 text-xs text-mute">
						Amount ({settings.currency})
						<input
							type="number"
							min="0"
							step="any"
							inputmode="decimal"
							bind:value={formAmount}
							class="w-28 {field}"
						/>
					</label>
					<label class="flex flex-col gap-0.5 text-xs text-mute">
						{formKind === 'lend' ? 'From' : 'Into'}
						<select bind:value={formAccount} class={field}>
							{#each accounts as a (a.id)}
								<option value={a.id}>{a.name}</option>
							{/each}
						</select>
					</label>
					<label class="flex flex-col gap-0.5 text-xs text-mute">
						Date
						<input type="date" bind:value={formDate} class={field} />
					</label>
					<label class="flex min-w-32 flex-1 flex-col gap-0.5 text-xs text-mute">
						Note
						<input type="text" bind:value={formNote} class={field} />
					</label>
					<button
						type="submit"
						class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
					>
						Record {formKind}
					</button>
					<button
						type="button"
						onclick={() => (formKind = null)}
						class="rounded-ctl px-2 py-1.5 text-sm text-mute hover:bg-card"
					>
						cancel
					</button>
					{#if formError}
						<p class="w-full text-xs text-red-600 dark:text-red-400">{formError}</p>
					{/if}
				</form>
			{/if}

			{#if history.length > 0}
				<h3 class="mt-5 mb-1 text-xs font-semibold tracking-wide text-mute uppercase">History</h3>
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead class="text-xs text-faint">
							<tr class="[&>th]:px-1.5 [&>th]:py-1 [&>th]:text-left [&>th]:font-medium">
								<th>Date</th>
								<th>What</th>
								<th class="!text-right">Amount</th>
								<th class="!text-right">Balance</th>
								<th><span class="sr-only">Actions</span></th>
							</tr>
						</thead>
						<tbody>
							{#each history as { txn, balance } (txn.id)}
								<tr class="group border-t border-line [&>td]:px-1.5 [&>td]:py-1.5">
									<td class="whitespace-nowrap">
										<a
											href={resolve('/day/[date]', { date: txn.date })}
											class="text-xs text-faint tabular-nums hover:text-accent hover:underline"
										>
											{SHORT.format(fromKey(txn.date))}
										</a>
									</td>
									<td class="min-w-0 text-mute">
										{txn.kind === 'lend' ? 'You lent' : 'You borrowed'}
										<span class="text-faint">
											· {txn.kind === 'lend' ? 'from' : 'into'}
											{accountName(txn.kind === 'lend' ? txn.from : txn.to)}{txn.note
												? ` · ${txn.note}`
												: ''}
										</span>
									</td>
									<td
										class="text-right font-medium whitespace-nowrap tabular-nums {txn.kind ===
										'lend'
											? 'text-amber-600 dark:text-amber-400'
											: 'text-violet-600 dark:text-violet-400'}"
									>
										{signedAmount(txn.kind, txn.amount)}
									</td>
									<td class="text-right text-xs whitespace-nowrap text-mute tabular-nums">
										{#if balance === 0}
											settled
										{:else}
											{balance > 0 ? 'owes' : 'you owe'} {formatMoney(Math.abs(balance))}
										{/if}
									</td>
									<td class="text-right">
										<button
											type="button"
											onclick={() => removeTxn(txn)}
											aria-label="Delete this {txn.kind}"
											class="reveal rounded px-1 text-xs text-faint group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
											>×</button
										>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	</div>

	<div class="min-w-0">
		<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">
			Mentioned in {data.days.length} day{data.days.length === 1 ? '' : 's'}
		</h2>
		{#if data.days.length === 0}
			<p class="mt-2 text-sm text-faint">
				No mentions yet. Write <span class="font-mono">@{handle}</span> in any day and it will appear
				here.
			</p>
		{:else}
			<div class="mt-2 space-y-3">
				{#each data.days as day (day.date)}
					<section class="rounded-card border border-line bg-card p-4 shadow-card">
						<a
							href={resolve('/day/[date]', { date: day.date })}
							class="text-sm font-medium text-accent hover:underline"
						>
							{humanDate(day.date)}
						</a>
						<div class="mt-1 space-y-1">
							{#each linesMentioning(day.text, handle) as line, i (i)}
								<LineView {line} />
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{/if}
	</div>
</div>
