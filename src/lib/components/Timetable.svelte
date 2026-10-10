<script lang="ts">
	import type { ScheduleSlot } from '$lib/db';
	import { EVENT_KINDS, WEEKDAYS, formatTimeRange, minutes } from '$lib/schedule';

	let {
		slots,
		onadd,
		onedit,
		onremove
	}: {
		slots: ScheduleSlot[];
		onadd: (weekday: number) => void;
		onedit: (slot: ScheduleSlot) => void;
		onremove: (slot: ScheduleSlot) => void;
	} = $props();

	// Sunday–Thursday always; Friday/Saturday only when something runs then.
	const days = $derived(
		WEEKDAYS.map((name, i) => ({
			name,
			i,
			slots: slots
				.filter((s) => s.weekday === i)
				.sort((a, b) => minutes(a.start) - minutes(b.start))
		})).filter((d) => d.i <= 4 || d.slots.length > 0)
	);

	const kindLabel = (id: string) => EVENT_KINDS.find((k) => k.id === id)?.label ?? id;
	const btn = 'rounded px-1 text-xs text-faint hover:bg-tint hover:text-ink';
</script>

<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
	{#each days as day (day.i)}
		<div class="rounded-card border border-line bg-canvas/40 p-3">
			<h3 class="mb-2 text-xs font-semibold tracking-wide text-mute uppercase">{day.name}</h3>
			<ul class="space-y-2">
				{#each day.slots as slot (slot.id)}
					<li class="group rounded-ctl border border-line bg-card p-2">
						<p class="flex items-start gap-1">
							<span class="min-w-0 flex-1 text-sm leading-snug font-medium text-ink"
								>{slot.title}</span
							>
							<span
								class="reveal flex shrink-0 group-focus-within:opacity-100 group-hover:opacity-100"
							>
								<button
									type="button"
									onclick={() => onedit(slot)}
									class={btn}
									aria-label="Edit {slot.title} on {day.name}">✎</button
								>
								<button
									type="button"
									onclick={() => onremove(slot)}
									class="rounded px-1 text-xs text-faint hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
									aria-label="Delete {slot.title} on {day.name}">×</button
								>
							</span>
						</p>
						<p class="mt-0.5 text-xs text-mute tabular-nums">
							{formatTimeRange(slot.start, slot.end)}{slot.room ? ` · ${slot.room}` : ''}
							{#if slot.kind !== 'class'}· {kindLabel(slot.kind)}{/if}
						</p>
						{#if slot.startsOn || slot.endsOn}
							<p class="text-[11px] text-faint">
								{slot.startsOn ? `from ${slot.startsOn}` : ''}{slot.startsOn && slot.endsOn
									? ' '
									: ''}{slot.endsOn ? `until ${slot.endsOn}` : ''}
							</p>
						{/if}
					</li>
				{/each}
			</ul>
			<button
				type="button"
				onclick={() => onadd(day.i)}
				class="mt-2 w-full rounded-ctl border border-dashed border-line py-1 text-xs text-faint hover:border-accent/50 hover:text-accent"
			>
				+ add
			</button>
		</div>
	{/each}
</div>
