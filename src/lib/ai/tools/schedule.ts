import { addDays } from '../../date';
import {
	listDeadlines,
	listEvents,
	listSlots,
	listTasks,
	listWeekNotes,
	newScheduleId
} from '../../db';
import * as ops from '../../ops/schedule';
import {
	daysUntil,
	EVENT_KINDS,
	formatTimeRange,
	materialize,
	occurrences,
	overrideId,
	shortDay,
	slotRunsOn,
	sortDeadlines,
	tasksInRange,
	undatedEvents,
	weekStart,
	WEEKDAYS
} from '../../schedule';
import type { Deadline, PlanTask, ScheduleEvent } from '../../db';
import type { Occurrence } from '../../schedule';
import {
	compact,
	dayKey,
	enumOf,
	optBool,
	optEnum,
	optStr,
	params,
	str,
	weekday,
	type Tool,
	type ToolContext
} from './registry';

const eventOut = (e: ScheduleEvent, virtual = false) =>
	compact({
		id: e.id,
		date: e.date,
		day: e.date ? weekday(e.date) : 'TBD',
		start: e.start,
		end: e.end,
		title: e.title,
		kind: e.kind,
		room: e.room,
		status: e.status === 'planned' ? '' : e.status,
		note: e.note,
		timetable: virtual || e.slotId !== null
	});

const taskOut = (t: PlanTask) =>
	compact({
		id: t.id,
		text: t.text,
		date: t.date ?? 'later',
		until: t.until,
		start: t.start,
		end: t.end,
		status: t.status === 'open' ? '' : t.status,
		note: t.note,
		highlight: t.highlight
	});

export const scheduleSnapshot: Tool = {
	area: 'schedule',
	kind: 'read',
	def: {
		name: 'schedule_snapshot',
		description:
			'The schedule between two days: classes, labs, exams, meetings (with ids, status and notes), ' +
			'the task plan (dated, overdue and "later" tasks), open deadlines with days left, week notes, ' +
			'and the weekly timetable. Weeks run Sunday to Thursday. Defaults to this week and next.',
		parameters: params({
			from: optStr('First day, YYYY-MM-DD, or null for the start of this week.'),
			to: optStr('Last day, YYYY-MM-DD, or null for two weeks from `from`.')
		})
	},
	describe: () => 'Checking your schedule',
	async run(ctx, input) {
		const from = input.from ? dayKey(input.from, 'from') : weekStart(ctx.today);
		const to = input.to ? dayKey(input.to, 'to') : addDays(from, 13);
		if (to < from) throw new Error('to is before from.');
		if (to > addDays(from, 62)) throw new Error('Ask for at most two months at a time.');
		const [slots, events, tasks, deadlines, weekNotes] = await Promise.all([
			listSlots(ctx.uid),
			listEvents(ctx.uid),
			listTasks(ctx.uid),
			listDeadlines(ctx.uid),
			listWeekNotes(ctx.uid)
		]);
		const overdue = tasks.filter(
			(t) => t.status === 'open' && t.date !== null && (t.until ?? t.date) < from
		);
		return {
			from,
			to,
			events: occurrences(slots, events, from, to).map((o) => eventOut(o.event, o.virtual)),
			undatedEvents: undatedEvents(events).map((e) => eventOut(e)),
			tasks: tasksInRange(tasks, from, to).map(taskOut),
			overdueTasks: overdue.map(taskOut),
			laterTasks: tasks.filter((t) => t.date === null && t.status === 'open').map(taskOut),
			deadlines: sortDeadlines(deadlines)
				.filter((d) => !d.done || (d.due !== null && d.due >= from))
				.map((d) =>
					compact({
						id: d.id,
						text: d.text,
						due: d.due ?? 'TBD',
						when: d.label,
						daysLeft: d.due ? daysUntil(d.due, ctx.today) : null,
						hard: d.hard,
						done: d.done,
						note: d.note
					})
				),
			weekNotes: weekNotes.filter((n) => n.week >= weekStart(from) && n.week <= to),
			timetable: slots.map((s) =>
				compact({
					id: s.id,
					title: s.title,
					kind: s.kind,
					weekday: WEEKDAYS[s.weekday],
					start: s.start,
					end: s.end,
					room: s.room
				})
			)
		};
	}
};

