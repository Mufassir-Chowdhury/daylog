import { listRoutineLogs, listRoutines } from '../../db';
import { dayMet, recentValues, routineStreaks } from '../../routines';
import { dayKey, optStr, params, type Tool } from './registry';

export const routineStats: Tool = {
	area: 'routines',
	kind: 'read',
	def: {
		name: 'routine_stats',
		description:
			'Daily routines (numbers tracked against a target): the value on a day, whether it met the target, ' +
			'current and best streaks, and the last 7 days.',
		parameters: params({ date: optStr('Day, YYYY-MM-DD, or null for today.') })
	},
	describe: () => 'Checking your routines',
	async run(ctx, input) {
		const date = input.date ? dayKey(input.date) : ctx.today;
		const [routines, logs] = await Promise.all([listRoutines(ctx.uid), listRoutineLogs(ctx.uid)]);
		if (!routines.length) return 'No routines set up.';
		return routines.map((r) => {
			const week = recentValues(logs, r.id, date, 7);
			const value = week[week.length - 1].value;
			return {
				name: r.name,
				...(r.unit ? { unit: r.unit } : {}),
				...(r.threshold ? { target: r.threshold } : {}),
				value,
				met: dayMet(value ?? undefined, r.threshold),
				streak: routineStreaks(logs, r.id, r.threshold, date),
				last7: week.map((d) => d.value)
			};
		});
	}
};

export const ROUTINE_TOOLS = [routineStats];
