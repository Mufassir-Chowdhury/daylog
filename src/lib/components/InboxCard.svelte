<script lang="ts">
	import { assistant } from '$lib/ai/assistant.svelte';
	import { applyItem, applying, dismissItem, undoItem } from '$lib/ai/inbox.svelte';
	import type { InboxItem } from '$lib/ai/inbox';
	import Icon from './Icon.svelte';

	let { uid, item }: { uid: string; item: InboxItem } = $props();

	/** Tick to stop asking for this kind of change. */
	let always = $state(false);
	const working = $derived(applying.has(item.id));
	const expired = $derived(item.status === 'pending' && item.expiresAt <= Date.now());
</script>

<div
	class="rounded-card border border-line bg-card p-3 shadow-card"
	role="group"
	aria-label={item.kind === 'brief' ? item.title : 'Proposed change'}
>
	<p class="text-sm font-medium text-ink">{item.title}</p>
	{#if item.body}
		<p class="mt-1 text-sm whitespace-pre-wrap text-mute">{item.body}</p>
	{/if}
	{#if item.details.length}
		<ul class="mt-1 space-y-0.5 text-xs text-faint">
			{#each item.details as line, i (i)}<li>{line}</li>{/each}
		</ul>
	{/if}
	<div class="mt-2 flex flex-wrap items-center gap-2 text-sm">
		{#if expired}
			<span class="text-faint">Expired — ask again if it's still wanted.</span>
		{:else if item.status === 'pending'}
			{#if item.kind === 'proposal'}
				<button
					type="button"
					onclick={() => applyItem(uid, item.id, { always, from: assistant.name })}
					disabled={working}
					class="rounded-ctl bg-accent-fill px-3 py-1 font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
				>
					{working ? 'Applying…' : 'Apply'}
				</button>
			{/if}
			<button
				type="button"
				onclick={() => dismissItem(uid, item.id)}
				disabled={working}
				class="rounded-ctl px-3 py-1 text-mute hover:bg-tint hover:text-ink disabled:opacity-50"
			>
				Dismiss
			</button>
			{#if item.kind === 'proposal' && item.tool}
				<label class="ml-auto flex items-center gap-1.5 text-xs text-faint">
					<input
						type="checkbox"
						bind:checked={always}
						class="rounded border-line bg-card text-accent-fill"
					/>
					Always do this without asking
				</label>
			{/if}
		{:else if item.status === 'applied'}
			<span class="flex items-center gap-1 text-accent"
				><Icon name="check" size={14} /> Applied</span
			>
			<button
				type="button"
				onclick={() => undoItem(uid, item.id)}
				class="text-xs font-medium text-accent hover:underline">Undo</button
			>
		{:else if item.status === 'undone'}
			<span class="text-faint">Applied, then undone</span>
		{:else if item.status === 'dismissed'}
			<span class="text-faint">Dismissed</span>
		{:else}
			<span class="text-amber-600 dark:text-amber-400"
				>Things changed since this was proposed — ask again.</span
			>
		{/if}
	</div>
</div>
