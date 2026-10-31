import {
	baseline,
	bestFocusWindow,
	CATEGORY_LABEL,
	dayRange,
	formatDuration,
	formatTime,
	goalLabel,
	goalProgress,
	hourLabel,
	insights,
	mergeSources,
	summarizeDay,
	type ActivitySpan
} from '../../activity';
import { addDays } from '../../date';
import { listActivityDocs, loadActivityConfig, loadActivityGoals, MANUAL_DEVICE } from '../../db';
import { desktop } from '../../desktop';
import { dayKey, optStr, params, type Tool } from './registry';

const HISTORY = 14;

/** Every source merged per day, the way the Activity page does it. */
async function spansByDay(uid: string, date: string): Promise<Record<string, ActivitySpan[]>> {
	const from = addDays(date, -HISTORY);
	const [remote, status, local] = await Promise.all([
		listActivityDocs(uid, from, date),
		desktop ? desktop.activityStatus() : null,
		desktop ? desktop.activityDays(from, date) : ({} as Record<string, ActivitySpan[]>)
	]);
	const thisDevice = status?.device.id ?? null;
	const out: Record<string, ActivitySpan[]> = {};
	for (const key of dayRange(date, HISTORY + 1)) {
		const tracked = [...(local[key] ?? [])];
		const manual: ActivitySpan[] = [];
		for (const d of remote) {
			if (d.date !== key) continue;
			if (d.device === MANUAL_DEVICE) manual.push(...d.spans);
			else if (!(d.device === thisDevice && key in local)) tracked.push(...d.spans);
		}
		out[key] = mergeSources(tracked, manual);
	}
	return out;
}

/**
 * One day's computer time with what it's measured against: the summary, the
 * baseline of the days before, goal progress and the best focus window. Shared
 * with the focus coach.
 */
export async function activityFor(uid: string, date: string) {
	const [raw, config, goals] = await Promise.all([
		spansByDay(uid, date),
		loadActivityConfig(uid),
		loadActivityGoals(uid, date)
	]);
	const history = dayRange(date, HISTORY + 1).map((k) =>
		summarizeDay(k, raw[k] ?? [], config.categories)
	);
	const day = history[history.length - 1];
	const base = baseline(history.slice(0, -1));
	return {
		day,
		base,
		goals: goals.map((g) => goalProgress(g, day)),
		best: bestFocusWindow(base.focusByHour)
	};
}

export const activityDay: Tool = {
	area: 'activity',
	kind: 'read',
	def: {
		name: 'activity_day',
		description:
			'Computer time on a day (recorded by the desktop app): total, focus / messages / distraction, deep work, ' +
			'top apps and sites with window titles, goals progress, observations against recent days, and the best ' +
			'focus hours.',
		parameters: params({ date: optStr('Day, YYYY-MM-DD, or null for today.') })
	},
	describe: () => 'Checking your computer time',
	async run(ctx, input) {
		const date = input.date ? dayKey(input.date) : ctx.today;
		const { day, base, goals, best } = await activityFor(ctx.uid, date);
		if (day.active === 0) return `No computer time recorded on ${date}.`;
		return {
			date,
			total: formatDuration(day.active),
			from: day.first ? formatTime(day.first) : null,
			until: day.last ? formatTime(day.last) : null,
			byCategory: Object.fromEntries(
				Object.entries(day.byCategory).map(([c, ms]) => [
					CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL],
					formatDuration(ms)
				])
			),
			deepWork: formatDuration(day.deepWork),
			switches: day.switches,
			top: day.subjects.slice(0, 8).map((s) => ({
				name: s.label,
				category: s.category,
				time: formatDuration(s.ms),
				...(s.titles.length ? { titles: s.titles.slice(0, 3).map((t) => t.title) } : {})
			})),
			goals: goals.map((p) => ({
				goal: goalLabel(p.goal),
				done: formatDuration(p.ms),
				met: p.met
			})),
			observations: insights(day, base, date === ctx.today).map((i) => i.text),
			...(best ? { bestFocusHours: `${hourLabel(best.hour)}–${hourLabel(best.hour + 2)}` } : {}),
			averageDay: formatDuration(base.active)
		};
	}
};

export const ACTIVITY_TOOLS = [activityDay];
