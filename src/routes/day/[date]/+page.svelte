<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { session } from '$lib/auth.svelte';
	import LineView from '$lib/components/LineView.svelte';
	import MentionEditor from '$lib/components/MentionEditor.svelte';
	import NewNotePanel from '$lib/components/NewNotePanel.svelte';
	import { saveDay, savePerson } from '$lib/db';
	import { addDays, dateKey, humanDate, relativeLabel } from '$lib/date';
	import { parseDay } from '$lib/parse';

	let { data } = $props();

	const uid = session.user!.uid;
	const date = $derived(data.date);

	// Overridable deriveds: reset when navigating to another day, but locally
	// reassignable in between (typing, adding a person from the editor).
	let text = $derived(data.text);
	let people = $derived(data.people);

	const parsed = $derived(parseDay(text));

	let saveState: 'saved' | 'pending' | 'error' = $state('saved');
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let pending: { key: string; text: string } | null = null;

	function onInput() {
		pending = { key: date, text };
		saveState = 'pending';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(flush, 600);
	}

	function flush() {
		clearTimeout(saveTimer);
		if (!pending) return;
		const { key, text: value } = pending;
		pending = null;
		// Firestore's persistent cache makes writes durable immediately, even offline,
		// so we don't block the UI on server acknowledgement.
		saveDay(uid, key, value).catch(() => {
			saveState = 'error';
		});
		saveState = 'saved';
	}

	// A mention was committed in the editor for someone new — this is the only
	// path that creates a person doc.
	function addPerson(handle: string) {
		people = [...people, { handle }].sort((a, b) => a.handle.localeCompare(b.handle));
		savePerson(uid, { handle }).catch(() => {
			saveState = 'error';
		});
	}

	beforeNavigate(flush);

	const dayHref = (key: string) => resolve('/day/[date]', { date: key });
</script>

<svelte:window onvisibilitychange={() => document.hidden && flush()} />

<div class="mb-6 flex flex-wrap items-center gap-2">
	<a
		href={dayHref(addDays(date, -1))}
		class="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm hover:bg-gray-100"
		aria-label="Previous day">←</a
	>
	<input
		type="date"
		value={date}
		onchange={(e) => e.currentTarget.value && goto(dayHref(e.currentTarget.value))}
		class="rounded-lg border-gray-300 text-sm"
		aria-label="Pick a date"
	/>
	<a
		href={dayHref(addDays(date, 1))}
		class="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm hover:bg-gray-100"
		aria-label="Next day">→</a
	>
	{#if date !== dateKey()}
		<a href={dayHref(dateKey())} class="text-sm font-medium text-blue-600 hover:underline">Today</a>
	{:else}
		<a href={dayHref(addDays(date, 1))} class="text-sm font-medium text-blue-600 hover:underline">
			+ Next day
		</a>
	{/if}
	<span class="ml-auto text-xs text-gray-400">
		{#if saveState === 'error'}
			<span class="text-red-500">save failed — will retry on next edit</span>
		{:else if saveState === 'pending'}
			…
		{:else}
			saved
		{/if}
	</span>
</div>

<h1 class="text-xl font-bold text-gray-900">
	{humanDate(date)}
	{#if relativeLabel(date)}
		<span class="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
			{relativeLabel(date)}
		</span>
	{/if}
</h1>

<div class="mt-4">
	<NewNotePanel {uid} />
</div>

<div class="mt-4 space-y-4">
	{#if parsed.timed.length > 0}
		<section class="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
			<h2 class="mb-2 text-xs font-semibold tracking-wide text-amber-700 uppercase">Schedule</h2>
			<div class="space-y-1">
				{#each parsed.timed as line, i (i)}
					<LineView {line} />
				{/each}
			</div>
		</section>
	{/if}
	<div>
		<MentionEditor
			bind:value={text}
			{people}
			oninput={onInput}
			onnewperson={addPerson}
			placeholder="Just type. One thought per line.

09:00PM call @mom
ask @rahim about the invoice
buy milk"
		/>
		<p class="mt-2 text-xs text-gray-400">
			Start a line with a time (<code>09:00PM</code>) to pin it to the schedule · type
			<code>@</code> to mention someone — space or enter adds new people
		</p>
	</div>
</div>
