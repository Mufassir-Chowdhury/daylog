<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { session } from '$lib/auth.svelte';
	import { backupSummary, parseBackup, serializeBackup } from '$lib/backup';
	import { dateKey } from '$lib/date';
	import { exportUserData, importUserData, saveSettings } from '$lib/db';
	import { formatMoney } from '$lib/finance';
	import { applySettings, settings } from '$lib/settings.svelte';

	const uid = session.user!.uid;

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
			const data = await exportUserData(uid);
			const blob = new Blob([serializeBackup(data)], { type: 'application/json' });
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
		let data;
		try {
			data = parseBackup(await file.text());
		} catch (err) {
			dataError = err instanceof Error ? err.message : 'Could not read that file.';
			return;
		}
		const ok = confirm(
			`Import ${backupSummary(data)} from "${file.name}"?\n\n` +
				'Entries with the same date or id will be overwritten; everything else is kept.'
		);
		if (!ok) return;
		importing = true;
		try {
			await importUserData(uid, data);
			applySettings({ ...settings, ...data.settings });
			importResult = `Imported ${backupSummary(data)}.`;
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
	</div>
	<p class="mt-2 text-xs text-gray-400">
		Hiding a panel only tucks it away on day pages — nothing is deleted, and the People, Notes and
		Finance pages keep working.
	</p>
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
		Export downloads everything — days, people, notes, long-standing tasks, accounts, transactions
		and these settings — as a single JSON file. Import reads a backup made here and merges it in:
		entries with the same date or id are overwritten, everything else is left alone.
	</p>
	{#if importResult}
		<p class="mt-2 text-xs text-emerald-700">{importResult}</p>
	{/if}
	{#if dataError}
		<p class="mt-2 text-xs text-red-500">{dataError}</p>
	{/if}
</section>