// ——— Changes. Ids come from schedule_snapshot; everything is looked up fresh.

const KINDS = EVENT_KINDS.map((k) => k.id);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `HH:MM`, '' to clear, or null to keep `keep`. */
function time(value: unknown, keep: string, name: string): string {
	if (value === null || value === undefined) return keep;
	const t = String(value).trim();
	if (t && !TIME.test(t)) throw new Error(`${name} should be HH:MM (24-hour) or empty.`);
	return t;
}

/** A class occurrence or event by id — untouched timetable rows included. */
async function findEvent(ctx: ToolContext, id: unknown): Promise<Occurrence> {
	const key = String(id);
	const [slots, events] = await Promise.all([listSlots(ctx.uid), listEvents(ctx.uid)]);
	const stored = events.find((e) => e.id === key);
	if (stored) return { event: stored, virtual: false };
	const m = /^(.+)_(\d{4}-\d{2}-\d{2})$/.exec(key);
	const slot = m && slots.find((s) => s.id === m[1]);
	if (slot && slotRunsOn(slot, m[2]) && overrideId(slot.id, m[2]) === key)
		return { event: materialize(slot, m[2]), virtual: true };
	throw new Error(`No class or event with id ${key}. Use schedule_snapshot for ids.`);
}

async function findTask(ctx: ToolContext, id: unknown): Promise<PlanTask> {
	const task = (await listTasks(ctx.uid)).find((t) => t.id === id);
	if (!task) throw new Error(`No task with id ${id}. Use schedule_snapshot for ids.`);
	return task;
}

async function findDeadline(ctx: ToolContext, id: unknown): Promise<Deadline> {
	const deadline = (await listDeadlines(ctx.uid)).find((d) => d.id === id);
	if (!deadline) throw new Error(`No deadline with id ${id}. Use schedule_snapshot for ids.`);
	return deadline;
}

/** “SWE” (Mon, Oct 26 9:00–10:30 AM) */
const eventLabel = (e: ScheduleEvent) =>
	`“${e.title}” (${e.date ? shortDay(e.date) : 'date TBD'}${e.start ? ` ${formatTimeRange(e.start, e.end)}` : ''})`;
const whenLabel = (date: string | null) => (date ? shortDay(date) : 'Later');

const text = (v: unknown) => (v === null || v === undefined ? null : String(v).trim());

export const setEventStatus: Tool = {
	area: 'schedule',
	kind: 'write',
	label: 'Mark classes and events done or cancelled',
	def: {
		name: 'set_event_status',
		description:
			'Mark a class occurrence or event done, cancelled, or back to planned. For a class that moves, use move_event.',
		parameters: params({
			id: str('Event id from schedule_snapshot.'),
			status: enumOf(['planned', 'done', 'cancelled'], 'New status.'),
			note: optStr('Short reason shown next to it, or null to keep the note.')
		})
	},
	describe: () => 'Updating your schedule',
	async plan(ctx, input) {
		const occ = await findEvent(ctx, input.id);
		const status = input.status as 'planned' | 'done' | 'cancelled';
		if (occ.event.status === status && input.note === null)
			return { changes: [], summary: `${eventLabel(occ.event)} ${status}` };
		return {
			changes: ops.setEventStatus(occ, status, text(input.note)),
			summary: `Mark ${eventLabel(occ.event)} ${status}${input.note ? ` — ${input.note}` : ''}`
		};
	}
};

export const moveEvent: Tool = {
	area: 'schedule',
	kind: 'write',
	label: 'Move classes and events',
	def: {
		name: 'move_event',
		description:
			'Move a class occurrence or event to another day, time or room. The original stays, crossed out with a note. ' +
			'A TBD event just gets its date.',
		parameters: params({
			id: str('Event id from schedule_snapshot.'),
			date: str('New day, YYYY-MM-DD.'),
			start: optStr('New start HH:MM, or null to keep.'),
			end: optStr('New end HH:MM, or null to keep.'),
			room: optStr('New room, or null to keep.')
		})
	},
	describe: () => 'Moving something on your schedule',
	async plan(ctx, input) {
		const occ = await findEvent(ctx, input.id);
		const target = {
			date: dayKey(input.date),
			start: time(input.start, occ.event.start, 'start'),
			end: time(input.end, occ.event.end, 'end'),
			room: text(input.room) ?? occ.event.room
		};
		const when = `${shortDay(target.date)}${target.start ? ` ${formatTimeRange(target.start, target.end)}` : ''}`;
		return {
			changes: ops.moveEventTo(occ, target, newScheduleId(ctx.uid, 'events')),
			summary: `Move ${eventLabel(occ.event)} to ${when}${target.room ? `, room ${target.room}` : ''}`
		};
	}
};

