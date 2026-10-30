<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { session } from '$lib/auth.svelte';
	import DeadlineForm from '$lib/components/DeadlineForm.svelte';
	import DeadlineList from '$lib/components/DeadlineList.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import EventForm from '$lib/components/EventForm.svelte';
	import SlotForm from '$lib/components/SlotForm.svelte';
	import TaskForm from '$lib/components/TaskForm.svelte';
	import TaskPlan from '$lib/components/TaskPlan.svelte';
	import Timetable from '$lib/components/Timetable.svelte';
	import WeekTable from '$lib/components/WeekTable.svelte';
	import { addDays, dateKey, isValidKey } from '$lib/date';
	import {
		newScheduleId,
		type Deadline,
		type PlanTask,
		type ScheduleEvent,
		type ScheduleSlot
	} from '$lib/db';
	import { patch, put, type Change } from '$lib/ops/change';
	import { run } from '$lib/ops/commit';
	import * as ops from '$lib/ops/schedule';
	import {
		occurrences,
		rangeLabel,
		shortDay,
		undatedEvents,
		weekStart,
		type Occurrence,
		type RowAction,
		type TaskAction
	} from '$lib/schedule';
	import { toast } from '$lib/toast.svelte';

	let { data } = $props();

	const uid = session.user!.uid;
	const today = dateKey();

	// Overridable deriveds: fresh from the loader, then edited locally.
	let slots = $derived(data.slots);
	let events = $derived(data.events);
	let tasks = $derived(data.tasks);
	let deadlines = $derived(data.deadlines);
	let weekNotes = $derived(data.weekNotes);

	// ——— Which two weeks are shown (?week=any day in the first one).
	const weekA = $derived.by(() => {
		const param = page.url.searchParams.get('week');
		return weekStart(param && isValidKey(param) ? param : today);
	});
	const weekB = $derived(addDays(weekA, 7));
	const thisWeek = weekStart(today);

	function weekHeading(start: string): string {
		const range = rangeLabel(start, addDays(start, 6));
		const offset = Math.round((Date.parse(start) - Date.parse(thisWeek)) / (7 * 86_400_000));
		const name =
			offset === 0
				? 'This week'
				: offset === 1
					? 'Next week'
					: offset === -1
						? 'Last week'
						: 'Week';
		return `${name}: ${range}`;
	}

	function showWeek(start: string) {
		const url = new URL(page.url);
		if (start === thisWeek) url.searchParams.delete('week');
		else url.searchParams.set('week', start);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same route, only the query changes
		goto(`${resolve('/schedule')}${url.search}`, { noScroll: true, keepFocus: true });
	}

	const occA = $derived(occurrences(slots, events, weekA, addDays(weekA, 6)));
	const occB = $derived(occurrences(slots, events, weekB, addDays(weekB, 6)));
	const tbd = $derived(undatedEvents(events));
	const noteFor = (week: string) => weekNotes.find((n) => n.week === week)?.text ?? '';

	// ——— Drawer: one editor at a time.
	type Editing =
		| { type: 'event'; mode: 'edit' | 'move'; occ: Occurrence; isNew: boolean }
		| { type: 'task'; mode: 'edit' | 'move'; task: PlanTask }
		| { type: 'deadline'; deadline: Deadline; isNew: boolean }
		| { type: 'slot'; slot: ScheduleSlot; isNew: boolean };
	let editing: Editing | null = $state(null);

	// ——— Every change goes through the ops layer: local state first, then Firestore.
	function local(changes: Change[]) {
		slots = patch(slots, changes, 'slot');
		events = patch(events, changes, 'event');
		tasks = patch(tasks, changes, 'task');
		deadlines = patch(deadlines, changes, 'deadline');
		weekNotes = patch(weekNotes, changes, 'weekNote');
	}

	/** Applies changes; with a message, shows it in a toast with Undo. */
	const apply = (changes: Change[], message?: string) => run(uid, changes, { local, message });

	// ——— Events and timetable occurrences.
	function onEventAction(action: RowAction, occ: Occurrence) {
		const { event } = occ;
		const toggle = (status: ScheduleEvent['status']) =>
			apply(ops.setEventStatus(occ, event.status === status ? 'planned' : status));
		if (action === 'done') toggle('done');
		else if (action === 'cancel') toggle('cancelled');
		else if (action === 'move' || action === 'edit')
			editing = { type: 'event', mode: action, occ, isNew: false };
		else if (action === 'remove' && !occ.virtual)
			apply(
				ops.removeEvent(occ),
				event.slotId ? `Reset “${event.title}” to the timetable.` : `Deleted “${event.title}”.`
			);
	}

	function addEvent(week: string) {
		const date = week === thisWeek ? today : week;
		editing = {
			type: 'event',
			mode: 'edit',
			isNew: true,
			occ: {
				virtual: false,
				event: {
					id: newScheduleId(uid, 'events'),
					slotId: null,
					date,
					start: '',
					end: '',
					title: '',
					kind: 'meeting',
					room: '',
					status: 'planned',
					note: ''
				}
			}
		};
	}

	function saveEditedEvent(
		{ occ, mode, isNew }: Extract<Editing, { type: 'event' }>,
		updated: ScheduleEvent
	) {
		if (isNew) apply(ops.addEvent(updated));
		else if (mode === 'move')
			apply(
				ops.moveEventTo(
					occ,
					{ date: updated.date!, start: updated.start, end: updated.end, room: updated.room },
					newScheduleId(uid, 'events')
				)
			);
		else apply(ops.updateEvent(occ, updated));
		editing = null;
	}

	/** Cancels every planned class and lab in a week — "no classes this week". */
	function weekOff(week: string, list: Occurrence[]) {
		const changes = ops.cancelWeekClasses(list);
		if (changes.length === 0) {
			toast('No planned classes or labs left that week.');
			return;
		}
		apply(
			changes,
			`Cancelled ${changes.length} class${changes.length === 1 ? '' : 'es'} — ${rangeLabel(week, addDays(week, 6))}.`
		);
	}

	const setWeekNote = (week: string, text: string) => apply(ops.setWeekNote(weekNotes, week, text));

	// ——— Tasks.
	function onTaskAction(action: TaskAction, task: PlanTask) {
		if (action === 'done') apply(ops.setTaskStatus(task, task.status === 'done' ? 'open' : 'done'));
		else if (action === 'drop')
			apply(ops.setTaskStatus(task, 'dropped'), `Marked “${task.text}” not needed.`);
		else if (action === 'move' || action === 'edit') editing = { type: 'task', mode: action, task };
		else if (action === 'remove') apply(ops.removeTask(task), `Deleted “${task.text}”.`);
	}

	function addTask(fields: Pick<PlanTask, 'text' | 'date' | 'until' | 'start' | 'end'>) {
		apply(ops.addTask(fields, newScheduleId(uid, 'tasks'), Date.now()));
	}

	function saveEditedTask(original: PlanTask, mode: 'edit' | 'move', updated: PlanTask) {
		if (mode === 'move')
			apply(
				ops.moveTaskTo(
					original,
					{ date: updated.date, until: updated.until },
					newScheduleId(uid, 'tasks'),
					Date.now()
				)
			);
		else apply(ops.updateTask(original, updated));
		editing = null;
	}

	// ——— Deadlines.
	function onDeadlineAction(action: 'done' | 'edit' | 'remove', deadline: Deadline) {
		if (action === 'done') apply(ops.updateDeadline(deadline, { done: !deadline.done }));
		else if (action === 'edit') editing = { type: 'deadline', deadline, isNew: false };
		else apply(ops.removeDeadline(deadline), `Deleted “${deadline.text}”.`);
	}

	function addDeadline() {
		editing = {
			type: 'deadline',
			isNew: true,
			deadline: {
				id: newScheduleId(uid, 'deadlines'),
				text: '',
				due: null,
				label: '',
				hard: false,
				done: false,
				note: ''
			}
		};
	}

	// ——— Weekly timetable.
	function putSlot(slot: ScheduleSlot) {
		apply([put('slot', slots, slot)]);
		editing = null;
	}

	function addSlot(weekday: number) {
		editing = {
			type: 'slot',
			isNew: true,
			slot: {
				id: newScheduleId(uid, 'slots'),
				title: '',
				kind: 'class',
				weekday,
				start: '09:00',
				end: '',
				room: '',
				startsOn: null,
				endsOn: null
			}
		};
	}

	const removeSlot = (slot: ScheduleSlot) =>
		apply(ops.removeSlot(slot), `Removed “${slot.title}” from the weekly timetable.`);

	const displayName = session.user!.displayName ?? '';
	const navBtn =
		'rounded-ctl border border-line bg-card px-2.5 py-1.5 text-sm text-mute hover:bg-tint hover:text-ink';
