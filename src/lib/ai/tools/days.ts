import { addDays } from '../../date';
import { listDays, loadDay } from '../../db';
import { appendLine } from '../../ops/records';
import { change } from '../../ops/change';
import { doneContent, parseDay, toggleDone, type Line } from '../../parse';
import { shortDay } from '../../schedule';
import {
	cached,
	dayKey,
	optBool,
	optInt,
	optStr,
	params,
	str,
	weekday,
	type Tool,
	type ToolContext
} from './registry';

const lineText = (l: Line) =>
	l.segments
		.map((s) => s.text)
		.join('')
		.trim();

const lineOut = (l: Line) => ({
	text: lineText(l),
	...(l.timeLabel ? { time: l.timeLabel } : {}),
	...(l.done ? { done: true } : {})
});

export const readDay: Tool = {
	area: 'days',
	kind: 'read',
	def: {
		name: 'read_day',
		description:
			"Read one day's page: its timed lines (sorted by time) and other lines. Crossed-out lines are done.",
		parameters: params({ date: str('Day, YYYY-MM-DD.') })
	},
	describe: (i) => `Reading ${i.date}`,
	async run(ctx, input) {
		const date = dayKey(input.date);
		const { timed, notes } = parseDay(await loadDay(ctx.uid, date));
		if (!timed.length && !notes.length) return { date, weekday: weekday(date), empty: true };
		return {
			date,
			weekday: weekday(date),
			timed: timed.map(lineOut),
			lines: notes.map(lineOut)
		};
	}
};

export const searchDays: Tool = {
	area: 'days',
	kind: 'read',
	def: {
		name: 'search_days',
		description:
			'Search the lines of all day pages, newest first. Matches lines containing every word of the query; ' +
			'a query like "@rahim" finds lines mentioning that person.',
		parameters: params({
			query: str('Words to find, or an @handle.'),
			from: optStr('Earliest day, YYYY-MM-DD, or null for no limit.'),
			to: optStr('Latest day, YYYY-MM-DD, or null for no limit.'),
			limit: optInt('Most lines to return (default 30, max 100).')
		})
	},
	describe: (i) => `Searching your days for “${i.query}”`,
	async run(ctx, input) {
		const words = String(input.query).toLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length) throw new Error('query is empty.');
		const from = input.from ? dayKey(input.from, 'from') : '0000-00-00';
		const to = input.to ? dayKey(input.to, 'to') : '9999-99-99';
		const limit = Math.min(Math.max(Number(input.limit) || 30, 1), 100);
		const days = await cached(ctx, 'days', () => listDays(ctx.uid));
		const matches: { date: string; line: string; done?: boolean }[] = [];
		for (const { date, text } of [...days].reverse()) {
			if (date < from || date > to) continue;
			const { timed, notes } = parseDay(text);
			for (const l of [...timed, ...notes]) {
				const raw = l.raw.toLowerCase();
				if (words.every((w) => raw.includes(w)))
					matches.push({
						date,
						line: `${l.timeLabel ? `${l.timeLabel} ` : ''}${lineText(l)}`,
						...(l.done ? { done: true } : {})
					});
			}
		}
		return { total: matches.length, matches: matches.slice(0, limit) };
	}
};

export const recentDays: Tool = {
	area: 'days',
	kind: 'read',
	def: {
		name: 'open_lines',
		description:
			'Lines not crossed out on the days before a date — what was left unfinished. Use for carrying things over.',
		parameters: params({
			before: str('Look at days before this one, YYYY-MM-DD (usually today).'),
			days: optInt('How many days back (default 3, max 14).')
		})
	},
	describe: () => 'Checking what was left unfinished',
	async run(ctx, input) {
		const before = dayKey(input.before, 'before');
		const n = Math.min(Math.max(Number(input.days) || 3, 1), 14);
		const out: { date: string; open: ReturnType<typeof lineOut>[] }[] = [];
		for (let i = 1; i <= n; i++) {
			const date = addDays(before, -i);
			const { timed, notes } = parseDay(await loadDay(ctx.uid, date));
			const open = [...timed, ...notes].filter((l) => !l.done).map(lineOut);
			if (open.length) out.push({ date, open });
		}
		return out.length ? out : 'Nothing left open.';
	}
};

