<script lang="ts">
	import { beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { session } from '$lib/auth.svelte';
	import LineView from '$lib/components/LineView.svelte';
	import { savePerson } from '$lib/db';
	import { humanDate } from '$lib/date';
	import { linesMentioning } from '$lib/parse';

	let { data } = $props();

	const uid = session.user!.uid;
	const handle = $derived(data.handle);

	// Overridable deriveds: reset on navigation, editable in place.
	let name = $derived(data.person.name ?? '');
	let bio = $derived(data.person.bio ?? '');

	let saveState: 'saved' | 'pending' = $state('saved');
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
		savePerson(uid, pending);
		pending = null;
		saveState = 'saved';
	}

	beforeNavigate(flush);
</script>

<svelte:window onvisibilitychange={() => document.hidden && flush()} />

<div class="flex items-baseline gap-3">
	<h1 class="text-xl font-bold text-blue-600">@{handle}</h1>
	<span class="text-xs text-gray-400">{saveState === 'saved' ? 'saved' : '…'}</span>
</div>

<div class="mt-4 space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
	<label class="block">
		<span class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Name</span>
		<input
			type="text"
			bind:value={name}
			oninput={onInput}
			placeholder="Full name"
			class="mt-1 w-full rounded-lg border-gray-300 text-sm"
		/>
	</label>
	<label class="block">
		<span class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Bio / notes</span>
		<textarea
			bind:value={bio}
			oninput={onInput}
			rows={Math.max(4, bio.split('\n').length + 1)}
			placeholder="Anything worth remembering about this person.
Append a line each time you learn something new — over time this becomes their bio."
			class="mt-1 w-full rounded-lg border-gray-300 font-mono text-sm leading-relaxed"></textarea>
	</label>
</div>

<h2 class="mt-8 text-sm font-semibold tracking-wide text-gray-500 uppercase">Mentioned in</h2>
{#if data.days.length === 0}
	<p class="mt-2 text-sm text-gray-400">
		No mentions yet. Write <span class="font-mono">@{handle}</span> in any day and it will appear here.
	</p>
{:else}
	<div class="mt-2 space-y-4">
		{#each data.days as day (day.date)}
			<section class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
				<a
					href={resolve('/day/[date]', { date: day.date })}
					class="text-sm font-medium text-blue-600 hover:underline"
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
