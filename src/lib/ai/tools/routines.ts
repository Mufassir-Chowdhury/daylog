import { listRoutineLogs, listRoutines, loadRoutineLog } from '../../db';
import { logRoutineValue } from '../../ops/records';
import { dayMet, recentValues, routineStreaks } from '../../routines';
import { dayKey, optNum, optStr, params, str, type Tool } from './registry';

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

// ——— Changes.

export const logRoutineValueTool: Tool = {
	area: 'routines',
	kind: 'write',
	small: true,
	label: 'Log routine values',
	def: {
		name: 'log_routine_value',
		description:
			'Log the number for a daily routine on a day (replaces what was logged), or clear it.',
		parameters: params({
			routine: str('Routine name (or id).'),
			date: optStr('Day, YYYY-MM-DD, or null for today.'),
			value: optNum('The number, or null to clear the day.')
		})
	},
	describe: () => 'Logging a routine',
	async plan(ctx, input) {
		const date = input.date ? dayKey(input.date) : ctx.today;
		const wanted = String(input.routine).trim().toLowerCase();
		const routines = await listRoutines(ctx.uid);
		const routine =
			routines.find((r) => r.id === input.routine || r.name.toLowerCase() === wanted) ??
			routines.find((r) => r.name.toLowerCase().includes(wanted));
		if (!routine)
			throw new Error(
				`No routine like “${input.routine}”. There are: ${routines.map((r) => r.name).join(', ') || 'none'}.`
			);
		const current = (await loadRoutineLog(ctx.uid, date))[routine.id];
		const value = input.value === null ? null : Number(input.value);
		const unit = routine.unit ? ` ${routine.unit}` : '';
		return {
			changes: logRoutineValue(
				date,
				routine.id,
				typeof current === 'number' ? current : null,
				value
			),
			summary:
				value === null
					? `Clear ${routine.name} for ${date}`
					: `Log ${value}${unit} of ${routine.name}${date === ctx.today ? '' : ` for ${date}`}`
		};
	}
};

export const ROUTINE_TOOLS = [routineStats, logRoutineValueTool];
