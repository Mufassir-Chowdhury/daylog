<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		onclose,
		children
	}: {
		title: Snippet;
		onclose: () => void;
		children: Snippet;
	} = $props();

	// A native modal <dialog> gives us focus trapping, Escape and inert background for free.
	function open(node: HTMLDialogElement) {
		node.showModal();
		return () => node.close();
	}
</script>

<dialog
	{@attach open}
	{onclose}
	onclick={(e) => e.target === e.currentTarget && onclose()}
	class="drawer m-0 ml-auto h-dvh max-h-dvh w-full max-w-2xl overflow-hidden border-l border-line bg-canvas p-0 text-ink shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-[2px]"
>
	<div class="flex h-full flex-col">
		<header class="flex items-center gap-3 border-b border-line bg-card px-5 py-4">
			<div class="min-w-0 flex-1">{@render title()}</div>
			<button
				type="button"
				onclick={onclose}
				aria-label="Close"
				class="rounded-ctl px-2.5 py-1.5 text-mute hover:bg-tint hover:text-ink">✕</button
			>
		</header>
		<div class="flex-1 overflow-y-auto px-5 py-4">
			{@render children()}
		</div>
	</div>
</dialog>

<style>
	.drawer[open] {
		animation: slide-in 180ms ease-out;
	}
	@keyframes slide-in {
		from {
			transform: translateX(24px);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.drawer[open] {
			animation: none;
		}
	}
</style>