</script>

<svelte:head>
	<title>Schedule · daylog</title>
</svelte:head>

<!-- Printed header, like the routine PDF. -->
<div class="mb-4 hidden text-center print:block">
	<h1 class="text-2xl font-bold">Weekly Routine{displayName ? ` — ${displayName}` : ''}</h1>
	<p class="text-sm text-mute">{rangeLabel(weekA, addDays(weekB, 6))}</p>
</div>

<div class="mb-5 flex flex-wrap items-center gap-3 print:hidden">
	<div>
		<h1 class="font-display text-2xl font-bold tracking-tight text-ink">Schedule</h1>
		<p class="mt-0.5 text-sm text-mute">
			Your weekly routine, what's changed this week, tasks and deadlines.
		</p>
	</div>
	<div class="ml-auto flex flex-wrap items-center gap-2">
		<button
			type="button"
			class={navBtn}
			onclick={() => showWeek(addDays(weekA, -7))}
			aria-label="Previous week">←</button
		>
		{#if weekA !== thisWeek}
			<button
				type="button"
				onclick={() => showWeek(thisWeek)}
				class="text-sm font-medium text-accent hover:underline"
			>
				This week
			</button>
		{/if}
		<button type="button" class={navBtn} onclick={() => showWeek(weekB)} aria-label="Next week"
			>→</button
		>
		<button
			type="button"
			onclick={() => window.print()}
			class="rounded-ctl bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
			title="Print, or choose “Save as PDF” in the print dialog"
		>
			Print / PDF
		</button>
	</div>
</div>

<div class="grid items-start gap-5 2xl:grid-cols-2 print:block print:space-y-6">
	<WeekTable
		heading={weekHeading(weekA)}
		{today}
		items={occA}
		note={noteFor(weekA)}
		onaction={onEventAction}
		onnote={(text) => setWeekNote(weekA, text)}
		onadd={() => addEvent(weekA)}
		onweekoff={() => weekOff(weekA, occA)}
	/>
	<WeekTable
		heading={weekHeading(weekB)}
		{today}
		items={occB}
		{tbd}
		note={noteFor(weekB)}
		onaction={onEventAction}
		onnote={(text) => setWeekNote(weekB, text)}
		onadd={() => addEvent(weekB)}
		onweekoff={() => weekOff(weekB, occB)}
	/>
</div>
<p class="mt-2 text-xs text-faint print:text-mute">
	Highlighted rows are exam duties. Hover a row to mark it done, cancel it, move it or edit it.
</p>

<div class="mt-8 hidden text-center print:block print:break-before-page">
	<h1 class="text-2xl font-bold">Task Plan</h1>
	<p class="text-sm text-mute">Prep, question-setting, grading — updated {shortDay(today)}</p>
</div>

<div class="mt-6 grid items-start gap-5 xl:grid-cols-3 print:mt-4 print:block print:space-y-6">
	<div class="min-w-0 xl:col-span-2">
		<TaskPlan
			{tasks}
			from={weekA}
			to={addDays(weekB, 6)}
			{today}
			onaction={onTaskAction}
			onadd={addTask}
		/>
	</div>
	<div class="min-w-0">
		<DeadlineList {deadlines} {today} onaction={onDeadlineAction} onadd={addDeadline} />
	</div>
</div>

<details
	class="mt-8 rounded-card border border-line bg-card p-4 shadow-card print:hidden"
	open={slots.length === 0}
>
	<summary class="cursor-pointer font-display text-base font-bold text-ink">
		Weekly timetable
		<span class="ml-2 text-sm font-normal text-mute">
			— the classes that repeat every week; both week tables are built from it
		</span>
	</summary>
	<div class="mt-4">
		<Timetable
			{slots}
			onadd={addSlot}
			onedit={(slot) => (editing = { type: 'slot', slot, isNew: false })}
			onremove={removeSlot}
		/>
	</div>
</details>

{#if editing}
	{@const current = editing}
	<Drawer onclose={() => (editing = null)}>
		{#snippet title()}
			<h2 class="font-display text-lg font-bold">
				{#if current.type === 'event'}
					{current.mode === 'move'
						? `Move “${current.occ.event.title}”`
						: current.isNew
							? 'New event'
							: 'Edit event'}
				{:else if current.type === 'task'}
					{current.mode === 'move' ? `Move “${current.task.text}”` : 'Edit task'}
				{:else if current.type === 'deadline'}
					{current.isNew ? 'New deadline' : 'Edit deadline'}
				{:else}
					{current.isNew ? 'Add to weekly timetable' : 'Edit timetable slot'}
				{/if}
			</h2>
		{/snippet}
		{#if current.type === 'event'}
			<EventForm
				event={current.occ.event}
				mode={current.mode}
				onsave={(updated) => saveEditedEvent(current, updated)}
				oncancel={() => (editing = null)}
			/>
		{:else if current.type === 'task'}
			<TaskForm
				task={current.task}
				mode={current.mode}
				onsave={(updated) => saveEditedTask(current.task, current.mode, updated)}
				oncancel={() => (editing = null)}
			/>
		{:else if current.type === 'deadline'}
			<DeadlineForm
				deadline={current.deadline}
				onsave={(d) => {
					apply([put('deadline', deadlines, d)]);
					editing = null;
				}}
				oncancel={() => (editing = null)}
			/>
		{:else}
			<SlotForm slot={current.slot} onsave={putSlot} oncancel={() => (editing = null)} />
		{/if}
	</Drawer>
{/if}

<p class="mt-6 text-xs text-faint print:hidden">
	Today's classes, tasks and close deadlines also show on your
	<a href={resolve('/day/[date]', { date: today })} class="text-accent hover:underline">day page</a
	>.
</p>
