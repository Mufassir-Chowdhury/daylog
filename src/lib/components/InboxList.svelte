<script lang="ts">
	import { assistant } from '$lib/ai/assistant.svelte';
	import { pendingItems, type InboxItem } from '$lib/ai/inbox';
	import { inbox } from '$lib/ai/inbox.svelte';
	import InboxCard from './InboxCard.svelte';

	let {
		uid,
		exclude = [],
		match = () => true,
		title = `From ${assistant.name}`
	}: {
		uid: string;
		/** Cards already shown elsewhere (in the chat). */
		exclude?: string[];
		/** Only cards this accepts. */
		match?: (item: InboxItem) => boolean;
		title?: string;
	} = $props();

	// Cards stay in view after you act on them, until you leave the page.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a memo of ids, not state
	const seen = new Set<string>();
	const items = $derived.by(() => {
		const now = Date.now();
		const waiting = new Set(pendingItems(inbox.items, now).map((i) => i.id));
		for (const id of waiting) seen.add(id);
		return inbox.items
			.filter((i) => seen.has(i.id) && !exclude.includes(i.id) && match(i))
			.sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
	});
</script>

{#if items.length}
	<section aria-label="Inbox" class="space-y-2">
		<h3
			class="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-accent uppercase"
		>
			<span class="h-1.5 w-1.5 rounded-full bg-current"></span>
			{title}
		</h3>
		{#each items as item (item.id)}
			<InboxCard {uid} {item} />
		{/each}
	</section>
{/if}