export const updateEvent: Tool = {
	area: 'schedule',
	kind: 'write',
	label: 'Edit classes and events',
	def: {
		name: 'update_event',
		description:
			'Change details of one class occurrence or event in place (not its day — use move_event). Null keeps a field.',
		parameters: params({
			id: str('Event id from schedule_snapshot.'),
			title: optStr('New title.'),
			kind: optEnum(KINDS, 'New kind.'),
			start: optStr('New start HH:MM ("" clears).'),
			end: optStr('New end HH:MM ("" clears).'),
			room: optStr('New room ("" clears).'),
			note: optStr('New note ("" clears).')
		})
	},
	describe: () => 'Updating your schedule',
	async plan(ctx, input) {
		const occ = await findEvent(ctx, input.id);
		const e = occ.event;
		const fields = {
			title: text(input.title) || e.title,
			kind: (input.kind as ScheduleEvent['kind']) ?? e.kind,
			start: time(input.start, e.start, 'start'),
			end: time(input.end, e.end, 'end'),
			room: text(input.room) ?? e.room,
			note: text(input.note) ?? e.note
		};
		const changed = Object.entries(fields)
			.filter(([k, v]) => e[k as keyof typeof fields] !== v)
			.map(([k]) => k);
		if (!changed.length) return { changes: [], summary: `${eventLabel(e)} as asked` };
		return {
			changes: ops.updateEvent(occ, fields),
			summary: `Change the ${changed.join(', ')} of ${eventLabel(e)}`
		};
	}
};

export const addEvent: Tool = {
	area: 'schedule',
	kind: 'write',
	label: 'Add events',
	def: {
		name: 'add_event',
		description:
			'Add a one-off event (exam, invigilation, meeting, extra class). Null date = date TBD.',
		parameters: params({
			title: str('Title.'),
			kind: enumOf(KINDS, 'Kind.'),
			date: optStr('Day, YYYY-MM-DD, or null if not fixed yet.'),
			start: optStr('Start HH:MM, or null.'),
			end: optStr('End HH:MM, or null.'),
			room: optStr('Room, or null.'),
			note: optStr('Note, or null.')
		})
	},
	describe: () => 'Adding to your schedule',
	async plan(ctx, input) {
		const event: ScheduleEvent = {
			id: newScheduleId(ctx.uid, 'events'),
			slotId: null,
			date: input.date ? dayKey(input.date) : null,
			start: time(input.start, '', 'start'),
			end: time(input.end, '', 'end'),
			title: String(input.title).trim(),
			kind: input.kind as ScheduleEvent['kind'],
			room: text(input.room) ?? '',
			status: 'planned',
			note: text(input.note) ?? ''
		};
		if (!event.title) throw new Error('title is empty.');
		return { changes: ops.addEvent(event), summary: `Add ${eventLabel(event)}` };
	}
};

export const cancelWeekClasses: Tool = {
	area: 'schedule',
	kind: 'write',
	label: 'Cancel a week of classes',
	def: {
		name: 'cancel_week_classes',
		description: 'Cancel every planned class and lab in one week — "no classes next week".',
		parameters: params({ week: str('Any day in that week, YYYY-MM-DD.') })
	},
	describe: () => 'Cancelling a week of classes',
	async plan(ctx, input) {
		const start = weekStart(dayKey(input.week, 'week'));
		const [slots, events] = await Promise.all([listSlots(ctx.uid), listEvents(ctx.uid)]);
		const changes = ops.cancelWeekClasses(occurrences(slots, events, start, addDays(start, 6)));
		return {
			changes,
			summary: changes.length
				? `Cancel ${changes.length} class${changes.length === 1 ? '' : 'es'} in the week of ${shortDay(start)}`
				: `no planned classes in the week of ${shortDay(start)}`
		};
	}
};

