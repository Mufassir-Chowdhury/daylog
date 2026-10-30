import { addDays } from '../../date';
import { listDays, loadDay } from '../../db';
import { parseDay, type Line } from '../../parse';
import { cached, dayKey, optInt, optStr, params, str, weekday, type Tool } from './registry';

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

export const DAY_TOOLS = [readDay, searchDays, recentDays];
