<script lang="ts">
	import { session } from '$lib/auth.svelte';
	import { spentToday } from '$lib/ai/budget';
	import {
		addressName,
		CHECKIN_KINDS,
		DATA_AREAS,
		DEFAULT_CONFIG,
		permissionFor,
		sortCheckins,
		type AssistantConfig
	} from '$lib/ai/config';
	import { loadDevicePrefs, saveDevicePrefs } from '$lib/ai/device';
	import { loadAdapter } from '$lib/ai';
	import { ALL_TOOLS } from '$lib/ai/tools';
	import { keyStatus, saveKey } from '$lib/ai/transport';
	import { PROVIDERS, type ModelInfo, type ModelSlot, type ProviderId } from '$lib/ai/types';
	import {
		cleanMemoryText,
		MEMORY_MAX_TEXT,
		sortMemory,
		type MemoryItem,
		type MemoryKind
	} from '$lib/ai/memory';
	import {
		deleteMemory,
		listMemory,
		loadAssistantConfig,
		newMemoryId,
		saveAssistantConfig,
		saveMemory
	} from '$lib/db';
	import { desktop } from '$lib/desktop';
	import { saveFailed, toast } from '$lib/toast.svelte';

	const uid = session.user!.uid;
	const displayName = session.user!.displayName;

	// ——— Account-wide settings (synced).
	let config: AssistantConfig = $state(structuredClone(DEFAULT_CONFIG));
	let loaded = $state(false);
	loadAssistantConfig(uid)
		.then((c) => (config = c))
		.catch(() => toast('Could not load the assistant settings.', { tone: 'error' }))
		.finally(() => (loaded = true));

	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	function persist() {
		if (!loaded) return;
		clearTimeout(saveTimer);
		saveTimer = setTimeout(
			() => saveAssistantConfig(uid, $state.snapshot(config)).catch(saveFailed),
			600
		);
	}

	function addCheckin() {
		config.checkins = sortCheckins([
			...config.checkins,
			{ id: `custom-${Date.now()}`, label: 'Check-in', time: '12:00', kind: 'brief', enabled: true }
		]);
		persist();
	}

	function removeCheckin(id: string) {
		config.checkins = config.checkins.filter((c) => c.id !== id);
		persist();
	}

	const greeting = $derived.by(() => {
		const who = addressName(config, displayName);
		return `Good morning${who ? `, ${who}` : ''}. ${config.name || 'Jarvis'} here — here's what's up today.`;
	});

	// ——— This device: provider, key, models, limits.
	let prefs = $state(loadDevicePrefs());
	const persistDevice = () => saveDevicePrefs($state.snapshot(prefs));
	const provider = $derived(PROVIDERS.find((p) => p.id === prefs.provider)!);
	const spent = spentToday();

	let keys: Record<ProviderId, boolean> = $state({ anthropic: false, gemini: false });
	keyStatus().then((k) => (keys = k));
	let keyInput = $state('');
	let keyBusy = $state(false);

	let models: ModelInfo[] = $state([]);
	let test: { state: 'idle' | 'testing' | 'ok' | 'error'; message: string } = $state({
		state: 'idle',
		message: ''
	});

	function pickProvider(id: ProviderId) {
		prefs.provider = id;
		persistDevice();
		keyInput = '';
		models = [];
		test = { state: 'idle', message: '' };
	}

	async function storeKey(key: string | null) {
		keyBusy = true;
		try {
			await saveKey(prefs.provider, key);
			keys = await keyStatus();
			keyInput = '';
			if (key) await testConnection();
			else {
				models = [];
				test = { state: 'idle', message: '' };
			}
		} catch (e) {
			toast(`Couldn't save the key: ${e instanceof Error ? e.message : e}`, { tone: 'error' });
		} finally {
			keyBusy = false;
		}
	}

	/** Lists the provider's models with the saved key — proves the key works and fills the pickers. */
	async function testConnection() {
		const id = prefs.provider;
		test = { state: 'testing', message: '' };
		try {
			const adapter = await loadAdapter(id);
			const list = await adapter.listModels();
			if (prefs.provider !== id) return;
			models = list;
			// Keep your picks while they're offered; otherwise take the provider's best fit.
			const picks = adapter.pickDefaults(list);
			for (const slot of ['chat', 'background'] as ModelSlot[])
				if (!list.some((m) => m.id === prefs.models[id][slot]))
					prefs.models[id][slot] = picks[slot];
			persistDevice();
			test = { state: 'ok', message: `Connected — ${list.length} models available.` };
		} catch (e) {
			test = { state: 'error', message: e instanceof Error ? e.message : String(e) };
		}
	}

	const SLOTS: { id: ModelSlot; label: string; hint: string }[] = [
		{ id: 'chat', label: 'Chat model', hint: 'when you talk to it — the strongest pays off' },
		{
			id: 'background',
			label: 'Background model',
			hint: 'check-ins and watching for things on its own — a cheaper one is fine'
		}
	];

	// Kinds of change it can make, for "without asking".
	const WRITE_TOOLS = ALL_TOOLS.filter((t) => t.kind === 'write');

	function setPermission(tool: string, auto: boolean) {
		config.permissions[tool] = auto ? 'auto' : 'ask';
		persist();
	}

	// ——— What it remembers (synced).
	let memory: MemoryItem[] = $state([]);
	listMemory(uid)
		.then((items) => (memory = sortMemory(items)))
		.catch(() => {});
	let newMemory = $state('');
	let newKind: MemoryKind = $state('preference');
	let editing: { id: string; text: string } | null = $state(null);

	function addMemory() {
		const text = cleanMemoryText(newMemory);
		if (!text) return;
		const item: MemoryItem = { id: newMemoryId(uid), text, kind: newKind, updatedAt: Date.now() };
		memory = [item, ...memory];
		newMemory = '';
		saveMemory(uid, item).catch(saveFailed);
	}

	function saveEdit() {
		if (!editing) return;
		const { id } = editing;
		const text = cleanMemoryText(editing.text);
		editing = null;
		if (!text) return forgetMemory(id);
		memory = memory.map((m) => (m.id === id ? { ...m, text, updatedAt: Date.now() } : m));
		const item = memory.find((m) => m.id === id);
		if (item) saveMemory(uid, $state.snapshot(item)).catch(saveFailed);
	}

	function forgetMemory(id: string) {
		memory = memory.filter((m) => m.id !== id);
		deleteMemory(uid, id).catch(saveFailed);
	}

	const input = 'mt-1 block rounded-ctl border-line bg-card text-sm text-ink';
	const check = 'rounded border-line bg-card text-accent-fill';
	const subhead = 'text-sm font-medium text-ink';