export const addTask: Tool = {
	area: 'schedule',
	kind: 'write',
	small: true,
	label: 'Add tasks to the plan',
	def: {
		name: 'add_task',
		description:
			'Add a task to the task plan: on a day, across days (until), or Later (date null). Optional time block.',
		parameters: params({
			text: str('The task.'),
			date: optStr('Day, YYYY-MM-DD, or null for Later.'),
			until: optStr('Last day of a span, or null.'),
			start: optStr('Suggested start HH:MM, or null.'),
			end: optStr('Suggested end HH:MM, or null.'),
			highlight: optBool('Protected time block (e.g. thesis), default false.')
		})
	},
	describe: () => 'Adding a task',
	async plan(ctx, input) {
		const taskText = String(input.text).trim();
		if (!taskText) throw new Error('text is empty.');
		const date = input.date ? dayKey(input.date) : null;
		const until = input.until && date ? dayKey(input.until, 'until') : null;
		return {
			changes: ops.addTask(
				{
					text: taskText,
					date,
					until,
					start: time(input.start, '', 'start'),
					end: time(input.end, '', 'end'),
					highlight: input.highlight === true
				},
				newScheduleId(ctx.uid, 'tasks'),
				Date.now()
			),
			summary: `Add “${taskText}” to ${whenLabel(date)}`
		};
	}
};

export const setTaskStatus: Tool = {
	area: 'schedule',
	kind: 'write',
	label: 'Mark tasks done or dropped',
	def: {
		name: 'set_task_status',
		description: 'Mark a task done, dropped (not needed) or open again.',
		parameters: params({
			id: str('Task id from schedule_snapshot.'),
			status: enumOf(['open', 'done', 'dropped'], 'New status.'),
			note: optStr('Progress or reason ("Not needed — exam postponed"), or null to keep.')
		})
	},
	describe: () => 'Updating a task',
	async plan(ctx, input) {
		const task = await findTask(ctx, input.id);
		const status = input.status as PlanTask['status'];
		if (task.status === status && input.note === null)
			return { changes: [], summary: `“${task.text}” ${status}` };
		return {
			changes: ops.setTaskStatus(task, status, text(input.note)),
			summary: `Mark “${task.text}” ${status === 'dropped' ? 'not needed' : status}`
		};
	}
};

export const moveTask: Tool = {
	area: 'schedule',
	kind: 'write',
	label: 'Move tasks',
	def: {
		name: 'move_task',
		description: 'Move a task to another day or span, or to Later (date null).',
		parameters: params({
			id: str('Task id from schedule_snapshot.'),
			date: optStr('New day, YYYY-MM-DD, or null for Later.'),
			until: optStr('Last day of a span, or null.')
		})
	},
	describe: () => 'Moving a task',
	async plan(ctx, input) {
		const task = await findTask(ctx, input.id);
		const date = input.date ? dayKey(input.date) : null;
		const until = input.until && date ? dayKey(input.until, 'until') : null;
		if (task.date === date && task.until === until)
			return { changes: [], summary: `“${task.text}” on ${whenLabel(date)}` };
		return {
			changes: ops.moveTaskTo(task, { date, until }, newScheduleId(ctx.uid, 'tasks'), Date.now()),
			summary: `Move “${task.text}” to ${whenLabel(date)}`
		};
	}
};

export const updateTask: Tool = {
	area: 'schedule',
	kind: 'write',
	label: 'Edit tasks',
	def: {
		name: 'update_task',
		description: 'Change a task’s text, time block, note or highlight. Null keeps a field.',
		parameters: params({
			id: str('Task id from schedule_snapshot.'),
			text: optStr('New text.'),
			start: optStr('New start HH:MM ("" clears).'),
			end: optStr('New end HH:MM ("" clears).'),
			note: optStr('New note ("" clears).'),
			highlight: optBool('Protected time block.')
		})
	},
	describe: () => 'Updating a task',
	async plan(ctx, input) {
		const task = await findTask(ctx, input.id);
		const fields = {
			text: text(input.text) || task.text,
			start: time(input.start, task.start, 'start'),
			end: time(input.end, task.end, 'end'),
			note: text(input.note) ?? task.note,
			highlight: typeof input.highlight === 'boolean' ? input.highlight : task.highlight
		};
		const changed = Object.entries(fields)
			.filter(([k, v]) => task[k as keyof typeof fields] !== v)
			.map(([k]) => k);
		if (!changed.length) return { changes: [], summary: `“${task.text}” as asked` };
		return {
			changes: ops.updateTask(task, fields),
			summary: `Change the ${changed.join(', ')} of “${task.text}”`
		};
	}
};

