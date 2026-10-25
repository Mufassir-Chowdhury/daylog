<script lang="ts">
	import {
		acceleratorFromEvent,
		desktop,
		prettyAccelerator,
		type DesktopBridge,
		type DesktopPrefs,
		type UpdateStatus
	} from '$lib/desktop';
	import { device, setDeviceTheme } from '$lib/settings.svelte';

	// Only rendered in the desktop app.
	const bridge = desktop as DesktopBridge;

	let prefs: DesktopPrefs | null = $state(null);
	let recording: 'summonKey' | 'quickKey' | null = $state(null);
	let error = $state('');

	bridge.getPrefs().then((p) => (prefs = p));

	let updates: UpdateStatus | null = $state(null);
	bridge.updateStatus().then((s) => (updates = s));
	$effect(() => bridge.onUpdateStatus((s) => (updates = s)));

	async function update(patch: Parameters<DesktopBridge['setPrefs']>[0]) {
		error = '';
		const result = await bridge.setPrefs(patch);
		if (!result.ok) error = result.error ?? 'Could not save';
		prefs = await bridge.getPrefs();
	}

	function record(e: KeyboardEvent) {
		if (!recording) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.key === 'Escape') {
			recording = null;
			return;
		}
		const accel = acceleratorFromEvent(e);
		if (!accel) return;
		const key = recording;
		recording = null;
		update({ [key]: accel });
	}

	const HOTKEYS = [
		{
			key: 'quickKey',
			label: 'Quick bar',
			hint: 'capture a thought or jump anywhere, over any app'
		},
		{ key: 'summonKey', label: 'Show / hide daylog', hint: 'bring the main window forward' }
	] as const;
</script>

<svelte:window onkeydowncapture={record} />

<section class="rounded-card border border-line bg-card p-4 shadow-card">
	<h2 class="mb-3 text-xs font-semibold tracking-wide text-mute uppercase">Desktop app</h2>

	<div class="space-y-4">
		<label class="flex items-center gap-2 text-sm text-ink">
			<input
				type="checkbox"
				checked={device.theme === 'account'}
				onchange={(e) => setDeviceTheme(e.currentTarget.checked ? 'account' : 'jarvis-dark')}
				class="rounded border-line bg-card text-accent-fill"
			/>
			Use my account theme here too (otherwise this computer keeps its own, Jarvis by default)
		</label>

		<div class="space-y-2">
			<span class="text-sm text-mute">Global hotkeys</span>
			{#each HOTKEYS as hotkey (hotkey.key)}
				<div class="flex flex-wrap items-center gap-3">
					<button
						type="button"
						onclick={() => (recording = recording === hotkey.key ? null : hotkey.key)}
						class="min-w-44 rounded-ctl border px-3 py-1.5 text-left font-mono text-sm {recording ===
						hotkey.key
							? 'border-accent text-accent ring-2 ring-accent/30'
							: 'border-line text-ink hover:border-accent/50'}"
					>
						{#if recording === hotkey.key}
							press keys… <span class="text-faint">(esc cancels)</span>
						{:else}
							{prefs ? prettyAccelerator(prefs[hotkey.key]) : '…'}
						{/if}
					</button>
					<span class="text-sm">
						<span class="text-ink">{hotkey.label}</span>
						<span class="text-faint">— {hotkey.hint}</span>
					</span>
				</div>
			{/each}
			{#if error}
				<p class="text-sm text-red-600 dark:text-red-400">{error}</p>
			{:else if prefs?.failed.length}
				<p class="text-sm text-amber-600 dark:text-amber-400">
					{prefs.failed.map(prettyAccelerator).join(', ')} is taken by another app — pick a different
					combination.
				</p>
			{/if}
		</div>

		<label class="flex items-center gap-2 text-sm text-ink">
			<input
				type="checkbox"
				checked={prefs?.launchAtLogin ?? false}
				disabled={!prefs?.canLaunchAtLogin}
				onchange={(e) => update({ launchAtLogin: e.currentTarget.checked })}
				class="rounded border-line bg-card text-accent-fill"
			/>
			Start with Windows (in the tray, out of the way)
		</label>
		<p class="text-xs text-faint">
			Closing the window keeps daylog running in the tray, so reminders for timed lines and upcoming
			classes still pop up. Quit from the tray icon.
		</p>

		{#if updates}
			<div class="flex flex-wrap items-center gap-3 text-sm">
				<span class="text-ink">Version {updates.current}</span>
				<span class="text-faint">
					{#if updates.state === 'unsupported'}
						— updates only run in the installed app
					{:else if updates.state === 'checking'}
						— checking for updates…
					{:else if updates.state === 'downloading'}
						— downloading {updates.version} ({updates.percent}%)
					{:else if updates.state === 'ready'}
						— {updates.version} is ready; it installs the next time daylog quits
					{:else if updates.state === 'error'}
						— couldn't check for updates ({updates.error})
					{:else if updates.checkedAt}
						— up to date
					{/if}
				</span>
				{#if updates.state === 'ready'}
					<button
						type="button"
						onclick={() => bridge.installUpdate()}
						class="rounded-ctl border border-accent px-3 py-1 text-accent hover:bg-accent/10"
					>
						Restart to update
					</button>
				{:else if updates.state === 'idle' || updates.state === 'error'}
					<button
						type="button"
						onclick={async () => (updates = await bridge.checkForUpdates())}
						class="rounded-ctl border border-line px-3 py-1 text-ink hover:border-accent/50"
					>
						Check for updates
					</button>
				{/if}
			</div>
		{/if}
	</div>
</section>
