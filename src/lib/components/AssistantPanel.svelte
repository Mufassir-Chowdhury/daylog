<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		ask,
		assistant,
		closeAssistant,
		newConversation,
		refreshIdentity,
		restoreConversation,
		undoAction,
		type ChatEntry
	} from '$lib/ai/assistant.svelte';
	import { inboxItem } from '$lib/ai/inbox.svelte';
	import { describeView } from '$lib/ai/prompt';
	import { session } from '$lib/auth.svelte';
	import { go } from '$lib/nav';
	import { tick } from 'svelte';
	import Icon from './Icon.svelte';
	import InboxCard from './InboxCard.svelte';
	import InboxList from './InboxList.svelte';
	import { loadDevicePrefs } from '$lib/ai/device';
	import {
		cancelListening,
		listen,
		speak,
		stopListening,
		stopSpeaking,
		voice
	} from '$lib/ai/voice.svelte';
	import { onDestroy } from 'svelte';

	const uid = session.user!.uid;
	const displayName = session.user!.displayName;
	refreshIdentity(uid, displayName);
	restoreConversation(uid);

	/** Cards already in the conversation; the rest of the Inbox shows above it. */
	const inChat = $derived(assistant.entries.flatMap((e) => e.cards ?? []));

	let draft = $state('');
	let input: HTMLTextAreaElement | undefined = $state();
	let list: HTMLElement | undefined = $state();

	async function send(text = draft, spoken = false) {
		if (!text.trim() || assistant.busy) return;
		draft = '';
		await ask(text, {
			uid,
			displayName,
			view: describeView(page.url),
			navigate: (path) => go(path),
			spoken
		});
		// Asked aloud, answered aloud (Settings → Voice can turn that off).
		const last = assistant.entries.at(-1);
		if (spoken && last?.role === 'assistant' && last.text && loadDevicePrefs().voice.speakReplies)
			speak(last.text);
	}

	// ——— Voice: tap to talk, tap again (or pause) to finish.
	async function talk() {
		if (voice.phase === 'listening') return stopListening();
		if (voice.phase !== 'idle' || assistant.busy) return;
		const said = await listen();
		if (said) send(said, true);
	}

	onDestroy(() => {
		cancelListening();
		stopSpeaking();
	});

	// A question handed over from the palette or the quick bar.
	$effect(() => {
		if (assistant.pending && !assistant.busy) {
			const question = assistant.pending;
			assistant.pending = '';
			send(question);
		}
	});

	// Keep the newest message in view.
	$effect(() => {
		void assistant.entries.length;
		void assistant.step;
		tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			send();
		}
	}

	function open(node: HTMLDialogElement) {
		node.showModal();
		input?.focus();
		return () => node.close();
	}

	const hour = new Date().getHours();
	const greeting = `Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}`;

	const SUGGESTIONS = [
		"What's up today?",
		'What did I leave unfinished?',
		'Any deadlines coming up?',
		'How is my spending this month?'
	];

	/** Each distinct step once, in order. */
	const unique = (steps: string[]) => [...new Set(steps)];
</script>

