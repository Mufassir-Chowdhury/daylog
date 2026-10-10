<script lang="ts">
	import { resolve } from '$app/paths';
	import { session } from '$lib/auth.svelte';
	import { deletePerson } from '$lib/db';
	import { formatMoney, personStats } from '$lib/finance';
	import { toast } from '$lib/toast.svelte';

	let { data } = $props();

	const uid = session.user!.uid;

	// Overridable derived: refreshed by navigation, locally updated on delete.
	let people = $derived(data.people);
	let deleting: string | null = $state(null);
	let search = $state('');
	let show: 'all' | 'owes' | 'owed' = $state('all');

	const stats = $derived(personStats(data.txns));

	const visible = $derived.by(() => {
		const q = search.trim().toLowerCase().replace(/^@/, '');
		return people.filter((p) => {
			const net = stats.get(p.handle)?.net ?? 0;
			if (show === 'owes' && net <= 0) return false;
			if (show === 'owed' && net >= 0) return false;
			if (!q) return true;
			return (
				p.handle.includes(q) ||
				(p.name ?? '').toLowerCase().includes(q) ||
				(p.bio ?? '').toLowerCase().includes(q)
			);
		});
	});

	const owesCount = $derived([...stats.values()].filter((s) => s.net > 0).length);
	const owedCount = $derived([...stats.values()].filter((s) => s.net < 0).length);

	async function remove(handle: string) {
		const ok = confirm(
			`Delete @${handle}? Every mention of them will be replaced with the plain text “${handle}” (no link). Their transactions are kept.`
		);
		if (!ok) return;
		deleting = handle;
		try {
			await deletePerson(uid, handle);
			people = people.filter((p) => p.handle !== handle);
			toast(`Deleted @${handle}.`);
		} catch {
			toast(`Could not delete @${handle} — please try again.`, { tone: 'error' });
		} finally {
			deleting = null;
		}
	}

	const FILTERS = $derived([
		{ value: 'all' as const, label: `All ${people.length}` },
		{ value: 'owes' as const, label: `Owe you ${owesCount}` },
		{ value: 'owed' as const, label: `You owe ${owedCount}` }
	]);
</script>

<svelte:head>
	<title>People · daylog</title>
</svelte:head>

<h1 class="font-display text-2xl font-bold tracking-tight text-ink">People</h1>
<p class="mt-1 text-sm text-mute">
	Everyone you've <span class="font-mono">@mentioned</span>. Click through for their bio, money
	history and every note about them.
</p>

{#if people.length === 0}
	<p class="mt-6 text-sm text-faint">
		No one yet — mention someone in a day (e.g. <span class="font-mono">@rahim</span>) and press
		space to add them.
	</p>
{:else}
	<div class="mt-5 flex flex-wrap items-center gap-2">
		<input
			type="search"
			bind:value={search}
			placeholder="Search name, handle or bio…"
			aria-label="Search people"
			class="min-w-48 flex-1 rounded-ctl border-line bg-card py-1.5 text-sm text-ink sm:max-w-xs"
		/>
		<div class="flex overflow-hidden rounded-ctl border border-line text-xs">
			{#each FILTERS as f (f.value)}
				<button
					type="button"
					onclick={() => (show = f.value)}
					aria-pressed={show === f.value}
					class="border-r border-line px-2.5 py-1.5 last:border-r-0 {show === f.value
						? 'bg-accent-fill text-on-accent'
						: 'bg-card text-mute hover:bg-tint'}"
				>
					{f.label}
				</button>
			{/each}
		</div>
	</div>

	{#if visible.length === 0}
		<p class="mt-4 text-sm text-faint">Nobody matches.</p>
	{:else}
		<ul
			class="mt-3 divide-y divide-line overflow-hidden rounded-card border border-line bg-card shadow-card"
		>
			{#each visible as person (person.handle)}
				{@const s = stats.get(person.handle)}
				<li class="flex items-center">
					<a
						href={resolve('/people/[handle]', { handle: person.handle })}
						class="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-tint"
					>
						<span
							class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/10 font-display text-sm font-bold text-accent uppercase"
							aria-hidden="true"
						>
							{(person.name ?? person.handle).slice(0, 1)}
						</span>
						<span class="min-w-0 flex-1">
							<span class="font-medium text-accent">@{person.handle}</span>
							{#if person.name}
								<span class="ml-2 text-sm text-ink">{person.name}</span>
							{/if}
							{#if person.bio}
								<span class="mt-0.5 block truncate text-sm text-mute">
									{person.bio.split('\n')[0]}
								</span>
							{/if}
						</span>
						{#if s && s.net !== 0}
							<span
								class="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums {s.net >
								0
									? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
									: 'bg-violet-500/10 text-violet-700 dark:text-violet-300'}"
							>
								{s.net > 0 ? 'owes you' : 'you owe'}
								{formatMoney(Math.abs(s.net))}
							</span>
						{:else if s}
							<span class="shrink-0 text-xs text-faint">settled</span>
						{/if}
					</a>
					<button
						type="button"
						onclick={() => remove(person.handle)}
						disabled={deleting !== null}
						aria-label="Delete @{person.handle}"
						title="Delete — mentions become plain text"
						class="mx-2 rounded-ctl px-2.5 py-1.5 text-sm text-faint hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50 dark:hover:text-red-400"
					>
						{deleting === person.handle ? '…' : '✕'}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
{/if}
