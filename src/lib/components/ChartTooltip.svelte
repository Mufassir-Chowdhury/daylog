<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		x,
		y = 0,
		children
	}: {
		/** Horizontal anchor as a percentage (0–100) of the chart's width. */
		x: number;
		/** Vertical offset in px from the top of the chart. */
		y?: number;
		children: Snippet;
	} = $props();

	// Flip to the anchor's left once past the middle so it never runs off the card.
	const flip = $derived(x > 55);
</script>

<div
	role="tooltip"
	class="pointer-events-none absolute z-20 min-w-40 rounded-ctl border border-line bg-card px-3 py-2 text-xs shadow-lg"
	style:left="{x}%"
	style:top="{y}px"
	style:transform={flip ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)'}
>
	{@render children()}
</div>
