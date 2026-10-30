import { addDays } from '../../date';
import { listLongTermTasks } from '../../db';
import { params, type Tool } from './registry';

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

export const LONGTERM_TOOLS = [listLongTerm];
