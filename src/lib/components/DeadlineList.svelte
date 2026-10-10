<script lang="ts">
	import type { Deadline } from '$lib/db';
	import { countdown, daysUntil, deadlineWhen, sortDeadlines } from '$lib/schedule';

	let {
		deadlines,
		today,
		onaction,
		onadd
	}: {
		deadlines: Deadline[];
		today: string;
		onaction: (action: 'done' | 'edit' | 'remove', deadline: Deadline) => void;
		onadd: () => void;
	} = $props();

	const sorted = $derived(sortDeadlines(deadlines));
	const btn = 'rounded px-1.5 py-0.5 text-xs text-faint hover:bg-tint hover:text-ink';
</script>

<section
	class="rounded-card border border-line bg-card shadow-card print:border-0 print:shadow-none"
>
	<header class="flex items-center border-b border-line px-4 py-3 print:px-0">
		<h2 class="font-display text-base font-bold text-ink">Deadlines</h2>
		<button
			type="button"
			onclick={onadd}
			class="ml-auto rounded-ctl border border-line px-2 py-1 text-xs font-medium text-mute hover:bg-tint hover:text-ink print:hidden"
		>
			+ Deadline
		</button>
	</header>
	{#if sorted.length === 0}
		<p class="px-4 py-4 text-sm text-faint">No deadlines yet.</p>
	{:else}
		<ul>
			{#each sorted as d (d.id)}
				{@const left = d.due && !d.done ? daysUntil(d.due, today) : null}
				<li
					class="group grid grid-cols-[8.5rem_minmax(0,1fr)_auto] items-start gap-x-3 border-t border-line px-4 py-2 text-sm first:border-t-0 print:px-2 {d.hard &&
					!d.done
						? 'bg-red-500/8'
						: ''}"
				>
					<span class="font-semibold {d.done ? 'text-faint' : 'text-ink'}">
						{deadlineWhen(d)}
						{#if left !== null}
							<span
								class="block text-xs font-normal {left < 0
									? 'text-red-600 dark:text-red-400'
									: left <= 3
										? 'text-amber-600 dark:text-amber-400'
										: 'text-faint'}"
							>
								{countdown(d.due!, today)}
							</span>
						{/if}
					</span>
					<span class="min-w-0">
						<span
							class="{d.done ? 'text-faint line-through' : 'text-ink'} {d.hard && !d.done
								? 'font-semibold'
								: ''}">{d.text}</span
						>
						{#if d.done}
							<span class="font-semibold text-green-600 dark:text-green-400">Done</span>
						{/if}
						{#if d.note}
							<span class="text-mute">({d.note})</span>
						{/if}
					</span>
					<span
						class="reveal flex shrink-0 gap-0.5 group-focus-within:opacity-100 group-hover:opacity-100 print:hidden"
					>
						<button
							type="button"
							onclick={() => onaction('done', d)}
							class={btn}
							title={d.done ? 'Mark not done' : 'Mark done'}
							aria-label="{d.done ? 'Mark not done' : 'Mark done'}: {d.text}">✓</button
						>
						<button
							type="button"
							onclick={() => onaction('edit', d)}
							class={btn}
							title="Edit"
							aria-label="Edit: {d.text}">✎</button
						>
						<button
							type="button"
							onclick={() => onaction('remove', d)}
							class="rounded px-1.5 py-0.5 text-xs text-faint hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
							title="Delete"
							aria-label="Delete: {d.text}">×</button
						>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>
