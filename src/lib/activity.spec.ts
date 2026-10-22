import { describe, expect, it } from 'vitest';
import {
	baseline,
	bestFocusWindow,
	browserSite,
	categorize,
	cleanGoals,
	goalLabel,
	goalProgress,
	mergeSources,
	type ActivityGoal,
	formatDuration,
	insights,
	subjectOf,
	summarizeDay,
	summaryLine,
	type ActivitySpan
} from './activity';

const MIN = 60_000;
/** Local time on 2026-10-22 at hh:mm. */
const at = (hh: number, mm = 0) => new Date(2026, 9, 22, hh, mm).getTime();

function span(start: number, minutes: number, exe: string, title = '', app = exe): ActivitySpan {
	return { s: start, e: start + minutes * MIN, exe, app, title };
}

describe('browserSite', () => {
	it('picks known sites out of a title', () => {
		expect(browserSite('Lofi beats - YouTube - Google Chrome')).toBe('YouTube');
		expect(browserSite('Inbox (3) - me@example.com - Gmail - Google Chrome')).toBe('Gmail');
		expect(browserSite('arrays - How to sort? - Stack Overflow — Mozilla Firefox')).toBe(
			'Stack Overflow'
		);
	});

	it('falls back to the last segment after dropping browser and profile names', () => {
		expect(browserSite('Some article | The Verge - Personal - Microsoft​ Edge')).toBe('The Verge');
	});

	it('recognises X', () => {
		expect(browserSite('Home / X - Google Chrome')).toBe('X');
	});

	it('returns null when the title says nothing', () => {
		expect(browserSite('New Tab - Google Chrome')).toBeNull();
		expect(browserSite('')).toBeNull();
		expect(browserSite(undefined)).toBeNull();
	});
});

describe('subjects and categories', () => {
	it('names browser time by site and apps by app', () => {
		expect(
			subjectOf(span(0, 1, 'chrome', 'Cats - YouTube - Google Chrome', 'Google Chrome'))
		).toEqual({ key: 'site:youtube', label: 'YouTube', via: 'Google Chrome' });
		expect(subjectOf(span(0, 1, 'Code', 'a.ts - daylog', 'Visual Studio Code'))).toEqual({
			key: 'app:code',
			label: 'Visual Studio Code'
		});
	});

	it('uses defaults and honours overrides', () => {
		const yt = span(0, 1, 'chrome', 'Lecture - YouTube - Google Chrome');
		expect(categorize(yt)).toBe('distraction');
		expect(categorize(yt, { 'site:youtube': 'focus' })).toBe('focus');
		expect(categorize(span(0, 1, 'Code'))).toBe('focus');
		expect(categorize(span(0, 1, 'slack'))).toBe('communication');
		expect(categorize(span(0, 1, 'mspaint'))).toBe('neutral');
	});
});

describe('summarizeDay', () => {
	it('totals time by category and subject', () => {
		const day = summarizeDay('2026-10-22', [
			span(at(9), 30, 'Code'),
			span(at(9, 30), 10, 'chrome', 'x - YouTube - Google Chrome'),
			span(at(9, 40), 20, 'Code')
		]);
		expect(day.active).toBe(60 * MIN);
		expect(day.byCategory.focus).toBe(50 * MIN);
		expect(day.byCategory.distraction).toBe(10 * MIN);
		expect(day.subjects[0]).toMatchObject({ key: 'app:code', ms: 50 * MIN });
		expect(day.switches).toBe(2);
		expect(day.hours[9].focus).toBe(50 * MIN);
	});

	it('splits time across hour buckets', () => {
		const day = summarizeDay('2026-10-22', [span(at(9, 50), 20, 'Code')]);
		expect(day.hours[9].focus).toBe(10 * MIN);
		expect(day.hours[10].focus).toBe(10 * MIN);
	});

	it('keeps a focus session through a short detour, and ends it after a long one', () => {
		const day = summarizeDay('2026-10-22', [
			span(at(9), 20, 'Code'),
			span(at(9, 20), 1, 'slack'),
			span(at(9, 21), 15, 'Code'),
			span(at(9, 36), 10, 'chrome', 'r/all - Reddit - Google Chrome'),
			span(at(9, 46), 10, 'Code')
		]);
		expect(day.sessions).toHaveLength(2);
		expect(day.sessions[0]).toMatchObject({ ms: 35 * MIN, interruptions: 1, top: 'Code' });
		expect(day.deepWork).toBe(35 * MIN);
		expect(day.longest?.ms).toBe(35 * MIN);
	});

	it('ends a session at a long break and does not count it as a switch', () => {
		const day = summarizeDay('2026-10-22', [span(at(9), 30, 'Code'), span(at(11), 30, 'winword')]);
		expect(day.sessions).toHaveLength(2);
		expect(day.switches).toBe(0);
	});

	it('trims overlapping spans', () => {
		const day = summarizeDay('2026-10-22', [span(at(9), 30, 'Code'), span(at(9, 10), 30, 'Code')]);
		expect(day.active).toBe(40 * MIN);
	});
});

