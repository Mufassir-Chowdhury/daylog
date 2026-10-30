<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		ask,
		assistant,
		closeAssistant,
		newConversation,
		refreshIdentity
	} from '$lib/ai/assistant.svelte';
	import { describeView } from '$lib/ai/prompt';
	import { session } from '$lib/auth.svelte';
	import { go } from '$lib/nav';
	import { tick } from 'svelte';

	const uid = session.user!.uid;
	const displayName = session.user!.displayName;
	refreshIdentity(uid, displayName);

	let draft = $state('');
	let input: HTMLTextAreaElement | undefined = $state();
	let list: HTMLElement | undefined = $state();

	function send(text = draft) {
		if (!text.trim() || assistant.busy) return;
		draft = '';
		ask(text, {
			uid,
			displayName,
			view: describeView(page.url),
			navigate: (path) => go(path)
		});
	}

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
			{#each assistant.entries as entry (entry.id)}
				{#if entry.role === 'user'}
					<p
						class="ml-auto w-fit max-w-[85%] rounded-card bg-accent/10 px-3 py-2 text-sm whitespace-pre-wrap text-ink"
					>
						{entry.text}
					</p>
				{:else if entry.role === 'assistant'}
					<div class="max-w-[95%]">
						<p class="text-sm leading-relaxed whitespace-pre-wrap text-ink">{entry.text}</p>
						{#if entry.steps?.length}
							<p class="mt-1 text-xs text-faint">{unique(entry.steps).join(' · ')}</p>
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
				{/if}
			{:else}
				<div class="space-y-4 pt-6">
					<p class="text-ink">
						{greeting}{assistant.address ? `, ${assistant.address}` : ''}. What can I look into?
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
			<textarea
				bind:this={input}
				bind:value={draft}
				{onkeydown}
				rows="2"
				aria-label="Message"
				placeholder="Ask {assistant.name}…"
				class="min-h-0 flex-1 resize-none rounded-ctl border-line bg-canvas text-sm text-ink"
			></textarea>
			<button
				type="submit"
				disabled={assistant.busy || !draft.trim()}
				class="rounded-ctl bg-accent-fill px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
			>
				Send
			</button>
		</form>
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
