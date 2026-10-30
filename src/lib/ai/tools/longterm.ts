import { addDays } from '../../date';
import { listLongTermTasks, newLongTermId, type LongTermTask } from '../../db';
import { addLongTerm, addSubtask, setLongTermDone, setSubtaskDone } from '../../ops/records';
import { optBool, params, str, type Tool, type ToolContext } from './registry';

export const listLongTerm: Tool = {
	area: 'longterm',
	kind: 'read',
	def: {
		name: 'list_longterm',
		description:
			'Long-standing tasks (e.g. a thesis) that show on every day page until crossed out, with their subtasks, ' +
			'in priority order. Also lists ones finished in the last 14 days.',
		parameters: params({})
	},
	describe: () => 'Checking your long-term tasks',
	async run(ctx) {
		const since = addDays(ctx.today, -14);
		return (await listLongTermTasks(ctx.uid))
			.filter((t) => t.completedOn === null || t.completedOn >= since)
			.map((t) => ({
				id: t.id,
				text: t.text,
				since: t.createdOn,
				...(t.completedOn ? { finished: t.completedOn } : {}),
				...(t.subtasks.length
					? { subtasks: t.subtasks.map((s) => (s.done ? `✓ ${s.text}` : s.text)) }
					: {})
			}));
	}
};

// ——— Changes.

async function findTask(ctx: ToolContext, id: unknown): Promise<LongTermTask> {
	const task = (await listLongTermTasks(ctx.uid)).find((t) => t.id === id);
	if (!task) throw new Error('No long-term task with that id. Use list_longterm.');
	return task;
}

export const addLongTermTool: Tool = {
	area: 'longterm',
	kind: 'write',
	label: 'Add long-term tasks',
	def: {
		name: 'add_longterm',
		description: 'Add a long-standing task that shows on every day page until crossed out.',
		parameters: params({ text: str('The task.') })
	},
	describe: () => 'Adding a long-term task',
	async plan(ctx, input) {
		const text = String(input.text).trim();
		if (!text) throw new Error('text is empty.');
		const tasks = await listLongTermTasks(ctx.uid);
		return {
			changes: addLongTerm({
				id: newLongTermId(ctx.uid),
				text,
				order: Math.max(-1, ...tasks.map((t) => t.order)) + 1,
				createdOn: ctx.today,
				completedOn: null,
				subtasks: []
			}),
			summary: `Add the long-term task “${text}”`
		};
	}
};

export const addSubtaskTool: Tool = {
	area: 'longterm',
	kind: 'write',
	small: true,
	label: 'Add subtasks',
	def: {
		name: 'add_subtask',
		description: 'Add a subtask to a long-term task.',
		parameters: params({ id: str('Long-term task id.'), text: str('The subtask.') })
	},
	describe: () => 'Adding a subtask',
	async plan(ctx, input) {
		const task = await findTask(ctx, input.id);
		return {
			changes: addSubtask(task, String(input.text)),
			summary: `Add “${String(input.text).trim()}” under “${task.text}”`
		};
	}
};

export const setSubtaskDoneTool: Tool = {
	area: 'longterm',
	kind: 'write',
	label: 'Tick off subtasks',
	def: {
		name: 'set_subtask_done',
		description: 'Tick a subtask of a long-term task off, or back on.',
		parameters: params({
			id: str('Long-term task id.'),
			subtask: str('The subtask’s text.'),
			done: optBool('true (default) to tick off, false to reopen.')
		})
	},
	describe: () => 'Updating a subtask',
	async plan(ctx, input) {
		const task = await findTask(ctx, input.id);
		const wanted = String(input.subtask).trim().toLowerCase();
		const index = task.subtasks.findIndex((s) => s.text.toLowerCase() === wanted);
		const i =
			index >= 0 ? index : task.subtasks.findIndex((s) => s.text.toLowerCase().includes(wanted));
		if (i < 0) throw new Error(`No subtask like “${input.subtask}” under “${task.text}”.`);
		const done = input.done !== false;
		return {
			changes: setSubtaskDone(task, i, done),
			summary: `${done ? 'Tick off' : 'Reopen'} “${task.subtasks[i].text}”`
		};
	}
};

export const setLongTermDoneTool: Tool = {
	area: 'longterm',
	kind: 'write',
	label: 'Finish long-term tasks',
	def: {
		name: 'set_longterm_done',
		description: 'Cross a long-term task out as finished today, or bring it back.',
		parameters: params({
			id: str('Long-term task id.'),
			done: optBool('true (default) to finish, false to reopen.')
		})
	},
	describe: () => 'Updating a long-term task',
	async plan(ctx, input) {
		const task = await findTask(ctx, input.id);
		const done = input.done !== false;
		return {
			changes: setLongTermDone(task, done ? ctx.today : null),
			summary: `${done ? 'Finish' : 'Reopen'} “${task.text}”`
		};
	}
};

export const LONGTERM_TOOLS = [
	listLongTerm,
	addLongTermTool,
	addSubtaskTool,
	setSubtaskDoneTool,
	setLongTermDoneTool
];
