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
	import { applySettings, settings, type Theme } from '$lib/settings.svelte';

	let { data } = $props();

	const uid = session.user!.uid;

	/** Swatch colors mirror each theme's tokens so previews are honest. */
	const THEME_OPTIONS: {
		id: Theme;
		label: string;
		hint: string;
		canvas: string;
		card: string;
		accent: string;
	}[] = [
		{
			id: 'light',
			label: 'Light',
			hint: 'clean & soft',
			canvas: '#f5f6f8',
			card: '#ffffff',
			accent: '#4f46e5'
		},
		{
			id: 'dark',
			label: 'Dark',
			hint: 'deep neutral',
			canvas: '#0b0d11',
			card: '#151821',
			accent: '#8b93ff'
		},
		{
			id: 'geo-light',
			label: 'Geometric light',
			hint: 'sharp & patterned',
			canvas: '#f6f6f4',
			card: '#ffffff',
			accent: '#047857'
		},
		{
			id: 'geo-dark',
			label: 'Geometric dark',
			hint: 'sharp & patterned',
			canvas: '#0d0f0e',
			card: '#151815',
			accent: '#34d399'
		},
		{
			id: 'tech-light',
			label: 'Hi-tech light',
			hint: 'blueprint grid',
			canvas: '#f2f5f9',
			card: '#ffffff',
			accent: '#0e7490'
		},
		{
			id: 'tech-dark',
			label: 'Hi-tech dark',
			hint: 'cyan on navy',
			canvas: '#070b12',
			card: '#0d1420',
			accent: '#22d3ee'
		}
	];

	function pickTheme(theme: Theme) {
		settings.theme = theme;
		persist();
	}

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

