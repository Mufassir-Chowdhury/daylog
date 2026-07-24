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
		class="rounded-xl border border-sky-300 bg-white p-3"
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
			class="mb-1.5 w-full rounded-lg border-gray-300 py-1 text-sm"
		/>
		<div class="mb-1.5 flex gap-1.5">
			<input
				type="number"
				min="0"
				step="any"
				bind:value={threshold}
				placeholder="target"
				aria-label="Daily target"
				class="w-full min-w-0 rounded-lg border-gray-300 py-1 text-sm"
			/>
			<input
				type="text"
				bind:value={unit}
				placeholder="unit"
				aria-label="Unit"
				class="w-full min-w-0 rounded-lg border-gray-300 py-1 text-sm"
			/>
		</div>
		<div class="flex gap-1">
			<button
				type="submit"
				class="rounded-lg bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700"
			>
				{submitLabel}
			</button>
			<button
				type="button"
				onclick={cancel}
				class="rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
			>
				cancel
			</button>
		</div>
	</form>
{/snippet}

<section class="rounded-xl border border-sky-200 bg-sky-50/50 p-4">
	<h2 class="mb-2 flex items-baseline text-xs font-semibold tracking-wide text-sky-700 uppercase">
		Routines
		<a
			href={resolve('/routines')}
			class="ml-auto font-normal text-sky-600 normal-case hover:underline"
		>
			monthly stats →
		</a>
	</h2>

	{#if routines.length === 0 && !adding}
		<p class="mb-2 text-sm text-gray-400">
			No routines added yet — track daily habits like reciting Quran, reading hadith, or pages read.
			Add one below or from Settings.
		</p>
	{/if}

	<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
		{#each routines as routine (routine.id)}
			{#if editingId === routine.id}
				{@render routineForm('Save', () => (editingId = null))}
			{:else}
				{@const value = values[routine.id]}
				{@const met = value !== undefined && routine.threshold > 0 && value >= routine.threshold}
				<div
					class="group rounded-xl border p-3 {met
						? 'border-green-300 bg-green-50'
						: 'border-gray-200 bg-white'}"
				>
					<p class="flex items-baseline text-sm {met ? 'text-green-800' : 'text-gray-600'}">
						<span class="truncate font-medium">{routine.name}</span>
						<span
							class="ml-auto flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
						>
							<button
								type="button"
								onclick={() => startEdit(routine)}
								aria-label="Edit {routine.name}"
								class="rounded px-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600"
								>✎</button
							>
							<button
								type="button"
								onclick={() => removeRoutine(routine)}
								aria-label="Delete {routine.name}"
								class="rounded px-1 text-xs text-gray-400 hover:bg-red-100 hover:text-red-600"
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
							class="w-20 rounded-lg py-1 text-sm tabular-nums {met
								? 'border-green-300'
								: 'border-gray-300'}"
						/>
						{#if routine.unit}
							<span class="truncate text-xs text-gray-400">{routine.unit}</span>
						{/if}
					</div>
					{#if routine.threshold > 0}
						<p class="mt-1 text-xs {met ? 'text-green-600' : 'text-gray-400'}">
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
				class="rounded-xl border border-dashed border-gray-300 p-3 text-sm text-gray-400 hover:border-sky-300 hover:text-sky-600"
			>
				+ add routine
			</button>
		{/if}
	</div>

	{#if error}
		<p class="mt-2 text-xs text-red-500">save failed — some changes may not be stored</p>
	{/if}
</section>
