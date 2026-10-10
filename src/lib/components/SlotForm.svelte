<script lang="ts">
	import type { ScheduleSlot } from '$lib/db';
	import { EVENT_KINDS, WEEKDAYS } from '$lib/schedule';

	let {
		slot,
		onsave,
		oncancel
	}: {
		/** Starting values; the form edits a copy. */
		slot: ScheduleSlot;
		onsave: (slot: ScheduleSlot) => void;
		oncancel: () => void;
	} = $props();

	// The form edits its own copy; the drawer is recreated for every slot.
	// svelte-ignore state_referenced_locally
	let draft = $state({ ...slot, startsOn: slot.startsOn ?? '', endsOn: slot.endsOn ?? '' });

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!draft.title.trim()) return;
		onsave({
			...draft,
			weekday: Number(draft.weekday),
			title: draft.title.trim(),
			room: draft.room.trim(),
			startsOn: draft.startsOn || null,
			endsOn: draft.endsOn || null
		});
	}

	const field = 'w-full rounded-ctl border-line bg-card text-sm text-ink';
	const label = 'mb-1 block text-xs font-medium text-mute';
</script>

<form class="space-y-3" onsubmit={submit}>
	<label class="block">
		<span class={label}>Course / activity</span>
		<input
			type="text"
			bind:value={draft.title}
			required
			placeholder="e.g. Database Management Systems (CSE 202P)"
			class={field}
		/>
	</label>
	<div class="grid grid-cols-2 gap-3">
		<label class="block">
			<span class={label}>Day</span>
			<select bind:value={draft.weekday} class={field}>
				{#each WEEKDAYS as day, i (day)}
					<option value={i}>{day}</option>
				{/each}
			</select>
		</label>
		<label class="block">
			<span class={label}>Kind</span>
			<select bind:value={draft.kind} class={field}>
				{#each EVENT_KINDS as k (k.id)}
					<option value={k.id}>{k.label}</option>
				{/each}
			</select>
		</label>
		<label class="block">
			<span class={label}>Start</span>
			<input type="time" bind:value={draft.start} required class={field} />
		</label>
		<label class="block">
			<span class={label}>End</span>
			<input type="time" bind:value={draft.end} class={field} />
		</label>
		<label class="col-span-2 block">
			<span class={label}>Room</span>
			<input type="text" bind:value={draft.room} placeholder="e.g. 329" class={field} />
		</label>
		<label class="block">
			<span class={label}>Runs from <span class="font-normal text-faint">(optional)</span></span>
			<input type="date" bind:value={draft.startsOn} class={field} />
		</label>
		<label class="block">
			<span class={label}>Until <span class="font-normal text-faint">(optional)</span></span>
			<input type="date" bind:value={draft.endsOn} min={draft.startsOn} class={field} />
		</label>
	</div>
	<p class="text-xs text-faint">
		Changing a class here changes it on every week. Changes you made to single dates (done,
		cancelled, moved) stay as they are.
	</p>
	<div class="flex gap-2 pt-1">
		<button
			type="submit"
			class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
		>
			Save
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