export const addDeadline: Tool = {
	area: 'schedule',
	kind: 'write',
	label: 'Add deadlines',
	def: {
		name: 'add_deadline',
		description: 'Add a deadline to the deadlines list.',
		parameters: params({
			text: str('What is due.'),
			due: optStr('Earliest due day, YYYY-MM-DD, or null if not fixed.'),
			label: optStr(
				'Free-text when, overriding the date display ("Oct 24 / 25", "November"), or null.'
			),
			hard: optBool('A hard deadline (shown in red).'),
			note: optStr('Note, or null.')
		})
	},
	describe: () => 'Adding a deadline',
	async plan(ctx, input) {
		const deadline: Deadline = {
			id: newScheduleId(ctx.uid, 'deadlines'),
			text: String(input.text).trim(),
			due: input.due ? dayKey(input.due, 'due') : null,
			label: text(input.label) ?? '',
			hard: input.hard === true,
			done: false,
			note: text(input.note) ?? ''
		};
		if (!deadline.text) throw new Error('text is empty.');
		return {
			changes: ops.addDeadline(deadline),
			summary: `Add the deadline “${deadline.text}”${deadline.due ? `, due ${shortDay(deadline.due)}` : ''}`
		};
	}
};

export const updateDeadline: Tool = {
	area: 'schedule',
	kind: 'write',
	label: 'Edit deadlines',
	def: {
		name: 'update_deadline',
		description:
			'Mark a deadline done (or not), or change its date, label, text, hard flag or note. Null keeps.',
		parameters: params({
			id: str('Deadline id from schedule_snapshot.'),
			done: optBool('Done.'),
			text: optStr('New text.'),
			due: optStr('New due day, YYYY-MM-DD ("" = not fixed).'),
			label: optStr('New free-text when ("" clears).'),
			hard: optBool('Hard deadline.'),
			note: optStr('New note ("" clears).')
		})
	},
	describe: () => 'Updating a deadline',
	async plan(ctx, input) {
		const d = await findDeadline(ctx, input.id);
		const due =
			input.due === null ? d.due : String(input.due).trim() ? dayKey(input.due, 'due') : null;
		const fields = {
			done: typeof input.done === 'boolean' ? input.done : d.done,
			text: text(input.text) || d.text,
			due,
			label: text(input.label) ?? d.label,
			hard: typeof input.hard === 'boolean' ? input.hard : d.hard,
			note: text(input.note) ?? d.note
		};
		const changed = Object.entries(fields)
			.filter(([k, v]) => d[k as keyof typeof fields] !== v)
			.map(([k]) => k);
		if (!changed.length) return { changes: [], summary: `“${d.text}” as asked` };
		return {
			changes: ops.updateDeadline(d, fields),
			summary:
				changed.length === 1 && changed[0] === 'done'
					? `Mark the deadline “${d.text}” ${fields.done ? 'done' : 'open'}`
					: `Change the ${changed.join(', ')} of the deadline “${d.text}”`
		};
	}
};

export const setWeekNote: Tool = {
	area: 'schedule',
	kind: 'write',
	label: 'Write week notes',
	def: {
		name: 'set_week_note',
		description: 'Set the remark shown under a week’s schedule ("" clears it).',
		parameters: params({ week: str('Any day in that week, YYYY-MM-DD.'), text: str('The note.') })
	},
	describe: () => 'Updating a week note',
	async plan(ctx, input) {
		const week = weekStart(dayKey(input.week, 'week'));
		return {
			changes: ops.setWeekNote(await listWeekNotes(ctx.uid), week, String(input.text)),
			summary: `Set the note for the week of ${shortDay(week)}`
		};
	}
};

export const SCHEDULE_TOOLS = [
	scheduleSnapshot,
	setEventStatus,
	moveEvent,
	updateEvent,
	addEvent,
	cancelWeekClasses,
	addTask,
	setTaskStatus,
	moveTask,
	updateTask,
	addDeadline,
	updateDeadline,
	setWeekNote
];
