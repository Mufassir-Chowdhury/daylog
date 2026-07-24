<script lang="ts">
	import { beforeNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { session } from '$lib/auth.svelte';
	import FinancePanel from '$lib/components/FinancePanel.svelte';
	import LineView from '$lib/components/LineView.svelte';
	import LongTermPanel from '$lib/components/LongTermPanel.svelte';
	import MentionEditor from '$lib/components/MentionEditor.svelte';
	import NewNotePanel from '$lib/components/NewNotePanel.svelte';
	import RoutinePanel from '$lib/components/RoutinePanel.svelte';
	import { saveDay, savePerson } from '$lib/db';
	import { addDays, dateKey, humanDate, relativeLabel } from '$lib/date';
	import { parseDay, toggleDone } from '$lib/parse';
	import { settings } from '$lib/settings.svelte';

	let { data } = $props();

	const uid = session.user!.uid;
	const date = $derived(data.date);

	// Overridable deriveds: reset when navigating to another day, but locally
	// reassignable in between (typing, adding a person from the editor).
	let text = $derived(data.text);
	let people = $derived(data.people);
	let longTerm = $derived(data.longTerm);
	let accounts = $derived(data.accounts);
	let txns = $derived(data.txns);
	let routines = $derived(data.routines);
	let routineValues = $derived(data.routineValues);

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

	// Crosses a schedule line out (or back in) by rewriting its raw line in the text.
	function toggleLine(raw: string) {
		const lines = text.split('\n');
		const i = lines.indexOf(raw);
		if (i === -1) return;
		lines[i] = toggleDone(lines[i]);
		text = lines.join('\n');
		onInput();
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

<div
	class="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card border border-line bg-card px-4 py-3 shadow-card"
>
	<h1 class="font-display text-lg font-bold tracking-tight text-ink sm:text-xl">
		{humanDate(date)}
		{#if relativeLabel(date)}
			<span
				class="ml-2 rounded-full bg-accent/10 px-2.5 py-0.5 align-middle text-xs font-medium text-accent"
			>
				{relativeLabel(date)}
			</span>
		{/if}
	</h1>
	<div class="ml-auto flex flex-wrap items-center gap-2">
		<span class="mr-1 text-xs text-faint">
			{#if saveState === 'error'}
				<span class="text-red-500 dark:text-red-400">save failed — will retry on next edit</span>
			{:else if saveState === 'pending'}
				…
			{:else}
				saved
			{/if}
		</span>
		{#if date !== dateKey()}
			<a href={dayHref(dateKey())} class="text-sm font-medium text-accent hover:underline">Today</a>
		{:else}
			<a href={dayHref(addDays(date, 1))} class="text-sm font-medium text-accent hover:underline">
				+ Next day
			</a>
		{/if}
		<a
			href={dayHref(addDays(date, -1))}
			class="rounded-ctl border border-line bg-card px-2.5 py-1.5 text-sm text-mute hover:bg-tint hover:text-ink"
			aria-label="Previous day">←</a
		>
		<input
			type="date"
			value={date}
			onchange={(e) => e.currentTarget.value && goto(dayHref(e.currentTarget.value))}
			class="rounded-ctl border-line bg-card text-sm text-ink"
			aria-label="Pick a date"
		/>
		<a
			href={dayHref(addDays(date, 1))}
			class="rounded-ctl border border-line bg-card px-2.5 py-1.5 text-sm text-mute hover:bg-tint hover:text-ink"
			aria-label="Next day">→</a
		>
	</div>
</div>

<div class="grid items-start gap-5 xl:grid-cols-3">
	<div class="min-w-0 space-y-5 xl:col-span-2">
		{#if parsed.timed.length > 0}
			<section class="rounded-card border border-line bg-card p-4 shadow-card">
				<h2
					class="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400"
				>
					<span class="h-1.5 w-1.5 rounded-full bg-current"></span>
					Schedule
				</h2>
				<div class="space-y-1">
					{#each parsed.timed as line, i (i)}
						<LineView {line} ontoggle={() => toggleLine(line.raw)} />
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
			<p class="mt-2 text-xs text-faint">
				Start a line with a time (<code>09:00PM</code>) to pin it to the schedule · type
				<code>@</code> to mention someone — space or enter adds new people · wrap a line in
				<code>~~tildes~~</code> (or press <kbd>Ctrl</kbd>+<kbd>Enter</kbd>) to cross it out
			</p>
		</div>
		{#if settings.showFinancePanel}
			<FinancePanel {uid} {date} {people} onnewperson={addPerson} bind:accounts bind:txns />
		{/if}
	</div>
	<div class="min-w-0 space-y-5">
		{#if settings.showNotePanel}
			<NewNotePanel {uid} />
		{/if}
		{#if settings.showLongTermPanel}
			<LongTermPanel {uid} {date} bind:tasks={longTerm} />
		{/if}
		{#if settings.showRoutinePanel}
			<RoutinePanel {uid} {date} bind:routines bind:values={routineValues} />
		{/if}
	</div>
</div>
