<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		deleteRoutine,
		newRoutineId,
		saveRoutine,
		saveRoutineValue,
		type Routine
	} from '$lib/db';

	let {
		uid,
		date,
		routines = $bindable(),
		values = $bindable()
	}: {
		uid: string;
		date: string;
		routines: Routine[];
		/** This day's logged value per routine id. */
		values: Record<string, number>;
	} = $props();

	let error = $state(false);
	let adding = $state(false);
	let editingId: string | null = $state(null);
	let name = $state('');
	let unit = $state('');
	let threshold = $state('');

	function startAdd() {
		adding = true;
		editingId = null;
		name = '';
		unit = '';
		threshold = '';
	}

	function startEdit(routine: Routine) {
		editingId = routine.id;
		adding = false;
		name = routine.name;
		unit = routine.unit;
		threshold = routine.threshold > 0 ? String(routine.threshold) : '';
	}

	function submitRoutine() {
		const trimmed = name.trim();
		if (!trimmed) return;
		const routine: Routine = editingId
			? {
					...routines.find((r) => r.id === editingId)!,
					name: trimmed,
					unit: unit.trim(),
					threshold: Number(threshold) || 0
				}
			: {
					id: newRoutineId(uid),
					name: trimmed,
					unit: unit.trim(),
					threshold: Number(threshold) || 0,
					order: Math.max(0, ...routines.map((r) => r.order)) + 1
				};
		routines = editingId
			? routines.map((r) => (r.id === editingId ? routine : r))
			: [...routines, routine];
		adding = false;
		editingId = null;
		saveRoutine(uid, routine).catch(() => (error = true));
	}

	function removeRoutine(routine: Routine) {
		if (!confirm(`Delete routine "${routine.name}"? Its card disappears from every day.`)) return;
		routines = routines.filter((r) => r.id !== routine.id);
		deleteRoutine(uid, routine.id).catch(() => (error = true));
	}

	function setValue(routine: Routine, raw: string) {
		const next = { ...values };
		if (raw === '') delete next[routine.id];
		else next[routine.id] = Number(raw);
		values = next;
		saveRoutineValue(uid, date, routine.id, raw === '' ? null : Number(raw)).catch(
			() => (error = true)
		);
	}
</script>

{#snippet routineForm(submitLabel: string, cancel: () => void)}
	<form
		class="rounded-card border border-sky-500/40 bg-card p-3"
		onsubmit={(e) => {
			e.preventDefault();
			submitRoutine();
		}}
	>
		<input
			type="text"
			bind:value={name}
			placeholder="routine (e.g. Quran)"
			aria-label="Routine name"
			class="mb-1.5 w-full rounded-ctl border-line bg-card py-1 text-sm text-ink"
		/>
		<div class="mb-1.5 flex gap-1.5">
			<input
				type="number"
				min="0"
				step="any"
				bind:value={threshold}
				placeholder="target"
				aria-label="Daily target"
				class="w-full min-w-0 rounded-ctl border-line bg-card py-1 text-sm text-ink"
			/>
			<input
				type="text"
				bind:value={unit}
				placeholder="unit"
				aria-label="Unit"
				class="w-full min-w-0 rounded-ctl border-line bg-card py-1 text-sm text-ink"
			/>
		</div>
		<div class="flex gap-1">
			<button
				type="submit"
				class="rounded-ctl bg-accent-fill px-2 py-1 text-xs font-medium text-on-accent hover:opacity-90"
			>
				{submitLabel}
			</button>
			<button
				type="button"
				onclick={cancel}
				class="rounded-ctl px-2 py-1 text-xs text-mute hover:bg-tint"
			>
				cancel
			</button>
		</div>
	</form>
{/snippet}

<section class="rounded-card border border-line bg-card p-4 shadow-card">
	<h2
		class="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-sky-600 uppercase dark:text-sky-400"
	>
		<span class="h-1.5 w-1.5 rounded-full bg-current"></span>
		Routines
		<a
			href={resolve('/routines')}
			class="ml-auto font-normal text-sky-600 normal-case hover:underline dark:text-sky-400"
		>
			monthly stats →
		</a>
	</h2>

	{#if routines.length === 0 && !adding}
		<p class="mb-2 text-sm text-faint">
			No routines added yet — track daily habits like reciting Quran, reading hadith, or pages read.
			Add one below or from Settings.
		</p>
	{/if}

	<div class="grid grid-cols-2 gap-2">
		{#each routines as routine (routine.id)}
			{#if editingId === routine.id}
				{@render routineForm('Save', () => (editingId = null))}
			{:else}
				{@const value = values[routine.id]}
				{@const met = value !== undefined && routine.threshold > 0 && value >= routine.threshold}
				<div
					class="group rounded-card border p-3 {met
						? 'border-green-500/35 bg-green-500/10'
						: 'border-line bg-card'}"
				>
					<p
						class="flex items-baseline text-sm {met
							? 'text-green-700 dark:text-green-300'
							: 'text-mute'}"
					>
						<span class="truncate font-medium">{routine.name}</span>
						<span
							class="ml-auto flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
						>
							<button
								type="button"
								onclick={() => startEdit(routine)}
								aria-label="Edit {routine.name}"
								class="rounded px-1 text-xs text-faint hover:bg-tint hover:text-mute">✎</button
							>
							<button
								type="button"
								onclick={() => removeRoutine(routine)}
								aria-label="Delete {routine.name}"
								class="rounded px-1 text-xs text-faint hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
								>×</button
							>
						</span>
					</p>
					<div class="mt-1 flex items-baseline gap-1.5">
						<input
							type="number"
							min="0"
							step="any"
							value={value ?? ''}
							oninput={(e) => setValue(routine, e.currentTarget.value)}
							placeholder="0"
							aria-label="{routine.name} on this day"
							class="w-20 rounded-ctl bg-card py-1 text-sm text-ink tabular-nums {met
								? 'border-green-500/40'
								: 'border-line'}"
						/>
						{#if routine.unit}
							<span class="truncate text-xs text-faint">{routine.unit}</span>
						{/if}
					</div>
					{#if routine.threshold > 0}
						<p class="mt-1 text-xs {met ? 'text-green-600 dark:text-green-400' : 'text-faint'}">
							{met ? '✓ ' : ''}target {routine.threshold}{routine.unit ? ` ${routine.unit}` : ''}
						</p>
					{/if}
				</div>
			{/if}
		{/each}
		{#if adding}
			{@render routineForm('Add', () => (adding = false))}
		{:else}
			<button
				type="button"
				onclick={startAdd}
				class="rounded-card border border-dashed border-line p-3 text-sm text-faint hover:border-sky-500/50 hover:text-sky-600 dark:hover:text-sky-400"
			>
				+ add routine
			</button>
		{/if}
	</div>

	{#if error}
		<p class="mt-2 text-xs text-red-500 dark:text-red-400">
			save failed — some changes may not be stored
		</p>
	{/if}
</section>
