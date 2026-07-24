<script lang="ts">
	import { dateKey } from '$lib/date';
	import { monthLabel, monthOf } from '$lib/finance';
	import { elapsedDays, monthlyRoutineStats } from '$lib/routines';

	let { data } = $props();

	const routines = $derived(data.routines);
	const today = dateKey();
	const thisMonth = monthOf(today);

	const months = $derived(monthlyRoutineStats(data.logs, today));

	// One decimal is enough for a daily average; totals stay whole-ish.
	const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
</script>

<h1 class="font-display text-2xl font-bold tracking-tight text-ink">Routines</h1>
<p class="mt-1 text-sm text-mute">
	Monthly totals for your daily routines — log values from the Routines panel on any day page.
	Averages divide by the days of the month so far, not just the days you logged.
</p>

{#if routines.length === 0}
	<p class="mt-4 text-sm text-faint">
		No routines added yet — add one from the Routines panel on a day page, or from Settings.
	</p>
{/if}

<div class="mt-5 grid items-start gap-4 lg:grid-cols-2">
	{#each months as { month, stats } (month)}
		{@const current = month === thisMonth}
		{@const rows = routines.filter((r) => current || stats.has(r.id))}
		{@const days = elapsedDays(month, today)}
		{#if rows.length > 0}
			<section class="rounded-card border border-line bg-card p-4 shadow-card">
				<p class="mb-2 flex items-baseline border-b border-line pb-2">
					<span class="font-display text-sm font-semibold text-ink">{monthLabel(month)}</span>
					{#if current}
						<span
							class="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent"
						>
							so far
						</span>
					{/if}
					<span class="ml-auto text-xs text-faint">over {days} days</span>
				</p>
				<div class="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-4 gap-y-1">
					<span class="text-xs font-semibold tracking-wide text-faint uppercase">Routine</span>
					<span class="text-right text-xs font-semibold tracking-wide text-faint uppercase"
						>Total</span
					>
					<span class="text-right text-xs font-semibold tracking-wide text-faint uppercase"
						>Days</span
					>
					<span class="text-right text-xs font-semibold tracking-wide text-faint uppercase"
						>Avg/day</span
					>
					{#each rows as routine (routine.id)}
						{@const s = stats.get(routine.id) ?? { total: 0, count: 0, average: 0 }}
						{@const met = routine.threshold > 0 && s.average >= routine.threshold}
						<span class="truncate text-sm font-medium text-ink">
							{routine.name}
							{#if routine.threshold > 0}
								<span class="font-normal text-faint">
									· target {routine.threshold}{routine.unit ? ` ${routine.unit}` : ''}/day
								</span>
							{/if}
						</span>
						<span class="text-right text-sm text-ink tabular-nums">
							{NUM.format(s.total)}{routine.unit ? ` ${routine.unit}` : ''}
						</span>
						<span class="text-right text-sm text-mute tabular-nums">{s.count}</span>
						<span
							class="text-right text-sm font-medium tabular-nums {met
								? 'text-green-600 dark:text-green-400'
								: 'text-ink'}"
						>
							{NUM.format(s.average)}
						</span>
					{/each}
				</div>
			</section>
		{/if}
	{/each}
</div>
