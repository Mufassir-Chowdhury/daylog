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
		deleteDeadline,
		deleteEvent,
		deleteSlot,
		deleteTask,
		newScheduleId,
		saveDeadline,
		saveEvent,
		saveSlot,
		saveTask,
		saveWeekNote,
		type Deadline,
		type PlanTask,
		type ScheduleEvent,
		type ScheduleSlot
	} from '$lib/db';
	import {
		moveEvent,
		moveTask,
		occurrences,
		rangeLabel,
		shortDay,
		undatedEvents,
		upsert,
		weekStart,
		type Occurrence,
		type RowAction,
		type TaskAction
	} from '$lib/schedule';
	import { saveFailed, toast } from '$lib/toast.svelte';

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
		| { type: 'event'; mode: 'edit' | 'move'; event: ScheduleEvent; isNew: boolean }
		| { type: 'task'; mode: 'edit' | 'move'; task: PlanTask }
		| { type: 'deadline'; deadline: Deadline; isNew: boolean }
		| { type: 'slot'; slot: ScheduleSlot; isNew: boolean };
	let editing: Editing | null = $state(null);

	// ——— Events and timetable occurrences.
	function putEvent(event: ScheduleEvent) {
		events = upsert(events, event);
		saveEvent(uid, event).catch(saveFailed);
	}

	function dropEvent(event: ScheduleEvent) {
		events = events.filter((e) => e.id !== event.id);
		deleteEvent(uid, event.id).catch(saveFailed);
	}

	function onEventAction(action: RowAction, { event, virtual }: Occurrence) {
		const toggle = (status: ScheduleEvent['status']) =>
			putEvent({ ...event, status: event.status === status ? 'planned' : status });
		if (action === 'done') toggle('done');
		else if (action === 'cancel') toggle('cancelled');
		else if (action === 'move' || action === 'edit')
			editing = { type: 'event', mode: action, event, isNew: false };
		else if (action === 'remove' && !virtual) {
			dropEvent(event);
			toast(
				event.slotId ? `Reset “${event.title}” to the timetable.` : `Deleted “${event.title}”.`,
				{
					undo: () => putEvent(event)
				}
			);
		}
	}

	function addEvent(week: string) {
		const date = week === thisWeek ? today : week;
		editing = {
			type: 'event',
			mode: 'edit',
			isNew: true,
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
		};
	}

	function saveEditedEvent(original: ScheduleEvent, mode: 'edit' | 'move', updated: ScheduleEvent) {
		if (mode === 'move' && original.date === null) {
			// A TBD event just gets its date — there is no old slot to cross out.
			putEvent({
				...original,
				date: updated.date,
				start: updated.start,
				end: updated.end,
				room: updated.room
			});
		} else if (mode === 'move') {
			const [moved, created] = moveEvent(
				original,
				{ date: updated.date!, start: updated.start, end: updated.end, room: updated.room },
				newScheduleId(uid, 'events')
			);
			putEvent(moved);
			putEvent(created);
		} else putEvent(updated);
		editing = null;
	}

	/** Cancels every planned class and lab in a week — "no classes this week". */
	function weekOff(week: string, list: Occurrence[]) {
		const hit = list.filter(
			(o) => (o.event.kind === 'class' || o.event.kind === 'lab') && o.event.status === 'planned'
		);
		if (hit.length === 0) {
			toast('No planned classes or labs left that week.');
			return;
		}
		for (const o of hit) putEvent({ ...o.event, status: 'cancelled' });
		toast(
			`Cancelled ${hit.length} class${hit.length === 1 ? '' : 'es'} — ${rangeLabel(week, addDays(week, 6))}.`,
			{
				undo: () => {
					for (const o of hit) (o.virtual ? dropEvent : putEvent)(o.event);
				}
			}
		);
	}

	function setWeekNote(week: string, text: string) {
		const note = { week, text: text.trim() };
		weekNotes = [...weekNotes.filter((n) => n.week !== week), ...(note.text ? [note] : [])];
		saveWeekNote(uid, note).catch(saveFailed);
	}

	// ——— Tasks.
	function putTask(task: PlanTask) {
		tasks = upsert(tasks, task);
		saveTask(uid, task).catch(saveFailed);
	}

	function onTaskAction(action: TaskAction, task: PlanTask) {
		if (action === 'done') putTask({ ...task, status: task.status === 'done' ? 'open' : 'done' });
		else if (action === 'drop') {
			putTask({ ...task, status: 'dropped' });
			toast(`Marked “${task.text}” not needed.`, { undo: () => putTask(task) });
		} else if (action === 'move' || action === 'edit')
			editing = { type: 'task', mode: action, task };
		else if (action === 'remove') {
			tasks = tasks.filter((t) => t.id !== task.id);
			deleteTask(uid, task.id).catch(saveFailed);
			toast(`Deleted “${task.text}”.`, { undo: () => putTask(task) });
		}
	}

	function addTask(fields: Pick<PlanTask, 'text' | 'date' | 'until' | 'start' | 'end'>) {
		putTask({
			...fields,
			id: newScheduleId(uid, 'tasks'),
			status: 'open',
			note: '',
			highlight: false,
			createdAt: Date.now()
		});
	}

	function saveEditedTask(original: PlanTask, mode: 'edit' | 'move', updated: PlanTask) {
		if (mode === 'move' && original.date === null) {
			// A "Later" task just gets its day — there is nothing to cross out.
			putTask({ ...original, date: updated.date, until: updated.until });
		} else if (mode === 'move') {
			const [moved, created] = moveTask(
				original,
				{ date: updated.date, until: updated.until },
				newScheduleId(uid, 'tasks'),
				Date.now()
			);
			putTask(moved);
			putTask(created);
		} else putTask(updated);
		editing = null;
	}

	// ——— Deadlines.
	function putDeadline(deadline: Deadline) {
		deadlines = upsert(deadlines, deadline);
		saveDeadline(uid, deadline).catch(saveFailed);
	}

	function onDeadlineAction(action: 'done' | 'edit' | 'remove', deadline: Deadline) {
		if (action === 'done') putDeadline({ ...deadline, done: !deadline.done });
		else if (action === 'edit') editing = { type: 'deadline', deadline, isNew: false };
		else {
			deadlines = deadlines.filter((d) => d.id !== deadline.id);
			deleteDeadline(uid, deadline.id).catch(saveFailed);
			toast(`Deleted “${deadline.text}”.`, { undo: () => putDeadline(deadline) });
		}
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
		slots = upsert(slots, slot);
		saveSlot(uid, slot).catch(saveFailed);
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

	function removeSlot(slot: ScheduleSlot) {
		slots = slots.filter((s) => s.id !== slot.id);
		deleteSlot(uid, slot.id).catch(saveFailed);
		toast(`Removed “${slot.title}” from the weekly timetable.`, {
			undo: () => {
				slots = upsert(slots, slot);
				saveSlot(uid, slot).catch(saveFailed);
			}
		});
	}

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
						? `Move “${current.event.title}”`
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
				event={current.event}
				mode={current.mode}
				onsave={(updated) => saveEditedEvent(current.event, current.mode, updated)}
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
					putDeadline(d);
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
