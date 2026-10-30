import { addDays } from '../../date';
import { listDeadlines, listEvents, listSlots, listTasks, listWeekNotes } from '../../db';
import {
	daysUntil,
	occurrences,
	sortDeadlines,
	tasksInRange,
	undatedEvents,
	weekStart,
	WEEKDAYS
} from '../../schedule';
import type { PlanTask, ScheduleEvent } from '../../db';
import { compact, dayKey, optStr, params, weekday, type Tool } from './registry';

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

export const SCHEDULE_TOOLS = [scheduleSnapshot];
