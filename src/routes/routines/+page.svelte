<script lang="ts">
	import { dateKey, fromKey } from '$lib/date';
	import { monthLabel, monthOf } from '$lib/finance';
	import { resolve } from '$app/paths';
	import {
		dayMet,
		elapsedDays,
		monthlyRoutineStats,
		recentValues,
		routineStreaks
	} from '$lib/routines';

	let { data } = $props();

	const routines = $derived(data.routines);
	const today = dateKey();
	const thisMonth = monthOf(today);

	const months = $derived(monthlyRoutineStats(data.logs, today));

	// One decimal is enough for a daily average; totals stay whole-ish.
	const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
	const CELL_DAY = new Intl.DateTimeFormat('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric'
	});

	const recent = $derived(
		routines.map((r) => {
			const days = recentValues(data.logs, r.id, today, 30);
			// Shade relative to the target when there is one, else to the 30-day high.
			const scaleMax =
				r.threshold > 0 ? r.threshold : Math.max(0, ...days.map((d) => d.value ?? 0));
			return {
				routine: r,
				days,
				scaleMax,
				streak: routineStreaks(data.logs, r.id, r.threshold, today),
				metCount: days.filter((d) => dayMet(d.value ?? undefined, r.threshold)).length
			};
		})
	);

	/** Sequential single-hue shade: 15% → 100% of the accent as the value approaches the scale max. */
	function shade(value: number | null, max: number): string {
		if (value === null || value <= 0 || max <= 0) return 'var(--t-tint)';
		const pct = Math.round(15 + Math.min(1, value / max) * 85);
		return `color-mix(in oklab, var(--t-accent) ${pct}%, var(--t-tint))`;
	}
</script>

<svelte:head>
	<title>Routines · daylog</title>
</svelte:head>

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

{#if routines.length > 0}
	<section class="mt-5 rounded-card border border-line bg-card p-4 shadow-card">
		<div class="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
			<h2 class="text-xs font-semibold tracking-wide text-mute uppercase">Last 30 days</h2>
			<span class="ml-auto flex items-center gap-1.5 text-[11px] text-faint">
				less
				{#each [0, 0.35, 0.7, 1] as f (f)}
					<span class="h-2.5 w-2.5 rounded-[3px]" style:background={shade(f, 1)}></span>
				{/each}
				more · <span class="font-semibold text-ink">✓</span> target met
			</span>
		</div>
		<div class="space-y-4">
			{#each recent as { routine, days, scaleMax, streak, metCount } (routine.id)}
				<div>
					<p class="mb-1.5 flex flex-wrap items-baseline gap-x-3 text-sm">
						<span class="font-medium text-ink">{routine.name}</span>
						<span class="text-xs text-faint">
							{metCount}/30 days {routine.threshold > 0 ? 'on target' : 'logged'}
						</span>
						<span class="ml-auto flex gap-3 text-xs text-mute">
							<span title="Consecutive days, ending today or yesterday">
								current streak <span class="font-semibold text-ink">{streak.current}</span>
							</span>
							<span>best <span class="font-semibold text-ink">{streak.best}</span></span>
						</span>
					</p>
					<div class="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-[3px]">
						{#each days as d (d.date)}
							{@const met = dayMet(d.value ?? undefined, routine.threshold)}
							{@const label = `${CELL_DAY.format(fromKey(d.date))}: ${d.value === null ? 'nothing logged' : `${NUM.format(d.value)}${routine.unit ? ` ${routine.unit}` : ''}`}${met && routine.threshold > 0 ? ' ✓' : ''}`}
							<a
								href={resolve('/day/[date]', { date: d.date })}
								title={label}
								aria-label={label}
								class="grid aspect-square place-items-center rounded-[3px] text-[9px] leading-none font-bold text-on-accent hover:ring-2 hover:ring-accent/50 {d.date ===
								today
									? 'ring-1 ring-ink/40'
									: ''}"
								style:background={shade(d.value, scaleMax)}
							>
								{#if met && routine.threshold > 0}✓{/if}
							</a>
						{/each}
					</div>
				</div>
			{/each}
		</div>
		<p class="mt-3 text-[11px] text-faint">Click a day to open it and log values.</p>
	</section>
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
