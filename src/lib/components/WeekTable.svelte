<script lang="ts">
	import type { ScheduleEvent } from '$lib/db';
	import {
		EVENT_KINDS,
		formatTimeRange,
		groupBy,
		isDuty,
		shortDay,
		type Occurrence,
		type RowAction
	} from '$lib/schedule';

	let {
		heading,
		today,
		items,
		tbd = [],
		note,
		onaction,
		onnote,
		onadd,
		onweekoff
	}: {
		heading: string;
		today: string;
		items: Occurrence[];
		/** Undated events, shown as "Date TBD" rows at the bottom. */
		tbd?: ScheduleEvent[];
		note: string;
		onaction: (action: RowAction, occurrence: Occurrence) => void;
		onnote: (text: string) => void;
		onadd: () => void;
		onweekoff: () => void;
	} = $props();

	const days = $derived(groupBy(items, (o) => o.event.date!));
	const rows = $derived([
		...days,
		...(tbd.length > 0
			? [
					['', tbd.map((event): Occurrence => ({ event, virtual: false }))] as [
						string,
						Occurrence[]
					]
				]
			: [])
	]);

	const kindLabel = (id: string) => EVENT_KINDS.find((k) => k.id === id)?.label ?? id;
	const crossed = (e: ScheduleEvent) => e.status !== 'planned';
	const btn = 'rounded px-1.5 py-0.5 text-xs text-faint hover:bg-tint hover:text-ink';
</script>

<section
	class="rounded-card border border-line bg-card shadow-card print:border-0 print:shadow-none"
>
	<header class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 print:px-0">
		<h2 class="font-display text-base font-bold text-ink">{heading}</h2>
		<div class="ml-auto flex gap-1 print:hidden">
			<button
				type="button"
				onclick={onweekoff}
				class={btn}
				title="Cancel every planned class and lab this week"
			>
				week off
			</button>
			<button
				type="button"
				onclick={onadd}
				class="rounded-ctl border border-line px-2 py-1 text-xs font-medium text-mute hover:bg-tint hover:text-ink"
			>
				+ Event
			</button>
		</div>
	</header>

	{#if rows.length === 0}
		<p class="px-4 py-4 text-sm text-faint">Nothing scheduled this week.</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="w-full min-w-[34rem] text-sm">
				<thead>
					<tr class="text-left text-xs font-semibold tracking-wide text-faint uppercase">
						<th class="w-28 px-4 py-2 print:px-2">Day</th>
						<th class="w-36 px-2 py-2">Time</th>
						<th class="px-2 py-2">Activity</th>
						<th class="w-24 px-2 py-2">Room</th>
						<th class="w-0 px-2 py-2 print:hidden"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as [date, list] (date)}
						{#each list as occ, i (occ.event.id)}
							{@const e = occ.event}
							{@const duty = isDuty(e.kind) && e.status === 'planned'}
							<tr
								class="group border-t border-line align-top {duty
									? 'bg-amber-400/12'
									: ''} {date === today ? 'bg-accent/5' : ''}"
							>
								{#if i === 0}
									<th
										rowspan={list.length}
										scope="row"
										class="border-r border-line px-4 py-2 text-left font-semibold text-ink print:px-2 {date ===
										today
											? 'text-accent'
											: ''}"
									>
										{date ? shortDay(date) : 'Date TBD'}
									</th>
								{/if}
								<td class="px-2 py-2 whitespace-nowrap text-mute tabular-nums">
									{formatTimeRange(e.start, e.end) || 'TBD'}
								</td>
								<td class="px-2 py-2">
									<span
										class="{crossed(e) ? 'text-faint line-through' : 'text-ink'} {duty
											? 'font-semibold'
											: ''}">{e.title}</span
									>
									{#if e.kind !== 'class'}
										<span
											class="ml-1 rounded-full border border-line px-1.5 text-[10px] font-medium tracking-wide text-faint uppercase"
											>{kindLabel(e.kind)}</span
										>
									{/if}
									{#if e.status === 'done'}
										<span class="ml-1 font-semibold text-green-600 dark:text-green-400">Done</span>
									{:else if e.status === 'cancelled'}
										<span class="ml-1 font-semibold text-red-600 dark:text-red-400">Cancelled</span>
									{:else if e.status === 'moved'}
										<span class="ml-1 font-semibold text-red-600 dark:text-red-400">
											{e.note || 'Moved'}
										</span>
									{/if}
									{#if e.note && e.status !== 'moved'}
										<span class="text-mute italic">— {e.note}</span>
									{/if}
								</td>
								<td class="px-2 py-2 text-mute">{e.room || '—'}</td>
								<td class="px-2 py-1.5 whitespace-nowrap print:hidden">
									<span
										class="reveal flex justify-end gap-0.5 group-focus-within:opacity-100 group-hover:opacity-100"
									>
										<button
											type="button"
											onclick={() => onaction('done', occ)}
											class={btn}
											title={e.status === 'done' ? 'Mark not done' : 'Mark done'}
											aria-label="{e.status === 'done' ? 'Mark not done' : 'Mark done'}: {e.title}"
										>
											✓
										</button>
										{#if e.date !== null}
											<button
												type="button"
												onclick={() => onaction('cancel', occ)}
												class={btn}
												title={e.status === 'cancelled' ? 'Restore' : 'Cancel'}
												aria-label="{e.status === 'cancelled' ? 'Restore' : 'Cancel'}: {e.title}"
											>
												{e.status === 'cancelled' ? '↺' : '⊘'}
											</button>
										{/if}
										<button
											type="button"
											onclick={() => onaction('move', occ)}
											class={btn}
											title="Move to another day or time"
											aria-label="Move: {e.title}">⇢</button
										>
										<button
											type="button"
											onclick={() => onaction('edit', occ)}
											class={btn}
											title="Edit"
											aria-label="Edit: {e.title}">✎</button
										>
										{#if !occ.virtual}
											<button
												type="button"
												onclick={() => onaction('remove', occ)}
												class="rounded px-1.5 py-0.5 text-xs text-faint hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
												title={e.slotId ? 'Reset to the weekly timetable' : 'Delete'}
												aria-label="{e.slotId ? 'Reset' : 'Delete'}: {e.title}"
											>
												{e.slotId ? '⟲' : '×'}
											</button>
										{/if}
									</span>
								</td>
							</tr>
						{/each}
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<div class="border-t border-line px-4 py-2 print:px-0">
		<input
			type="text"
			value={note}
			onchange={(e) => onnote(e.currentTarget.value)}
			placeholder="Note for this week — e.g. CSE theory classes are off"
			aria-label="Note for this week"
			class="w-full border-0 bg-transparent p-0 text-xs text-mute placeholder:text-faint focus:ring-0 print:hidden"
		/>
		{#if note}
			<p class="hidden text-xs text-mute print:block">{note}</p>
		{/if}
	</div>
</section>