<div class="mb-5 flex items-baseline">
	<h1 class="font-display text-2xl font-bold tracking-tight text-ink">Settings</h1>
	<span class="ml-auto text-xs text-faint">
		{#if saveState === 'error'}
			<span class="text-red-500 dark:text-red-400">save failed — will retry on next change</span>
		{:else if saveState === 'pending'}
			…
		{:else}
			saved
		{/if}
	</span>
</div>

<div class="grid items-start gap-4 xl:grid-cols-2">
	<div class="min-w-0 space-y-4">
		<section class="rounded-card border border-line bg-card p-4 shadow-card">
			<h2 class="mb-3 text-xs font-semibold tracking-wide text-mute uppercase">Appearance</h2>
			<div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
				{#each THEME_OPTIONS as option (option.id)}
					<button
						type="button"
						onclick={() => pickTheme(option.id)}
						aria-pressed={settings.theme === option.id}
						class="rounded-card border p-2 text-left transition-colors {settings.theme === option.id
							? 'border-accent ring-2 ring-accent/30'
							: 'border-line hover:border-accent/50'}"
					>
						<span
							class="block rounded-ctl border border-black/10 p-2"
							style="background:{option.canvas}"
						>
							<span
								class="block rounded-[3px] p-1.5"
								style="background:{option.card}; box-shadow: 0 1px 2px rgb(0 0 0 / 0.15)"
							>
								<span class="mb-1 block h-1.5 w-8 rounded-full" style="background:{option.accent}"
								></span>
								<span
									class="block h-1 w-12 rounded-full opacity-40"
									style="background:{option.accent}"
								></span>
							</span>
						</span>
						<span class="mt-1.5 block text-xs font-medium text-ink">{option.label}</span>
						<span class="block text-[11px] text-faint">{option.hint}</span>
					</button>
				{/each}
			</div>
			<p class="mt-2 text-xs text-faint">
				Themes restyle the whole app — colors, corners, background texture and type. Your pick is
				saved to your account and remembered on this device.
			</p>
		</section>

		<section class="rounded-card border border-line bg-card p-4 shadow-card">
			<h2 class="mb-3 text-xs font-semibold tracking-wide text-mute uppercase">Money</h2>
			<div class="flex flex-wrap items-end gap-4">
				<label class="block">
					<span class="text-sm text-mute">Currency symbol</span>
					<input
						type="text"
						bind:value={settings.currency}
						oninput={persist}
						maxlength="4"
						class="mt-1 block w-24 rounded-ctl border-line bg-card text-sm text-ink"
					/>
				</label>
				<label class="block">
					<span class="text-sm text-mute">Digit grouping</span>
					<select
						bind:value={settings.grouping}
						onchange={persist}
						class="mt-1 block rounded-ctl border-line bg-card text-sm text-ink"
					>
						<option value="lakh">lakh / crore (1,50,000)</option>
						<option value="thousand">thousands (150,000)</option>
					</select>
				</label>
				<p class="pb-2 text-sm text-faint">
					preview: <span class="font-medium text-ink tabular-nums">{formatMoney(1234567.5)}</span>
				</p>
			</div>
		</section>

		<section class="rounded-card border border-line bg-card p-4 shadow-card">
			<h2 class="mb-3 text-xs font-semibold tracking-wide text-mute uppercase">Day page panels</h2>
			<div class="space-y-2">
				<label class="flex items-center gap-2 text-sm text-ink">
					<input
						type="checkbox"
						bind:checked={settings.showNotePanel}
						onchange={persist}
						class="rounded border-line bg-card text-accent-fill"
					/>
					New note panel
				</label>
				<label class="flex items-center gap-2 text-sm text-ink">
					<input
						type="checkbox"
						bind:checked={settings.showLongTermPanel}
						onchange={persist}
						class="rounded border-line bg-card text-accent-fill"
					/>
					Long-standing tasks panel
				</label>
				<label class="flex items-center gap-2 text-sm text-ink">
					<input
						type="checkbox"
						bind:checked={settings.showFinancePanel}
						onchange={persist}
						class="rounded border-line bg-card text-accent-fill"
					/>
					Finance panel
				</label>
				<label class="flex items-center gap-2 text-sm text-ink">
					<input
						type="checkbox"
						bind:checked={settings.showRoutinePanel}
						onchange={persist}
						class="rounded border-line bg-card text-accent-fill"
					/>
					Daily routines panel
				</label>
			</div>
			<p class="mt-2 text-xs text-faint">
				Hiding a panel only tucks it away on day pages — nothing is deleted, and the People, Notes,
				Routines and Finance pages keep working.
			</p>
		</section>
	</div>

	<div class="min-w-0 space-y-4">
		<section class="rounded-card border border-line bg-card p-4 shadow-card">
			<h2 class="mb-3 text-xs font-semibold tracking-wide text-mute uppercase">Daily routines</h2>
			{#if routines.length === 0}
				<p class="mb-2 text-sm text-faint">
					No routines added yet — routines are daily habits tracked with a number, like reciting
					Quran or pages read.
				</p>
			{/if}
			<div class="space-y-2">
				{#each routines as routine (routine.id)}
					<div class="flex flex-wrap items-end gap-2">
						<label class="flex flex-col gap-0.5 text-xs text-mute">
							Name
							<input
								type="text"
								value={routine.name}
								onchange={(e) =>
									updateRoutine(routine, { name: e.currentTarget.value.trim() || routine.name })}
								class="w-40 rounded-ctl border-line bg-card py-1.5 text-sm text-ink"
							/>
						</label>
						<label class="flex flex-col gap-0.5 text-xs text-mute">
							Daily target
							<input
								type="number"
								min="0"
								step="any"
								value={routine.threshold > 0 ? routine.threshold : ''}
								placeholder="none"
								onchange={(e) =>
									updateRoutine(routine, { threshold: Number(e.currentTarget.value) || 0 })}
								class="w-24 rounded-ctl border-line bg-card py-1.5 text-sm text-ink"
							/>
						</label>
						<label class="flex flex-col gap-0.5 text-xs text-mute">
							Unit
							<input
								type="text"
								value={routine.unit}
								placeholder="pages"
								onchange={(e) => updateRoutine(routine, { unit: e.currentTarget.value.trim() })}
								class="w-24 rounded-ctl border-line bg-card py-1.5 text-sm text-ink"
							/>
						</label>
						<button
							type="button"
							onclick={() => removeRoutine(routine)}
							aria-label="Delete {routine.name}"
							class="rounded px-1.5 py-1.5 text-xs text-faint hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
							>×</button
						>
					</div>
				{/each}
			</div>
			<form
				class="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"
				onsubmit={(e) => {
					e.preventDefault();
					addRoutine();
				}}
			>
				<label class="flex flex-col gap-0.5 text-xs text-mute">
					New routine
					<input
						type="text"
						bind:value={newName}
						placeholder="e.g. Quran recitation"
						class="w-40 rounded-ctl border-line bg-card py-1.5 text-sm text-ink"
					/>
				</label>
				<label class="flex flex-col gap-0.5 text-xs text-mute">
					Daily target
					<input
						type="number"
						min="0"
						step="any"
						bind:value={newThreshold}
						placeholder="none"
						class="w-24 rounded-ctl border-line bg-card py-1.5 text-sm text-ink"
					/>
				</label>
				<label class="flex flex-col gap-0.5 text-xs text-mute">
					Unit
					<input
						type="text"
						bind:value={newUnit}
						placeholder="pages"
						class="w-24 rounded-ctl border-line bg-card py-1.5 text-sm text-ink"
					/>
				</label>
				<button
					type="submit"
					class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
				>
					Add
				</button>
			</form>
			<p class="mt-2 text-xs text-faint">
				Log the day's number on each day page; days that reach the target show green. The Routines
				page tracks monthly totals and averages.
			</p>
			{#if routineError}
				<p class="mt-2 text-xs text-red-500 dark:text-red-400">
					save failed — some changes may not be stored
				</p>
			{/if}
		</section>

		<section class="rounded-card border border-line bg-card p-4 shadow-card">
			<h2 class="mb-3 text-xs font-semibold tracking-wide text-mute uppercase">Data</h2>
			<div class="flex flex-wrap items-center gap-2">
				<button
					type="button"
					onclick={exportBackup}
					disabled={exporting}
					class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
				>
					{exporting ? 'Exporting…' : 'Export backup'}
				</button>
				<label
					class="cursor-pointer rounded-ctl border border-line bg-card px-3 py-1.5 text-sm font-medium text-mute hover:bg-tint hover:text-ink {importing
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
			<p class="mt-2 text-xs text-faint">
				Export downloads everything — days, people, notes, long-standing tasks, accounts,
				transactions, routines and these settings — as a single JSON file. Import reads a backup
				made here and merges it in: entries with the same date or id are overwritten, everything
				else is left alone.
			</p>
			{#if importResult}
				<p class="mt-2 text-xs text-green-700 dark:text-green-400">{importResult}</p>
			{/if}
			{#if dataError}
				<p class="mt-2 text-xs text-red-500 dark:text-red-400">{dataError}</p>
			{/if}
		</section>
	</div>
</div>
