<script lang="ts">
	import { onMount } from 'svelte';
	import { session } from '$lib/auth.svelte';
	import { listTransactions, saveSettings, saveTransactions, type Transaction } from '$lib/db';
	import { manageableCategories, moveCategory, type CategoryKind } from '$lib/finance';
	import { settings } from '$lib/settings.svelte';
	import { saveFailed, toast } from '$lib/toast.svelte';

	const uid = session.user!.uid;

	const KINDS: [CategoryKind, string][] = [
		['expense', 'Expense'],
		['income', 'Income']
	];

	let txns: Transaction[] = $state([]);
	let loaded = $state(false);
	let loadError = $state(false);
	let kind: CategoryKind = $state('expense');

	onMount(() => {
		listTransactions(uid)
			.then((list) => (txns = list))
			.catch(() => (loadError = true))
			.finally(() => (loaded = true));
	});

	const rows = $derived(manageableCategories(txns, kind));

	// One row is open for editing at a time.
	let editing: { name: string; mode: 'rename' | 'merge' } | null = $state(null);
	let draft = $state('');

	function open(name: string, mode: 'rename' | 'merge') {
		editing = { name, mode };
		draft = mode === 'rename' ? name : '';
	}

	const plural = (n: number) => `${n} transaction${n === 1 ? '' : 's'}`;

	/** Files every `from` transaction under `to` and updates the lists; undoable. */
	function move(from: string, to: string, verb: string) {
		const k = kind;
		const before = {
			custom: [...settings.customCategories[k]],
			hidden: [...settings.hiddenCategories[k]]
		};
		const originals = txns.filter((t) => t.kind === k && t.category === from);
		const { changed, custom, hidden } = moveCategory(txns, k, from, to, before);
		apply(k, custom, hidden, changed);
		editing = null;
		const count = changed.length ? ` (${plural(changed.length)})` : '';
		toast(`${verb}${count}.`, {
			undo: () => apply(k, before.custom, before.hidden, originals)
		});
	}

	function apply(k: CategoryKind, custom: string[], hidden: string[], changed: Transaction[]) {
		settings.customCategories[k] = custom;
		settings.hiddenCategories[k] = hidden;
		saveSettings(uid, $state.snapshot(settings)).catch(saveFailed);
		if (!changed.length) return;
		const byId = new Map(changed.map((t) => [t.id, t]));
		txns = txns.map((t) => byId.get(t.id) ?? t);
		saveTransactions(uid, changed).catch(saveFailed);
	}

	function rename(from: string, count: number) {
		const to = draft.trim();
		if (!to || to === from) return (editing = null);
		const existing = rows.find((r) => r.name.toLowerCase() === to.toLowerCase() && r.name !== from);
		if (existing) {
			const ok =
				count === 0 ||
				confirm(`“${existing.name}” already exists. Merge ${plural(count)} into it?`);
			if (ok) move(from, existing.name, `Merged “${from}” into “${existing.name}”`);
			return;
		}
		move(from, to, `Renamed “${from}” to “${to}”`);
	}

	function merge(from: string, count: number) {
		const to = draft;
		if (!to) return;
		if (count > 0 && !confirm(`Move ${plural(count)} from “${from}” to “${to}”?`)) return;
		move(from, to, `Merged “${from}” into “${to}”`);
	}

	function remove(name: string, count: number) {
		if (count > 0 && !confirm(`Remove “${name}”? Its ${plural(count)} will move to “other”.`))
			return;
		move(name, 'other', `Removed “${name}”`);
	}

	const input = 'rounded-ctl border-line bg-card py-1 text-sm text-ink';
	const link = 'rounded-ctl px-1.5 py-0.5 text-xs text-mute hover:bg-tint hover:text-ink';
</script>

<section class="rounded-card border border-line bg-card p-4 shadow-card">
	<h2 class="mb-1 text-xs font-semibold tracking-wide text-mute uppercase">Finance categories</h2>
	<p class="mb-3 text-sm text-faint">
		Rename, merge or remove the categories in the income and expense dropdowns. Transactions filed
		under a category move with it.
	</p>

	<div class="mb-3 flex w-fit overflow-hidden rounded-ctl border border-line" role="group">
		{#each KINDS as [k, label] (k)}
			<button
				type="button"
				onclick={() => {
					kind = k;
					editing = null;
				}}
				aria-pressed={kind === k}
				class="border-r border-line px-3 py-1.5 text-xs font-medium last:border-r-0 {kind === k
					? 'bg-accent-fill text-on-accent'
					: 'bg-card text-mute hover:bg-tint'}"
			>
				{label}
			</button>
		{/each}
	</div>

	{#if !loaded}
		<p class="text-sm text-faint">Loading…</p>
	{:else if loadError}
		<p class="text-sm text-red-600 dark:text-red-400">
			Couldn’t load transactions — try again later.
		</p>
	{:else}
		<ul class="divide-y divide-line">
			{#each rows as row (row.name)}
				<li class="flex flex-wrap items-center gap-2 py-1.5 text-sm">
					{#if editing?.name === row.name && editing.mode === 'rename'}
						<form
							class="flex flex-1 flex-wrap items-center gap-1.5"
							onsubmit={(e) => {
								e.preventDefault();
								rename(row.name, row.count);
							}}
						>
							<input
								type="text"
								bind:value={draft}
								aria-label="New name for {row.name}"
								onkeydown={(e) => e.key === 'Escape' && (editing = null)}
								class="w-44 {input}"
							/>
							<button type="submit" class="{link} font-medium text-ink">Save</button>
							<button type="button" onclick={() => (editing = null)} class={link}>cancel</button>
						</form>
					{:else if editing?.name === row.name && editing.mode === 'merge'}
						<span class="text-ink">{row.name}</span>
						<span class="text-faint">→</span>
						<form
							class="flex flex-1 flex-wrap items-center gap-1.5"
							onsubmit={(e) => {
								e.preventDefault();
								merge(row.name, row.count);
							}}
						>
							<select bind:value={draft} aria-label="Merge {row.name} into" class={input}>
								<option value="" disabled>merge into…</option>
								{#each rows.filter((r) => r.name !== row.name) as r (r.name)}
									<option value={r.name}>{r.name}</option>
								{/each}
							</select>
							<button type="submit" disabled={!draft} class="{link} font-medium text-ink">
								Merge
							</button>
							<button type="button" onclick={() => (editing = null)} class={link}>cancel</button>
						</form>
					{:else}
						<span class="text-ink">{row.name}</span>
						<span class="text-xs text-faint tabular-nums">
							{row.count ? plural(row.count) : 'unused'}{row.preset ? ' · built-in' : ''}
						</span>
						{#if row.name !== 'other'}
							<span class="ml-auto flex gap-0.5">
								<button type="button" onclick={() => open(row.name, 'rename')} class={link}>
									Rename
								</button>
								<button type="button" onclick={() => open(row.name, 'merge')} class={link}>
									Merge
								</button>
								<button
									type="button"
									onclick={() => remove(row.name, row.count)}
									class="{link} hover:text-red-600 dark:hover:text-red-400"
								>
									Remove
								</button>
							</span>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
		<p class="mt-2 text-xs text-faint">
			Add new ones from the category dropdown when entering a transaction (“+ new category…”).
		</p>
	{/if}
</section>