describe('baseline and insights', () => {
	const typical = (d: number) =>
		summarizeDay(`2026-10-${String(d).padStart(2, '0')}`, [
			span(new Date(2026, 9, d, 9).getTime(), 90, 'Code'),
			span(new Date(2026, 9, d, 14).getTime(), 20, 'chrome', 'x - YouTube - Chrome')
		]);

	it('averages over active days only', () => {
		const base = baseline([typical(15), typical(16), summarizeDay('2026-10-17', [])]);
		expect(base.days).toBe(2);
		expect(base.active).toBe(110 * MIN);
		expect(base.subjects.get('site:youtube')).toBe(20 * MIN);
		expect(bestFocusWindow(base.focusByHour)?.hour).toBe(9);
	});

	it('explains a distracted day against the usual', () => {
		const base = baseline([15, 16, 17, 18, 19, 20].map(typical));
		const day = summarizeDay('2026-10-21', [
			span(new Date(2026, 9, 21, 9).getTime(), 30, 'chrome', 'x - YouTube - Chrome'),
			span(new Date(2026, 9, 21, 9, 30).getTime(), 40, 'Code'),
			span(new Date(2026, 9, 21, 10, 10).getTime(), 30, 'chrome', 'y - YouTube - Chrome')
		]);
		const text = insights(day, base, false).map((i) => i.text);
		expect(text.some((t) => t.startsWith('YouTube took 1h 00m — 3×'))).toBe(true);
		expect(text.some((t) => t.includes('Longest focus stretch: 40m'))).toBe(true);
		expect(text.some((t) => t.startsWith('Your sharpest hours are 9 AM–11 AM'))).toBe(true);
	});

	it('says nothing about an almost empty day', () => {
		const day = summarizeDay('2026-10-21', [span(at(9), 2, 'Code')]);
		expect(insights(day, baseline([]), true)).toEqual([]);
	});
});

describe('formatting', () => {
	it('formats durations', () => {
		expect(formatDuration(0)).toBe('0m');
		expect(formatDuration(20_000)).toBe('<1m');
		expect(formatDuration(42 * MIN)).toBe('42m');
		expect(formatDuration(125 * MIN)).toBe('2h 05m');
	});

	it('builds a summary line for the day page', () => {
		const day = summarizeDay('2026-10-22', [span(at(9), 30, 'Code', '', 'Visual Studio Code')]);
		expect(summaryLine(day)).toBe(
			'activity — screen time 30m · deep work 30m · top: Visual Studio Code 30m'
		);
	});
});

describe('mergeSources', () => {
	it('lets manual time replace recorded time in the same minutes', () => {
		const merged = mergeSources(
			[span(at(9), 120, 'chrome', 'x - YouTube - Chrome')],
			[{ ...span(at(10), 30, 'Reading'), subject: 'manual:reading' }]
		);
		expect(merged.map((s) => [(s.s - at(9)) / MIN, (s.e - s.s) / MIN, s.manual ?? false])).toEqual([
			[0, 60, false],
			[60, 30, true],
			[90, 30, false]
		]);
	});

	it('names manual entries by their subject', () => {
		const manual = { ...span(at(10), 30, 'Visual Studio Code'), subject: 'app:code' };
		const day = summarizeDay('2026-10-22', mergeSources([span(at(9), 30, 'Code')], [manual]));
		expect(day.subjects).toHaveLength(1);
		expect(day.subjects[0]).toMatchObject({ key: 'app:code', ms: 60 * MIN, category: 'focus' });
	});
});

describe('goals', () => {
	const goal = (g: Partial<ActivityGoal>): ActivityGoal => ({
		id: 'g',
		kind: 'total',
		category: 'focus',
		keys: [],
		names: [],
		minutes: 60,
		limit: false,
		...g
	});
	const day = summarizeDay('2026-10-22', [
		span(at(9), 50, 'Code'),
		span(at(9, 50), 40, 'chrome', 'x - YouTube - Chrome')
	]);

	it('counts recorded time towards targets and limits', () => {
		expect(goalProgress(goal({ kind: 'category', category: 'focus' }), day)).toMatchObject({
			ms: 50 * MIN,
			met: false
		});
		expect(goalProgress(goal({ kind: 'deep', minutes: 45 }), day).met).toBe(true);
		const yt = goal({
			kind: 'subjects',
			keys: ['site:youtube'],
			names: ['YouTube'],
			minutes: 30,
			limit: true
		});
		expect(goalProgress(yt, day)).toMatchObject({ ms: 40 * MIN, met: false });
		expect(goalLabel(yt)).toBe('YouTube · at most 30m');
		expect(goalProgress(goal({ kind: 'total', minutes: 90 }), day).met).toBe(true);
	});

	it('drops malformed goals read from storage', () => {
		expect(
			cleanGoals([
				{ id: 'a', kind: 'deep', minutes: 120 },
				{ id: 'b', kind: 'nope', minutes: 10 },
				{ id: 'c', kind: 'total', minutes: 0 },
				'junk'
			])
		).toEqual([
			{ id: 'a', kind: 'deep', category: 'focus', keys: [], names: [], minutes: 120, limit: false }
		]);
		expect(cleanGoals(undefined)).toEqual([]);
	});
});
