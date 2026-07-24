<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Line } from '$lib/parse';

	let { line, ontoggle }: { line: Line; ontoggle?: () => void } = $props();
</script>

<p class="leading-relaxed whitespace-pre-wrap {line.done ? 'text-faint' : 'text-ink'}">
	{#if ontoggle}
		<button
			type="button"
			onclick={ontoggle}
			aria-label={line.done ? 'Cross back in' : 'Cross out'}
			class="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full border align-text-bottom text-[10px] leading-none {line.done
				? 'border-green-500/40 bg-green-500/15 text-green-600 dark:text-green-400'
				: 'border-line bg-card text-transparent hover:text-faint'}"
		>
			✓
		</button>
	{/if}{#if line.timeLabel}
		<span
			class="mr-2 inline-block rounded px-1.5 py-0.5 font-mono text-xs font-semibold {line.done
				? 'bg-tint text-faint'
				: 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}"
		>
			{line.timeLabel}
		</span>
	{/if}<span class={line.done ? 'line-through' : ''}
		>{#each line.segments as segment, i (i)}{#if segment.kind === 'mention'}<a
					href={resolve('/people/[handle]', { handle: segment.handle })}
					class="font-medium {line.done ? 'text-faint' : 'text-accent'} hover:underline"
					>{segment.text}</a
				>{:else}{segment.text}{/if}{/each}</span
	>
</p>
