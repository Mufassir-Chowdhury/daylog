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

<h1 class="text-xl font-bold text-gray-900">Routines</h1>
<p class="mt-1 text-sm text-gray-400">
	Monthly totals for your daily routines — log values from the Routines panel on any day page.
	Averages divide by the days of the month so far, not just the days you logged.
</p>

{#if routines.length === 0}
	<p class="mt-4 text-sm text-gray-400">
		No routines added yet — add one from the Routines panel on a day page, or from Settings.
	</p>
{/if}

<div class="mt-4 space-y-4">
	{#each months as { month, stats } (month)}
		{@const current = month === thisMonth}
		{@const rows = routines.filter((r) => current || stats.has(r.id))}
		{@const days = elapsedDays(month, today)}
		{#if rows.length > 0}
			<section class="rounded-xl border border-gray-200 bg-white p-4">
				<p class="mb-2 flex items-baseline border-b border-gray-100 pb-2">
					<span class="text-sm font-semibold text-gray-900">{monthLabel(month)}</span>
					{#if current}
						<span class="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
							so far
						</span>
					{/if}
					<span class="ml-auto text-xs text-gray-400">over {days} days</span>
				</p>
				<div class="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-4 gap-y-1">
					<span class="text-xs font-semibold tracking-wide text-gray-400 uppercase">Routine</span>
					<span class="text-right text-xs font-semibold tracking-wide text-gray-400 uppercase"
						>Total</span
					>
					<span class="text-right text-xs font-semibold tracking-wide text-gray-400 uppercase"
						>Days</span
					>
					<span class="text-right text-xs font-semibold tracking-wide text-gray-400 uppercase"
						>Avg/day</span
					>
					{#each rows as routine (routine.id)}
						{@const s = stats.get(routine.id) ?? { total: 0, count: 0, average: 0 }}
						{@const met = routine.threshold > 0 && s.average >= routine.threshold}
						<span class="truncate text-sm font-medium text-gray-800">
							{routine.name}
							{#if routine.threshold > 0}
								<span class="font-normal text-gray-400">
									· target {routine.threshold}{routine.unit ? ` ${routine.unit}` : ''}/day
								</span>
							{/if}
						</span>
						<span class="text-right text-sm text-gray-900 tabular-nums">
							{NUM.format(s.total)}{routine.unit ? ` ${routine.unit}` : ''}
						</span>
						<span class="text-right text-sm text-gray-500 tabular-nums">{s.count}</span>
						<span
							class="text-right text-sm font-medium tabular-nums {met
								? 'text-green-600'
								: 'text-gray-700'}"
						>
							{NUM.format(s.average)}
						</span>
					{/each}
				</div>
			</section>
		{/if}
	{/each}
</div>
