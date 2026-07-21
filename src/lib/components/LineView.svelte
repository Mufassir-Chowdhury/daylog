<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Line } from '$lib/parse';

	let { line, ontoggle }: { line: Line; ontoggle?: () => void } = $props();
</script>

<p class="leading-relaxed whitespace-pre-wrap {line.done ? 'text-gray-400' : 'text-gray-800'}">
	{#if ontoggle}
		<button
			type="button"
			onclick={ontoggle}
			aria-label={line.done ? 'Cross back in' : 'Cross out'}
			class="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full border align-text-bottom text-[10px] leading-none {line.done
				? 'border-green-300 bg-green-100 text-green-700'
				: 'border-gray-300 bg-white text-transparent hover:text-gray-300'}"
		>
			✓
		</button>
	{/if}{#if line.timeLabel}
		<span
			class="mr-2 inline-block rounded px-1.5 py-0.5 font-mono text-xs font-semibold {line.done
				? 'bg-gray-100 text-gray-400'
				: 'bg-amber-100 text-amber-800'}"
		>
			{line.timeLabel}
		</span>
	{/if}<span class={line.done ? 'line-through' : ''}
		>{#each line.segments as segment, i (i)}{#if segment.kind === 'mention'}<a
					href={resolve('/people/[handle]', { handle: segment.handle })}
					class="font-medium {line.done ? 'text-gray-400' : 'text-blue-600'} hover:underline"
					>{segment.text}</a
				>{:else}{segment.text}{/if}{/each}</span
	>
</p>
