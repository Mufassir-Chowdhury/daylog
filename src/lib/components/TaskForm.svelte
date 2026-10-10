<script lang="ts">
	import type { PlanTask } from '$lib/db';
	import type { TaskStatus } from '$lib/schedule';

	let {
		task,
		mode = 'edit',
		onsave,
		oncancel
	}: {
		/** Starting values; the form edits a copy. */
		task: PlanTask;
		/** `move` asks only for the new day. */
		mode?: 'edit' | 'move';
		onsave: (task: PlanTask) => void;
		oncancel: () => void;
	} = $props();

	// The form edits its own copy; the drawer is recreated for every task.
	// svelte-ignore state_referenced_locally
	let draft = $state({ ...task, date: task.date ?? '', until: task.until ?? '' });

	const STATUSES: { id: TaskStatus; label: string }[] = [
		{ id: 'open', label: 'Open' },
		{ id: 'done', label: 'Done' },
		{ id: 'dropped', label: 'Not needed' },
		{ id: 'moved', label: 'Moved' }
	];

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!draft.text.trim()) return;
		const date = draft.date || null;
		// A span needs a start day after which it ends; anything else is a single day.
		const until = date && draft.until && draft.until > date ? draft.until : null;
		onsave({ ...draft, text: draft.text.trim(), note: draft.note.trim(), date, until });
	}

	const field = 'w-full rounded-ctl border-line bg-card text-sm text-ink';
	const label = 'mb-1 block text-xs font-medium text-mute';
</script>

<form class="space-y-3" onsubmit={submit}>
	{#if mode === 'edit'}
		<label class="block">
			<span class={label}>Task</span>
			<input type="text" bind:value={draft.text} required class={field} />
		</label>
	{/if}

	<div class="grid grid-cols-2 gap-3">
		<label class="block">
			<span class={label}>Day <span class="font-normal text-faint">(empty = Later)</span></span>
			<input type="date" bind:value={draft.date} class={field} />
		</label>
		<label class="block">
			<span class={label}>Until <span class="font-normal text-faint">(for a span)</span></span>
			<input
				type="date"
				bind:value={draft.until}
				min={draft.date}
				disabled={!draft.date}
				class="{field} disabled:opacity-50"
			/>
		</label>
		{#if mode === 'edit'}
			<label class="block">
				<span class={label}>From</span>
				<input type="time" bind:value={draft.start} class={field} />
			</label>
			<label class="block">
				<span class={label}>To</span>
				<input type="time" bind:value={draft.end} class={field} />
			</label>
		{/if}
	</div>

	{#if mode === 'edit'}
		<div class="grid grid-cols-2 gap-3">
			<label class="block">
				<span class={label}>Status</span>
				<select bind:value={draft.status} class={field}>
					{#each STATUSES as s (s.id)}
						<option value={s.id}>{s.label}</option>
					{/each}
				</select>
			</label>
			<label class="flex items-end gap-2 pb-2 text-sm text-ink">
				<input
					type="checkbox"
					bind:checked={draft.highlight}
					class="rounded border-line bg-card text-accent-fill"
				/>
				Protected block
			</label>
		</div>
		<label class="block">
			<span class={label}>Note</span>
			<input
				type="text"
				bind:value={draft.note}
				placeholder="e.g. Almost done · Not needed — exam postponed"
				class={field}
			/>
		</label>
		<p class="text-xs text-faint">
			Protected blocks (thesis time, a paid-work block) are highlighted so they're hard to give
			away.
		</p>
	{:else}
		<p class="text-xs text-faint">
			The task stays on its old day, crossed out with a note saying where it went.
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
