<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Line } from '$lib/parse';

	let { line }: { line: Line } = $props();
</script>

<p class="leading-relaxed whitespace-pre-wrap text-gray-800">
	{#if line.timeLabel}
		<span
			class="mr-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-amber-800"
		>
			{line.timeLabel}
		</span>
	{/if}{#each line.segments as segment, i (i)}{#if segment.kind === 'mention'}<a
				href={resolve('/people/[handle]', { handle: segment.handle })}
				class="font-medium text-blue-600 hover:underline">{segment.text}</a
			>{:else}{segment.text}{/if}{/each}
</p>
