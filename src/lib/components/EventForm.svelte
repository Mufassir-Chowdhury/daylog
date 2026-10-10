<script lang="ts">
	import type { ScheduleEvent } from '$lib/db';
	import { EVENT_KINDS, type EventStatus } from '$lib/schedule';

	let {
		event,
		mode = 'edit',
		onsave,
		oncancel
	}: {
		/** Starting values; the form edits a copy. */
		event: ScheduleEvent;
		/** `move` asks only where and when it goes. */
		mode?: 'edit' | 'move';
		onsave: (event: ScheduleEvent) => void;
		oncancel: () => void;
	} = $props();

	// The form edits its own copy; the drawer is recreated for every event.
	// svelte-ignore state_referenced_locally
	let draft = $state({ ...event });
	// svelte-ignore state_referenced_locally
	let tbd = $state(mode === 'edit' && event.date === null);
	// svelte-ignore state_referenced_locally
	let dateValue = $state(event.date ?? '');

	const STATUSES: { id: EventStatus; label: string }[] = [
		{ id: 'planned', label: 'Planned' },
		{ id: 'done', label: 'Done' },
		{ id: 'cancelled', label: 'Cancelled' },
		{ id: 'moved', label: 'Moved' }
	];

	const timetabled = $derived(event.slotId !== null && mode === 'edit');

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (mode === 'edit' && !draft.title.trim()) return;
		const date = tbd ? null : dateValue || null;
		if (mode === 'move' && !date) return;
		onsave({
			...draft,
			title: draft.title.trim(),
			room: draft.room.trim(),
			note: draft.note.trim(),
			date
		});
	}

	const field = 'w-full rounded-ctl border-line bg-card text-sm text-ink';
	const label = 'mb-1 block text-xs font-medium text-mute';
</script>

<form class="space-y-3" onsubmit={submit}>
	{#if mode === 'edit'}
		<label class="block">
			<span class={label}>Activity</span>
			<input type="text" bind:value={draft.title} required class={field} />
		</label>
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class={label}>Kind</span>
				<select bind:value={draft.kind} class={field}>
					{#each EVENT_KINDS as k (k.id)}
						<option value={k.id}>{k.label}</option>
					{/each}
				</select>
			</label>
			<label class="block">
				<span class={label}>Status</span>
				<select bind:value={draft.status} class={field}>
					{#each STATUSES as s (s.id)}
						<option value={s.id}>{s.label}</option>
					{/each}
				</select>
			</label>
		</div>
	{/if}

	<div class="grid grid-cols-2 gap-3">
		<label class="col-span-2 block sm:col-span-1">
			<span class={label}>Date</span>
			<input
				type="date"
				bind:value={dateValue}
				disabled={tbd || timetabled}
				required={!tbd}
				class="{field} disabled:opacity-50"
			/>
		</label>
		{#if mode === 'edit' && !timetabled}
			<label class="col-span-2 flex items-end gap-2 pb-2 text-sm text-ink sm:col-span-1">
				<input
					type="checkbox"
					bind:checked={tbd}
					class="rounded border-line bg-card text-accent-fill"
				/>
				Date not fixed yet (TBD)
			</label>
		{/if}
		<label class="block">
			<span class={label}>Start</span>
			<input type="time" bind:value={draft.start} class={field} />
		</label>
		<label class="block">
			<span class={label}>End</span>
			<input type="time" bind:value={draft.end} class={field} />
		</label>
		<label class="col-span-2 block">
			<span class={label}>Room</span>
			<input type="text" bind:value={draft.room} placeholder="e.g. 304 or 629, 729" class={field} />
		</label>
	</div>

	{#if mode === 'edit'}
		<label class="block">
			<span class={label}>Note</span>
			<input
				type="text"
				bind:value={draft.note}
				placeholder="e.g. shifted from Wednesday · requested by students"
				class={field}
			/>
		</label>
		{#if timetabled}
			<p class="text-xs text-faint">
				This changes only this date's class. To change it every week, edit the weekly timetable. To
				put it on another day, use Move.
			</p>
		{/if}
	{:else}
		<p class="text-xs text-faint">
			The original stays on the schedule, crossed out, with a note saying where it went.
		</p>
	{/if}

	<div class="flex gap-2 pt-1">
		<button
			type="submit"
			class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
		>
			{mode === 'move' ? 'Move' : 'Save'}
		</button>
		<button
			type="button"
			onclick={oncancel}
			class="rounded-ctl px-3 py-1.5 text-sm text-mute hover:bg-tint"
		>
			Cancel
		</button>
	</div>
</form>
