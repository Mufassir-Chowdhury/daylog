<script lang="ts">
	import type { Deadline } from '$lib/db';

	let {
		deadline,
		onsave,
		oncancel
	}: {
		/** Starting values; the form edits a copy. */
		deadline: Deadline;
		onsave: (deadline: Deadline) => void;
		oncancel: () => void;
	} = $props();

	// The form edits its own copy; the drawer is recreated for every deadline.
	// svelte-ignore state_referenced_locally
	let draft = $state({ ...deadline, due: deadline.due ?? '' });

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!draft.text.trim()) return;
		onsave({
			...draft,
			text: draft.text.trim(),
			label: draft.label.trim(),
			note: draft.note.trim(),
			due: draft.due || null
		});
	}

	const field = 'w-full rounded-ctl border-line bg-card text-sm text-ink';
	const label = 'mb-1 block text-xs font-medium text-mute';
</script>

<form class="space-y-3" onsubmit={submit}>
	<label class="block">
		<span class={label}>Deadline</span>
		<input
			type="text"
			bind:value={draft.text}
			required
			placeholder="e.g. Own Masters thesis completed"
			class={field}
		/>
	</label>
	<div class="grid grid-cols-2 gap-3">
		<label class="block">
			<span class={label}>Due <span class="font-normal text-faint">(earliest day)</span></span>
			<input type="date" bind:value={draft.due} class={field} />
		</label>
		<label class="block">
			<span class={label}>Shown as <span class="font-normal text-faint">(optional)</span></span>
			<input type="text" bind:value={draft.label} placeholder="Oct 24 / 25 / 26" class={field} />
		</label>
	</div>
	<label class="block">
		<span class={label}>Note</span>
		<input
			type="text"
			bind:value={draft.note}
			placeholder="e.g. questions to be made next week"
			class={field}
		/>
	</label>
	<div class="flex flex-wrap gap-4">
		<label class="flex items-center gap-2 text-sm text-ink">
			<input
				type="checkbox"
				bind:checked={draft.hard}
				class="rounded border-line bg-card text-accent-fill"
			/>
			Hard deadline
		</label>
		<label class="flex items-center gap-2 text-sm text-ink">
			<input
				type="checkbox"
				bind:checked={draft.done}
				class="rounded border-line bg-card text-accent-fill"
			/>
			Done
		</label>
	</div>
	<p class="text-xs text-faint">
		Leave Due empty when the date isn't fixed yet — it shows as TBD, or as whatever you write in
		"Shown as" (e.g. November).
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
