<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		saveEvent,
		saveTask,
		type Deadline,
		type PlanTask,
		type ScheduleEvent,
		type ScheduleSlot
	} from '$lib/db';
	import {
		countdown,
		daysUntil,
		formatTimeRange,
		isDuty,
		occurrences,
		sortDeadlines,
		tasksInRange,
		upsert
	} from '$lib/schedule';
	import { saveFailed } from '$lib/toast.svelte';
	import { dateKey } from '$lib/date';
	import InboxList from './InboxList.svelte';

	let {
		uid,
		date,
		slots,
		events = $bindable(),
		tasks = $bindable(),
		deadlines
	}: {
		uid: string;
		date: string;
		slots: ScheduleSlot[];
		/** This day's stored events. */
		events: ScheduleEvent[];
		tasks: PlanTask[];
		deadlines: Deadline[];
	} = $props();

	const items = $derived(occurrences(slots, events, date, date));
	const dayTasks = $derived(tasksInRange(tasks, date, date));
	// Open deadlines that are overdue or due within a week — two weeks for hard ones.
	const soon = $derived(
		sortDeadlines(deadlines).filter(
			(d) => !d.done && d.due !== null && daysUntil(d.due, date) <= (d.hard ? 14 : 7)
		)
	);

	function toggleEvent(event: ScheduleEvent) {
		const next: ScheduleEvent = { ...event, status: event.status === 'done' ? 'planned' : 'done' };
		events = upsert(events, next);
		saveEvent(uid, next).catch(saveFailed);
	}

	function toggleTask(task: PlanTask) {
		const next: PlanTask = { ...task, status: task.status === 'done' ? 'open' : 'done' };
		tasks = upsert(tasks, next);
		saveTask(uid, next).catch(saveFailed);
	}

	const tick = (on: boolean) =>
		`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none ${
			on
				? 'border-green-500/40 bg-green-500/15 text-green-600 dark:text-green-400'
				: 'border-line bg-card text-transparent hover:text-faint'
		}`;
</script>

<section class="rounded-card border border-line bg-card p-4 shadow-card">
	<h2
		class="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-teal-600 uppercase dark:text-teal-400"
	>
		<span class="h-1.5 w-1.5 rounded-full bg-current"></span>
		Plan
		<a
			href={resolve('/schedule')}
			class="ml-auto font-normal text-teal-600 normal-case hover:underline dark:text-teal-400"
		>
			full schedule →
		</a>
	</h2>

	{#if date === dateKey()}
		<div class="mb-4 empty:hidden"><InboxList {uid} /></div>
	{/if}

	{#if items.length === 0 && dayTasks.length === 0 && soon.length === 0}
		<p class="text-sm text-faint">Nothing on the schedule for this day.</p>
	{/if}

	{#if items.length > 0}
		<ul class="space-y-1.5">
			{#each items as { event } (event.id)}
				{@const off = event.status === 'cancelled' || event.status === 'moved'}
				<li class="flex items-start gap-2 text-sm">
					{#if off}
						<span class="mt-0.5 h-4 w-4 shrink-0"></span>
					{:else}
						<button
							type="button"
							onclick={() => toggleEvent(event)}
							aria-label="{event.status === 'done' ? 'Mark not done' : 'Mark done'}: {event.title}"
							class={tick(event.status === 'done')}>✓</button
						>
					{/if}
					<span class="min-w-0 flex-1 leading-snug">
						<span class="text-xs text-mute tabular-nums"
							>{formatTimeRange(event.start, event.end)}</span
						>
						<span
							class="{event.status !== 'planned' ? 'text-faint line-through' : 'text-ink'} {isDuty(
								event.kind
							) && event.status === 'planned'
								? 'font-semibold text-amber-700 dark:text-amber-300'
								: ''}">{event.title}</span
						>
						{#if event.room}<span class="text-xs text-faint">· {event.room}</span>{/if}
						{#if event.status === 'cancelled'}
							<span class="text-xs font-semibold text-red-600 dark:text-red-400">cancelled</span>
						{:else if event.status === 'moved'}
							<span class="text-xs font-semibold text-red-600 dark:text-red-400">
								{event.note || 'moved'}
							</span>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if dayTasks.length > 0}
		<h3 class="mt-3 mb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Tasks</h3>
		<ul class="space-y-1.5">
			{#each dayTasks as task (task.id)}
				{@const closed = task.status === 'dropped' || task.status === 'moved'}
				<li class="flex items-start gap-2 text-sm">
					{#if closed}
						<span class="mt-0.5 h-4 w-4 shrink-0"></span>
					{:else}
						<button
							type="button"
							onclick={() => toggleTask(task)}
							aria-label="{task.status === 'done' ? 'Mark not done' : 'Mark done'}: {task.text}"
							class={tick(task.status === 'done')}>✓</button
						>
					{/if}
					<span class="min-w-0 flex-1 leading-snug">
						{#if task.start}
							<span class="text-xs text-mute tabular-nums"
								>{formatTimeRange(task.start, task.end)}</span
							>
						{/if}
						<span
							class="{task.status !== 'open'
								? 'text-faint line-through'
								: 'text-ink'} {task.highlight && task.status === 'open'
								? 'font-semibold text-green-700 dark:text-green-300'
								: ''}">{task.text}</span
						>
						{#if task.note && task.status === 'open'}
							<span class="text-xs font-semibold text-amber-600 dark:text-amber-400"
								>({task.note})</span
							>
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if soon.length > 0}
		<h3 class="mt-3 mb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Due soon</h3>
		<ul class="space-y-1">
			{#each soon as d (d.id)}
				{@const left = daysUntil(d.due!, date)}
				<li class="flex items-baseline gap-2 text-sm">
					<span
						class="min-w-0 flex-1 truncate {d.hard
							? 'font-semibold text-red-700 dark:text-red-300'
							: 'text-ink'}">{d.text}</span
					>
					<span
						class="shrink-0 text-xs {left < 0
							? 'text-red-600 dark:text-red-400'
							: left <= 2
								? 'text-amber-600 dark:text-amber-400'
								: 'text-faint'}">{countdown(d.due!, date)}</span
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>