{#snippet changes(entry: ChatEntry)}
	{#each entry.done ?? [] as action, i (i)}
		<p class="flex items-center gap-1.5 text-sm text-mute">
			<Icon name="check" size={14} class="shrink-0 text-accent" />
			<span class="min-w-0 flex-1" class:line-through={action.undone}>{action.summary}</span>
			{#if action.undone}
				<span class="text-xs text-faint">undone</span>
			{:else}
				<button
					type="button"
					onclick={() => undoAction(uid, action)}
					class="text-xs font-medium text-accent hover:underline">Undo</button
				>
			{/if}
		</p>
	{/each}
	{#each entry.cards ?? [] as id (id)}
		{@const item = inboxItem(id)}
		{#if item}
			<InboxCard {uid} {item} />
		{:else}
			<p class="text-xs text-faint">A proposal that's no longer in the Inbox.</p>
		{/if}
	{/each}
{/snippet}

<dialog
	{@attach open}
	onclose={closeAssistant}
	onclick={(e) => e.target === e.currentTarget && closeAssistant()}
	aria-label={assistant.name}
	class="assistant-panel m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl overflow-hidden border-l border-line bg-canvas p-0 text-ink shadow-2xl backdrop:bg-black/30 backdrop:backdrop-blur-[2px]"
>
	<div class="flex h-full flex-col">
		<header class="flex items-center gap-3 border-b border-line bg-card px-5 py-3">
			<span class="palette-orb" class:palette-orb-busy={assistant.busy} aria-hidden="true"></span>
			<div class="min-w-0 flex-1">
				<h2 class="font-display text-lg leading-tight font-bold">{assistant.name}</h2>
				<p class="truncate text-xs text-faint" aria-live="polite">
					{assistant.busy ? assistant.step || 'Thinking…' : 'At your service.'}
				</p>
			</div>
			{#if voice.speaking}
				<button
					type="button"
					onclick={stopSpeaking}
					class="rounded-ctl px-2.5 py-1.5 text-sm text-accent hover:bg-tint">Stop speaking</button
				>
			{/if}
			{#if assistant.entries.length}
				<button
					type="button"
					onclick={() => {
						newConversation();
						input?.focus();
					}}
					disabled={assistant.busy}
					class="rounded-ctl px-2.5 py-1.5 text-sm text-mute hover:bg-tint hover:text-ink disabled:opacity-50"
				>
					New conversation
				</button>
			{/if}
			<button
				type="button"
				onclick={closeAssistant}
				aria-label="Close"
				class="rounded-ctl px-2.5 py-1.5 text-mute hover:bg-tint hover:text-ink">✕</button
			>
		</header>

		<div bind:this={list} class="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
			<InboxList {uid} exclude={inChat} title="Waiting for you" />
			{#each assistant.entries as entry (entry.id)}
				{#if entry.role === 'user'}
					<p
						class="ml-auto w-fit max-w-[85%] rounded-card bg-accent/10 px-3 py-2 text-sm whitespace-pre-wrap text-ink"
					>
						{#if entry.spoken}<span class="sr-only">Said aloud: </span><span
								aria-hidden="true"
								title="Said aloud">🎙</span
							>{/if}
						{entry.text}
					</p>
				{:else if entry.role === 'assistant'}
					<div class="max-w-[95%] space-y-2">
						{#if entry.text}
							<p class="text-sm leading-relaxed whitespace-pre-wrap text-ink">{entry.text}</p>
							{#if voice.available}
								<button
									type="button"
									onclick={() => speak(entry.text)}
									class="text-xs text-faint hover:text-ink">Read aloud</button
								>
							{/if}
						{/if}
						{@render changes(entry)}
						{#if entry.steps?.length}
							<p class="text-xs text-faint">{unique(entry.steps).join(' · ')}</p>
						{/if}
					</div>
				{:else}
					<div
						class="rounded-card border border-red-500/30 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200"
						role="alert"
					>
						{entry.text}
						{#if entry.errorKind === 'no_key' || entry.errorKind === 'auth' || entry.errorKind === 'budget'}
							<a
								href={resolve('/settings')}
								onclick={closeAssistant}
								class="ml-1 font-medium underline">Open Settings</a
							>
						{/if}
					</div>
					{@render changes(entry)}
				{/if}
			{:else}
				<div class="space-y-4 pt-6">
					<p class="text-ink">
						{greeting}{assistant.address ? `, ${assistant.address}` : ''}. What can I look into?
					</p>
					<p class="text-sm text-mute">
						Not sure what to ask? See
						<a
							href="{resolve('/help')}#assistant"
							onclick={closeAssistant}
							class="font-medium text-accent hover:underline">what I can do</a
						>.
					</p>
					<div class="flex flex-wrap gap-2">
						{#each SUGGESTIONS as suggestion (suggestion)}
							<button
								type="button"
								onclick={() => send(suggestion)}
								class="rounded-ctl border border-line bg-card px-3 py-1.5 text-sm text-mute hover:border-accent/50 hover:text-ink"
							>
								{suggestion}
							</button>
						{/each}
					</div>
				</div>
			{/each}
			{#if assistant.busy}
				<p class="text-sm text-faint italic">{assistant.step || 'Thinking…'}</p>
			{/if}
		</div>

		<form
			class="flex items-end gap-2 border-t border-line bg-card p-3"
			onsubmit={(e) => {
				e.preventDefault();
				send();
			}}
		>
			{#if voice.phase === 'idle'}
				<textarea
					bind:this={input}
					bind:value={draft}
					{onkeydown}
					rows="2"
					aria-label="Message"
					placeholder="Ask {assistant.name}…"
					class="min-h-0 flex-1 resize-none rounded-ctl border-line bg-canvas text-sm text-ink"
				></textarea>
			{:else}
				<div
					class="flex min-h-[3.25rem] flex-1 items-center gap-3 px-1 text-sm text-mute"
					aria-live="polite"
				>
					{#if voice.phase === 'listening'}
						<span class="relative flex h-3 w-3" aria-hidden="true">
							<span
								class="absolute inset-0 rounded-full bg-red-500 opacity-60"
								style:transform="scale({1 + voice.level * 1.5})"
							></span>
							<span class="relative h-3 w-3 rounded-full bg-red-500"></span>
						</span>
						Listening — pause or tap the mic when you're done.
					{:else}
						Writing down what you said…
					{/if}
				</div>
			{/if}
			{#if voice.available}
				<button
					type="button"
					onclick={talk}
					disabled={assistant.busy || voice.phase === 'transcribing'}
					aria-label={voice.phase === 'listening' ? 'Done talking' : `Talk to ${assistant.name}`}
					aria-pressed={voice.phase === 'listening'}
					title={voice.phase === 'listening' ? 'Done talking' : 'Talk (voice)'}
					class="rounded-ctl border px-3 py-2 text-sm disabled:opacity-50 {voice.phase ===
					'listening'
						? 'border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400'
						: 'border-line text-mute hover:bg-tint hover:text-ink'}"
				>
					{voice.phase === 'listening' ? 'Done' : '🎙'}
				</button>
			{/if}
			<button
				type="submit"
				disabled={assistant.busy || !draft.trim() || voice.phase !== 'idle'}
				class="rounded-ctl bg-accent-fill px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
			>
				Send
			</button>
		</form>
		{#if voice.error}
			<p
				class="border-t border-line bg-card px-3 pb-2 text-xs text-red-600 dark:text-red-400"
				role="alert"
			>
				{voice.error}
			</p>
		{/if}
	</div>
</dialog>

<style>
	.assistant-panel[open] {
		animation: slide-in 180ms ease-out;
	}
	@keyframes slide-in {
		from {
			transform: translateX(24px);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.assistant-panel[open] {
			animation: none;
		}
	}
</style>
