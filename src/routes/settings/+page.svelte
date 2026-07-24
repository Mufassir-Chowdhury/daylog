<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { session } from '$lib/auth.svelte';
	import { backupSummary, parseBackup, serializeBackup } from '$lib/backup';
	import { dateKey } from '$lib/date';
	import {
		deleteRoutine,
		exportUserData,
		importUserData,
		newRoutineId,
		saveRoutine,
		saveSettings,
		type Routine
	} from '$lib/db';
	import { formatMoney } from '$lib/finance';
	import { applySettings, settings } from '$lib/settings.svelte';

	let { data } = $props();

	const uid = session.user!.uid;

	let routines = $derived(data.routines);
	let routineError = $state(false);
	let newName = $state('');
	let newUnit = $state('');
	let newThreshold = $state('');

	function updateRoutine(routine: Routine, patch: Partial<Routine>) {
		const updated = { ...routine, ...patch };
		routines = routines.map((r) => (r.id === routine.id ? updated : r));
		saveRoutine(uid, updated).catch(() => (routineError = true));
	}

	function addRoutine() {
		const name = newName.trim();
		if (!name) return;
		const routine: Routine = {
			id: newRoutineId(uid),
			name,
			unit: newUnit.trim(),
			threshold: Number(newThreshold) || 0,
			order: Math.max(0, ...routines.map((r) => r.order)) + 1
		};
		routines = [...routines, routine];
		newName = '';
		newUnit = '';
		newThreshold = '';
		saveRoutine(uid, routine).catch(() => (routineError = true));
	}

	function removeRoutine(routine: Routine) {
		if (!confirm(`Delete routine "${routine.name}"? Its card disappears from every day.`)) return;
		routines = routines.filter((r) => r.id !== routine.id);
		deleteRoutine(uid, routine.id).catch(() => (routineError = true));
	}

	let saveState: 'saved' | 'pending' | 'error' = $state('saved');
	let saveTimer: ReturnType<typeof setTimeout> | undefined;

	// Same debounced optimistic-save pattern as the day editor: Firestore's
	// persistent cache makes writes durable immediately, even offline.
	function persist() {
		saveState = 'pending';
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveSettings(uid, { ...settings }).catch(() => (saveState = 'error'));
			saveState = 'saved';
		}, 400);
	}

	let exporting = $state(false);
	let importing = $state(false);
	let dataError = $state('');
	let importResult = $state('');

	async function exportBackup() {
		exporting = true;
		dataError = '';
		importResult = '';
		try {
			const backup = await exportUserData(uid);
			const blob = new Blob([serializeBackup(backup)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `daylog-backup-${dateKey()}.json`;
			a.click();
			URL.revokeObjectURL(url);
		} catch {
			dataError = 'Export failed — check your connection and try again.';
		} finally {
			exporting = false;
		}
	}

	async function importBackup(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		dataError = '';
		importResult = '';
		let backup;
		try {
			backup = parseBackup(await file.text());
		} catch (err) {
			dataError = err instanceof Error ? err.message : 'Could not read that file.';
			return;
		}
		const ok = confirm(
			`Import ${backupSummary(backup)} from "${file.name}"?\n\n` +
				'Entries with the same date or id will be overwritten; everything else is kept.'
		);
		if (!ok) return;
		importing = true;
		try {
			await importUserData(uid, backup);
			applySettings({ ...settings, ...backup.settings });
			importResult = `Imported ${backupSummary(backup)}.`;
			await invalidateAll();
		} catch {
			dataError =
				'Import failed partway — importing the same file again is safe and will finish the job.';
		} finally {
			importing = false;
		}
	}
</script>

<div class="mb-4 flex items-baseline">
	<h1 class="text-xl font-bold text-gray-900">Settings</h1>
	<span class="ml-auto text-xs text-gray-400">
		{#if saveState === 'error'}
			<span class="text-red-500">save failed — will retry on next change</span>
		{:else if saveState === 'pending'}
			…
		{:else}
			saved
		{/if}
	</span>
</div>

<section class="rounded-xl border border-gray-200 bg-white p-4">
	<h2 class="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">Money</h2>
	<div class="flex flex-wrap items-end gap-4">
		<label class="block">
			<span class="text-sm text-gray-600">Currency symbol</span>
			<input
				type="text"
				bind:value={settings.currency}
				oninput={persist}
				maxlength="4"
				class="mt-1 block w-24 rounded-lg border-gray-300 text-sm"
			/>
		</label>
		<label class="block">
			<span class="text-sm text-gray-600">Digit grouping</span>
			<select
				bind:value={settings.grouping}
				onchange={persist}
				class="mt-1 block rounded-lg border-gray-300 text-sm"
			>
				<option value="lakh">lakh / crore (1,50,000)</option>
				<option value="thousand">thousands (150,000)</option>
			</select>
		</label>
		<p class="pb-2 text-sm text-gray-400">
			preview: <span class="font-medium text-gray-700 tabular-nums">{formatMoney(1234567.5)}</span>
		</p>
	</div>
</section>

<section class="mt-4 rounded-xl border border-gray-200 bg-white p-4">
	<h2 class="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">Day page panels</h2>
	<div class="space-y-2">
		<label class="flex items-center gap-2 text-sm text-gray-700">
			<input
				type="checkbox"
				bind:checked={settings.showNotePanel}
				onchange={persist}
				class="rounded border-gray-300 text-blue-600"
			/>
			New note panel
		</label>
		<label class="flex items-center gap-2 text-sm text-gray-700">
			<input
				type="checkbox"
				bind:checked={settings.showLongTermPanel}
				onchange={persist}
				class="rounded border-gray-300 text-blue-600"
			/>
			Long-standing tasks panel
		</label>
		<label class="flex items-center gap-2 text-sm text-gray-700">
			<input
				type="checkbox"
				bind:checked={settings.showFinancePanel}
				onchange={persist}
				class="rounded border-gray-300 text-blue-600"
			/>
			Finance panel
		</label>
		<label class="flex items-center gap-2 text-sm text-gray-700">
			<input
				type="checkbox"
				bind:checked={settings.showRoutinePanel}
				onchange={persist}
				class="rounded border-gray-300 text-blue-600"
			/>
			Daily routines panel
		</label>
	</div>
	<p class="mt-2 text-xs text-gray-400">
		Hiding a panel only tucks it away on day pages — nothing is deleted, and the People, Notes,
		Routines and Finance pages keep working.
	</p>
</section>

<section class="mt-4 rounded-xl border border-gray-200 bg-white p-4">
	<h2 class="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">Daily routines</h2>
	{#if routines.length === 0}
		<p class="mb-2 text-sm text-gray-400">
			No routines added yet — routines are daily habits tracked with a number, like reciting Quran
			or pages read.
		</p>
	{/if}
	<div class="space-y-2">
		{#each routines as routine (routine.id)}
			<div class="flex flex-wrap items-end gap-2">
				<label class="flex flex-col gap-0.5 text-xs text-gray-500">
					Name
					<input
						type="text"
						value={routine.name}
						onchange={(e) =>
							updateRoutine(routine, { name: e.currentTarget.value.trim() || routine.name })}
						class="w-40 rounded-lg border-gray-300 py-1.5 text-sm"
					/>
				</label>
				<label class="flex flex-col gap-0.5 text-xs text-gray-500">
					Daily target
					<input
						type="number"
						min="0"
						step="any"
						value={routine.threshold > 0 ? routine.threshold : ''}
						placeholder="none"
						onchange={(e) =>
							updateRoutine(routine, { threshold: Number(e.currentTarget.value) || 0 })}
						class="w-24 rounded-lg border-gray-300 py-1.5 text-sm"
					/>
				</label>
				<label class="flex flex-col gap-0.5 text-xs text-gray-500">
					Unit
					<input
						type="text"
						value={routine.unit}
						placeholder="pages"
						onchange={(e) => updateRoutine(routine, { unit: e.currentTarget.value.trim() })}
						class="w-24 rounded-lg border-gray-300 py-1.5 text-sm"
					/>
				</label>
				<button
					type="button"
					onclick={() => removeRoutine(routine)}
					aria-label="Delete {routine.name}"
					class="rounded px-1.5 py-1.5 text-xs text-gray-400 hover:bg-red-100 hover:text-red-600"
					>×</button
				>
			</div>
		{/each}
	</div>
	<form
		class="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3"
		onsubmit={(e) => {
			e.preventDefault();
			addRoutine();
		}}
	>
		<label class="flex flex-col gap-0.5 text-xs text-gray-500">
			New routine
			<input
				type="text"
				bind:value={newName}
				placeholder="e.g. Quran recitation"
				class="w-40 rounded-lg border-gray-300 py-1.5 text-sm"
			/>
		</label>
		<label class="flex flex-col gap-0.5 text-xs text-gray-500">
			Daily target
			<input
				type="number"
				min="0"
				step="any"
				bind:value={newThreshold}
				placeholder="none"
				class="w-24 rounded-lg border-gray-300 py-1.5 text-sm"
			/>
		</label>
		<label class="flex flex-col gap-0.5 text-xs text-gray-500">
			Unit
			<input
				type="text"
				bind:value={newUnit}
				placeholder="pages"
				class="w-24 rounded-lg border-gray-300 py-1.5 text-sm"
			/>
		</label>
		<button
			type="submit"
			class="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
		>
			Add
		</button>
	</form>
	<p class="mt-2 text-xs text-gray-400">
		Log the day's number on each day page; days that reach the target show green. The Routines page
		tracks monthly totals and averages.
	</p>
	{#if routineError}
		<p class="mt-2 text-xs text-red-500">save failed — some changes may not be stored</p>
	{/if}
</section>

<section class="mt-4 rounded-xl border border-gray-200 bg-white p-4">
	<h2 class="mb-3 text-xs font-semibold tracking-wide text-gray-500 uppercase">Data</h2>
	<div class="flex flex-wrap items-center gap-2">
		<button
			type="button"
			onclick={exportBackup}
			disabled={exporting}
			class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
		>
			{exporting ? 'Exporting…' : 'Export backup'}
		</button>
		<label
			class="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 {importing
				? 'pointer-events-none opacity-50'
				: ''}"
		>
			{importing ? 'Importing…' : 'Import backup…'}
			<input
				type="file"
				accept=".json,application/json"
				class="hidden"
				onchange={importBackup}
				disabled={importing}
			/>
		</label>
	</div>
	<p class="mt-2 text-xs text-gray-400">
		Export downloads everything — days, people, notes, long-standing tasks, accounts, transactions,
		routines and these settings — as a single JSON file. Import reads a backup made here and merges
		it in: entries with the same date or id are overwritten, everything else is left alone.
	</p>
	{#if importResult}
		<p class="mt-2 text-xs text-emerald-700">{importResult}</p>
	{/if}
	{#if dataError}
		<p class="mt-2 text-xs text-red-500">{dataError}</p>
	{/if}
</section>