// ——— Changes.

/** The raw line on a day whose text is `wanted` (as read_day shows it, or as written). */
async function findLine(ctx: ToolContext, date: string, wanted: string): Promise<Line> {
	const { timed, notes } = parseDay(await loadDay(ctx.uid, date));
	const lines = [...timed, ...notes];
	const target = wanted.trim().toLowerCase();
	const hit =
		lines.find(
			(l) => lineText(l).toLowerCase() === target || l.raw.trim().toLowerCase() === target
		) ?? lines.find((l) => l.raw.toLowerCase().includes(target));
	if (!hit) throw new Error(`No line like “${wanted}” on ${date}. Read the day first.`);
	return hit;
}

export const appendLineTool: Tool = {
	area: 'days',
	kind: 'write',
	small: true,
	label: 'Add lines to a day',
	def: {
		name: 'append_line',
		description:
			'Add a line at the end of a day page. Start it with a time (21:00 gym) to put it on that day’s schedule; ' +
			'@handle mentions a person.',
		parameters: params({
			date: str('Day, YYYY-MM-DD.'),
			text: str('The line, as the owner would write it.')
		})
	},
	describe: () => 'Adding a line',
	async plan(_ctx, input) {
		const date = dayKey(input.date);
		const text = String(input.text).trim();
		if (!text) throw new Error('text is empty.');
		return { changes: appendLine(date, text), summary: `Add “${text}” to ${shortDay(date)}` };
	}
};

export const setLineDone: Tool = {
	area: 'days',
	kind: 'write',
	label: 'Cross lines out',
	def: {
		name: 'set_line_done',
		description: 'Cross a line on a day page out (done) or back in.',
		parameters: params({
			date: str('Day, YYYY-MM-DD.'),
			line: str('The line’s text as read_day shows it.'),
			done: optBool('true to cross out (default), false to bring back.')
		})
	},
	describe: () => 'Crossing a line out',
	async plan(ctx, input) {
		const date = dayKey(input.date);
		const line = await findLine(ctx, date, String(input.line));
		const done = input.done !== false;
		const label = `“${lineText(line)}” on ${shortDay(date)}`;
		if (line.done === done)
			return { changes: [], summary: `${label} ${done ? 'crossed out' : 'open'}` };
		return {
			changes: [change('dayLine', { date, line: line.raw }, { date, line: toggleDone(line.raw) })],
			summary: `${done ? 'Cross out' : 'Bring back'} ${label}`
		};
	}
};

export const moveLine: Tool = {
	area: 'days',
	kind: 'write',
	label: 'Move lines between days',
	def: {
		name: 'move_line',
		description:
			'Move a line from one day page to the end of another (e.g. carry an unfinished item to today).',
		parameters: params({
			from: str('Day it’s on now, YYYY-MM-DD.'),
			line: str('The line’s text as read_day shows it.'),
			to: str('Day to move it to, YYYY-MM-DD.')
		})
	},
	describe: () => 'Moving a line',
	async plan(ctx, input) {
		const from = dayKey(input.from, 'from');
		const to = dayKey(input.to, 'to');
		if (from === to) throw new Error('from and to are the same day.');
		const line = await findLine(ctx, from, String(input.line));
		// It arrives open, without the crossing-out.
		const moved = line.done ? (doneContent(line.raw) ?? line.raw) : line.raw;
		return {
			changes: [change('dayLine', { date: from, line: line.raw }, null), ...appendLine(to, moved)],
			summary: `Move “${lineText(line)}” from ${shortDay(from)} to ${shortDay(to)}`
		};
	}
};

export const DAY_TOOLS = [readDay, searchDays, recentDays, appendLineTool, setLineDone, moveLine];
