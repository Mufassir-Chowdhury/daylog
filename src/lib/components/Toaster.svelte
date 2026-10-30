<script lang="ts">
	import { dismiss, toasts } from '$lib/toast.svelte';
	import { fly } from 'svelte/transition';
	import Icon from './Icon.svelte';
</script>

<div
	class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 print:hidden"
	aria-live="polite"
>
	{#each toasts as t (t.id)}
		<div
			transition:fly={{ y: 12, duration: 160 }}
			class="pointer-events-auto flex max-w-md items-center gap-3 rounded-ctl border px-4 py-2.5 text-sm shadow-lg {t.tone ===
			'error'
				? 'border-red-500/30 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200'
				: 'border-line bg-ink text-canvas'}"
			role={t.tone === 'error' ? 'alert' : 'status'}
		>
			<span>
				{#if t.from}<span class="mr-1 inline-flex items-center gap-1 font-semibold"
						><Icon name="sparkle" size={13} />{t.from}</span
					>{/if}{t.message}
			</span>
			{#if t.undo}
				<button
					type="button"
					onclick={() => {
						t.undo?.();
						dismiss(t.id);
					}}
					class="rounded-ctl bg-canvas/15 px-2.5 py-1 font-semibold ring-1 ring-canvas/30 hover:bg-canvas/25"
				>
					Undo
				</button>
			{/if}
			<button
				type="button"
				onclick={() => dismiss(t.id)}
				aria-label="Dismiss"
				class="opacity-60 hover:opacity-100">✕</button
			>
		</div>
	{/each}
</div>
