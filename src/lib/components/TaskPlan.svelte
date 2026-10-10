<script lang="ts">
	import type { PlanTask } from '$lib/db';
	import {
		compareTasks,
		formatTimeRange,
		groupBy,
		spanLabel,
		tasksInRange,
		type TaskAction
	} from '$lib/schedule';

	let {
		tasks,
		from,
		to,
		today,
		onaction,
		onadd
	}: {
		tasks: PlanTask[];
		/** First and last day shown; open tasks from before `from` appear under "Still open". */
		from: string;
		to: string;
		today: string;
		onaction: (action: TaskAction, task: PlanTask) => void;
		onadd: (fields: Pick<PlanTask, 'text' | 'date' | 'until' | 'start' | 'end'>) => void;
	} = $props();

	const overdue = $derived(
		tasks
			.filter((t) => t.date !== null && (t.until ?? t.date) < from && t.status === 'open')
			.sort(compareTasks)
	);
	// A span ("Fri–Sat") is its own group, like a day.
	const days = $derived(
		groupBy(tasksInRange(tasks, from, to), (t) => `${t.date}|${t.until ?? ''}`).sort(([a], [b]) =>
			a.localeCompare(b)
		)
	);
	const later = $derived(tasks.filter((t) => t.date === null).sort(compareTasks));

	let text = $state('');
	// svelte-ignore state_referenced_locally
	let date = $state(today);
	let until = $state('');
	let start = $state('');
	let end = $state('');

	function submit(e: SubmitEvent) {
		e.preventDefault();
		if (!text.trim()) return;
		onadd({
			text: text.trim(),
			date: date || null,
			until: date && until > date ? until : null,
			start,
			end
		});
		text = '';
		start = '';
		end = '';
	}

	const btn = 'rounded px-1.5 py-0.5 text-xs text-faint hover:bg-tint hover:text-ink';
</script>

{#snippet row(task: PlanTask)}
	{@const closed = task.status !== 'open'}
	<li class="group flex items-start gap-2 py-1">
		<button
			type="button"
			onclick={() => onaction('done', task)}
			aria-label="{task.status === 'done' ? 'Mark not done' : 'Mark done'}: {task.text}"
			class="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none print:hidden {task.status ===
			'done'
				? 'border-green-500/40 bg-green-500/15 text-green-600 dark:text-green-400'
				: 'border-line bg-card text-transparent hover:text-faint'}"
		>
			✓
		</button>
		<p class="min-w-0 flex-1 text-sm leading-snug">
			{#if task.start}
				<span class="tabular-nums {closed ? 'text-faint line-through' : 'text-mute'}">
					{formatTimeRange(task.start, task.end)}
				</span>
			{/if}
			<span
				class="{closed ? 'text-faint line-through' : 'text-ink'} {task.highlight && !closed
					? 'font-semibold'
					: ''}">{task.text}</span
			>
			{#if task.status === 'done'}
				<span class="font-semibold text-green-600 dark:text-green-400">Done</span>
			{:else if task.status === 'dropped' || task.status === 'moved'}
				<span class="font-semibold text-red-600 dark:text-red-400">
					{task.note || (task.status === 'dropped' ? 'Not needed' : 'Moved')}
				</span>
			{:else if task.note}
				<span class="font-semibold text-amber-600 dark:text-amber-400">({task.note})</span>
			{/if}
			{#if task.status === 'done' && task.note}
				<span class="text-faint">— {task.note}</span>
			{/if}
		</p>
		<span
			class="reveal flex shrink-0 gap-0.5 group-focus-within:opacity-100 group-hover:opacity-100 print:hidden"
		>
			{#if task.status === 'open'}
				<button
					type="button"
					onclick={() => onaction('drop', task)}
					class={btn}
					title="Not needed"
					aria-label="Not needed: {task.text}">⊘</button
				>
				<button
					type="button"
					onclick={() => onaction('move', task)}
					class={btn}
					title="Move to another day"
					aria-label="Move: {task.text}">⇢</button
				>
			{/if}
			<button
				type="button"
				onclick={() => onaction('edit', task)}
				class={btn}
				title="Edit"
				aria-label="Edit: {task.text}">✎</button
			>
			<button
				type="button"
				onclick={() => onaction('remove', task)}
				class="rounded px-1.5 py-0.5 text-xs text-faint hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
				title="Delete"
				aria-label="Delete: {task.text}">×</button
			>
		</span>
	</li>
{/snippet}

{#snippet group(label: string, list: PlanTask[], current = false, tone = '')}
	{@const protectedBlock = list.some((t) => t.highlight && t.status === 'open')}
	<div
		class="grid gap-x-4 border-t border-line px-4 py-2 first:border-t-0 sm:grid-cols-[9rem_minmax(0,1fr)] print:px-2 {protectedBlock
			? 'bg-green-500/8'
			: ''} {tone}"
	>
		<h3 class="pt-1 text-sm font-semibold {current ? 'text-accent' : 'text-ink'}">{label}</h3>
		<ul>
			{#each list as task (task.id)}
				{@render row(task)}
			{/each}
		</ul>
	</div>
{/snippet}

<section
	class="rounded-card border border-line bg-card shadow-card print:border-0 print:shadow-none"
>
	<header class="border-b border-line px-4 py-3 print:px-0">
		<h2 class="font-display text-base font-bold text-ink">Day by day</h2>
	</header>

	{#if overdue.length === 0 && days.length === 0 && later.length === 0}
		<p class="px-4 py-4 text-sm text-faint">No tasks planned yet — add one below.</p>
	{/if}

	{#if overdue.length > 0}
		{@render group('Still open', overdue, false, 'bg-red-500/6')}
	{/if}
	{#each days as [key, list] (key)}
		{@const [d, u] = key.split('|')}
		{@render group(spanLabel(d, u || null), list, today >= d && today <= (u || d))}
	{/each}
	{#if later.length > 0}
		{@render group('Later', later)}
	{/if}

	<form
		onsubmit={submit}
		class="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3 print:hidden"
	>
		<input
			type="text"
			bind:value={text}
			placeholder="+ Task (e.g. Create SWE questions)"
			aria-label="New task"
			class="min-w-48 flex-1 rounded-ctl border-line bg-card text-sm text-ink"
		/>
		<input
			type="date"
			bind:value={date}
			aria-label="Day (empty for Later)"
			title="Day — clear it for Later"
			class="rounded-ctl border-line bg-card text-sm text-ink"
		/>
		<input
			type="date"
			bind:value={until}
			min={date}
			disabled={!date}
			aria-label="Until (optional, for a span of days)"
			title="Until — optional, for a span of days"
			class="rounded-ctl border-line bg-card text-sm text-ink disabled:opacity-50"
		/>
		<input
			type="time"
			bind:value={start}
			aria-label="From (optional)"
			class="w-28 rounded-ctl border-line bg-card text-sm text-ink"
		/>
		<input
			type="time"
			bind:value={end}
			aria-label="To (optional)"
			class="w-28 rounded-ctl border-line bg-card text-sm text-ink"
		/>
		<button
			type="submit"
			class="rounded-ctl bg-accent-fill px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90"
		>
			Add
		</button>
	</form>
</section>