</script>

<section class="rounded-card border border-line bg-card p-4 shadow-card">
	<h2 class="mb-3 text-xs font-semibold tracking-wide text-mute uppercase">Assistant</h2>

	<div class="space-y-6">
		<!-- Who it is -->
		<div class="space-y-3">
			<div class="flex flex-wrap gap-4">
				<label class="block">
					<span class="text-sm text-mute">Name</span>
					<input
						type="text"
						bind:value={config.name}
						oninput={persist}
						maxlength="24"
						placeholder="Jarvis"
						class="{input} w-40"
					/>
				</label>
				<label class="block">
					<span class="text-sm text-mute">Calls you</span>
					<input
						type="text"
						bind:value={config.addressAs}
						oninput={persist}
						maxlength="40"
						placeholder={addressName(DEFAULT_CONFIG, displayName) || 'your first name'}
						class="{input} w-40"
					/>
				</label>
			</div>
			<p class="text-sm text-faint italic">“{greeting}”</p>
		</div>

		<!-- Provider and key (this device) -->
		<div class="space-y-3">
			<div>
				<p class={subhead}>AI provider on this {desktop ? 'computer' : 'browser'}</p>
				<p class="text-xs text-faint">
					Your own API key. It stays on this device and is sent only to the provider —
					{desktop
						? 'kept in the system’s credential store, out of reach of web pages.'
						: 'kept in this browser’s storage, so only add it on a device you trust.'}
				</p>
			</div>
			<div class="flex flex-wrap gap-2" role="radiogroup" aria-label="AI provider">
				{#each PROVIDERS as p (p.id)}
					<button
						type="button"
						role="radio"
						aria-checked={prefs.provider === p.id}
						onclick={() => pickProvider(p.id)}
						class="rounded-ctl border px-3 py-1.5 text-sm {prefs.provider === p.id
							? 'border-accent text-accent ring-2 ring-accent/30'
							: 'border-line text-ink hover:border-accent/50'}"
					>
						{p.label}
						{#if keys[p.id]}<span class="ml-1 text-xs text-faint">· key saved</span>{/if}
					</button>
				{/each}
			</div>

			{#if keys[prefs.provider]}
				<div class="flex flex-wrap items-center gap-2 text-sm">
					<span class="text-ink">Key saved ✓</span>
					<button
						type="button"
						onclick={testConnection}
						disabled={test.state === 'testing'}
						class="rounded-ctl border border-line px-3 py-1 text-ink hover:border-accent/50 disabled:opacity-50"
					>
						{test.state === 'testing' ? 'Testing…' : 'Test connection'}
					</button>
					<button
						type="button"
						onclick={() => storeKey(null)}
						disabled={keyBusy}
						class="rounded-ctl px-3 py-1 text-mute hover:text-red-600 disabled:opacity-50"
					>
						Remove key
					</button>
				</div>
			{:else}
				<form
					class="flex flex-wrap items-end gap-2"
					onsubmit={(e) => {
						e.preventDefault();
						if (keyInput.trim()) storeKey(keyInput);
					}}
				>
					<label class="block">
						<span class="text-sm text-mute">API key</span>
						<input
							type="password"
							bind:value={keyInput}
							autocomplete="off"
							spellcheck="false"
							placeholder={provider.keyHint}
							class="{input} w-72 font-mono"
						/>
					</label>
					<button
						type="submit"
						disabled={keyBusy || !keyInput.trim()}
						class="rounded-ctl bg-accent-fill px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
					>
						{keyBusy ? 'Saving…' : 'Save key'}
					</button>
					<!-- eslint-disable svelte/no-navigation-without-resolve -- external site -->
					<a
						href={provider.keyUrl}
						target="_blank"
						rel="noreferrer"
						class="pb-2 text-sm text-accent hover:underline">Get a key</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				</form>
			{/if}
			{#if test.state === 'ok'}
				<p class="text-sm text-emerald-700 dark:text-emerald-400">{test.message}</p>
			{:else if test.state === 'error'}
				<p class="text-sm text-red-600 dark:text-red-400">{test.message}</p>
			{/if}

			<div class="grid gap-3 sm:grid-cols-2">
				{#each SLOTS as slot (slot.id)}
					<label class="block min-w-0">
						<span class="text-sm text-mute">{slot.label}</span>
						{#if models.length}
							<select
								bind:value={prefs.models[prefs.provider][slot.id]}
								onchange={persistDevice}
								class="{input} w-full"
							>
								{#each models as m (m.id)}
									<option value={m.id}>{m.label} ({m.id})</option>
								{/each}
							</select>
						{:else}
							<input
								type="text"
								bind:value={prefs.models[prefs.provider][slot.id]}
								onchange={persistDevice}
								spellcheck="false"
								class="{input} w-full font-mono"
							/>
						{/if}
						<span class="mt-0.5 block text-xs text-faint">{slot.hint}</span>
					</label>
				{/each}
			</div>

			<div class="grid gap-3 sm:grid-cols-2">
				{#each SLOTS as slot (slot.id)}
					<label class="block">
						<span class="text-sm text-mute">Daily limit — {slot.id} (thousand tokens)</span>
						<input
							type="number"
							min="0"
							step="50"
							value={Math.round(prefs.dailyTokens[slot.id] / 1000)}
							onchange={(e) => {
								prefs.dailyTokens[slot.id] = Math.max(0, Number(e.currentTarget.value) || 0) * 1000;
								persistDevice();
							}}
							class="{input} w-32"
						/>
						<span class="mt-0.5 block text-xs text-faint">
							{Math.round(spent[slot.id] / 1000)}k used today on this device
						</span>
					</label>
				{/each}
			</div>
		</div>

		<!-- Check-ins (synced) -->
		<div class="space-y-2">
			<div>
				<p class={subhead}>Check-ins</p>
				<p class="text-xs text-faint">
					When {config.name || 'Jarvis'} reaches out on its own. Whichever device is open runs them.
					<span class="text-mute">(They start working in an upcoming update.)</span>
				</p>
			</div>
			{#each config.checkins as checkin (checkin.id)}
				<div class="flex flex-wrap items-center gap-2">
					<input
						type="checkbox"
						bind:checked={checkin.enabled}
						onchange={persist}
						aria-label="Check-in on"
						class={check}
					/>
					<input
						type="time"
						bind:value={checkin.time}
						onchange={() => {
							if (!checkin.time) checkin.time = '12:00';
							config.checkins = sortCheckins(config.checkins);
							persist();
						}}
						aria-label="Check-in time"
						class="rounded-ctl border-line bg-card py-1 text-sm text-ink"
					/>
					<input
						type="text"
						bind:value={checkin.label}
						oninput={persist}
						maxlength="40"
						aria-label="Check-in name"
						class="w-44 rounded-ctl border-line bg-card py-1 text-sm text-ink"
					/>
					<select
						bind:value={checkin.kind}
						onchange={persist}
						aria-label="Check-in kind"
						class="rounded-ctl border-line bg-card py-1 text-sm text-ink"
					>
						{#each CHECKIN_KINDS as kind (kind.id)}
							<option value={kind.id}>{kind.label} — {kind.hint}</option>
						{/each}
					</select>
					<button
						type="button"
						onclick={() => removeCheckin(checkin.id)}
						aria-label="Remove check-in"
						class="px-1 text-faint hover:text-red-600">✕</button
					>
				</div>
			{/each}
			<button type="button" onclick={addCheckin} class="text-sm text-accent hover:underline">
				+ Add check-in
			</button>
		</div>

		<!-- Quiet hours and limits (synced) -->
		<div class="flex flex-wrap items-end gap-4">
			<label class="block">
				<span class="text-sm text-mute">Quiet from</span>
				<input
					type="time"
					bind:value={config.quietHours.start}
					onchange={persist}
					class="{input} py-1"
				/>
			</label>
			<label class="block">
				<span class="text-sm text-mute">until</span>
				<input
					type="time"
					bind:value={config.quietHours.end}
					onchange={persist}
					class="{input} py-1"
				/>
			</label>
			<label class="block">
				<span class="text-sm text-mute">Unprompted suggestions a day</span>
				<input
					type="number"
					min="0"
					max="50"
					bind:value={config.maxCardsPerDay}
					onchange={persist}
					class="{input} w-24 py-1"
				/>
			</label>
		</div>
		<p class="-mt-4 text-xs text-faint">
			No notifications during quiet hours — suggestions still collect for later.
		</p>

		<!-- What it can see (synced) -->
		<div class="space-y-2">
			<p class={subhead}>What it can see</p>
			<div class="grid gap-1.5 sm:grid-cols-2">
				{#each DATA_AREAS as area (area.id)}
					<label class="flex items-center gap-2 text-sm text-ink">
						<input
							type="checkbox"
							bind:checked={config.areas[area.id]}
							onchange={persist}
							class={check}
						/>
						{area.label}
					</label>
				{/each}
			</div>
			<p class="text-xs text-faint">
				Whatever it can see is sent to {provider.label} when it works on something.
			</p>
		</div>

		<!-- What it remembers (synced) -->
		<div class="space-y-2">
			<div>
				<p class={subhead}>What it remembers</p>
				<p class="text-xs text-faint">
					Preferences and facts it keeps between conversations. It adds to this when you tell it
					something lasting; edit or remove anything here.
				</p>
			</div>
			{#if memory.length}
				<ul class="divide-y divide-line rounded-ctl border border-line">
					{#each memory as item (item.id)}
						<li class="flex items-start gap-2 px-3 py-2 text-sm">
							<span class="mt-0.5 shrink-0 text-xs text-faint"
								>{item.kind === 'preference' ? 'Preference' : 'Fact'}</span
							>
							{#if editing?.id === item.id}
								<form
									class="flex min-w-0 flex-1 gap-2"
									onsubmit={(e) => {
										e.preventDefault();
										saveEdit();
									}}
								>
									<input
										bind:value={editing.text}
										maxlength={MEMORY_MAX_TEXT}
										aria-label="Memory"
										class="min-w-0 flex-1 rounded-ctl border-line bg-card py-1 text-sm text-ink"
									/>
									<button type="submit" class="text-xs font-medium text-accent hover:underline"
										>Save</button
									>
								</form>
							{:else}
								<span class="min-w-0 flex-1 text-ink">{item.text}</span>
								<button
									type="button"
									onclick={() => (editing = { id: item.id, text: item.text })}
									class="text-xs text-mute hover:text-ink">Edit</button
								>
								<button
									type="button"
									onclick={() => forgetMemory(item.id)}
									aria-label="Forget: {item.text}"
									class="text-xs text-mute hover:text-red-600">Forget</button
								>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-xs text-faint">Nothing yet.</p>
			{/if}
			<form
				class="flex flex-wrap items-center gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					addMemory();
				}}
			>
				<select
					bind:value={newKind}
					aria-label="Memory kind"
					class="rounded-ctl border-line bg-card py-1 text-sm text-ink"
				>
					<option value="preference">Preference</option>
					<option value="fact">Fact</option>
				</select>
				<input
					bind:value={newMemory}
					maxlength={MEMORY_MAX_TEXT}
					placeholder="e.g. Prefers deadlines planned a week ahead"
					aria-label="New memory"
					class="min-w-0 flex-1 rounded-ctl border-line bg-card py-1 text-sm text-ink"
				/>
				<button
					type="submit"
					disabled={!newMemory.trim()}
					class="rounded-ctl border border-line px-3 py-1 text-sm text-mute hover:text-ink disabled:opacity-50"
					>Add</button
				>
			</form>
		</div>

		<!-- Changes it may make without asking (synced) -->
		<div class="space-y-2">
			<div>
				<p class={subhead}>Changes it makes without asking</p>
				<p class="text-xs text-faint">
					Ticked kinds happen at once and show a bubble with Undo. The rest wait as a card in the
					chat and the Inbox for you to apply. It never deletes anything but its own memories.
				</p>
			</div>
			<div class="grid gap-1.5 sm:grid-cols-2">
				{#each WRITE_TOOLS as tool (tool.def.name)}
					<label class="flex items-center gap-2 text-sm text-ink">
						<input
							type="checkbox"
							checked={permissionFor(config, tool.def.name, !!tool.small) === 'auto'}
							onchange={(e) => setPermission(tool.def.name, e.currentTarget.checked)}
							class={check}
						/>
						{tool.label}
					</label>
				{/each}
			</div>
		</div>
	</div>
</section>
