import { describe, expect, it } from 'vitest';
import type { ActivityGoal, GoalProgress } from '../activity';
import { focusNudge, NUDGE_GAP, topTask, type FocusInput } from './focus';

const MIN = 60_000;
const goal = (over: Partial<ActivityGoal>): ActivityGoal => ({
	id: 'g1',
	kind: 'subjects',
	category: 'distraction' as ActivityGoal['category'],
	keys: ['site:youtube'],
	names: ['YouTube'],
	minutes: 30,
	limit: true,
	...over
});
const progress = (g: ActivityGoal, usedMin: number): GoalProgress => ({
	goal: g,
	ms: usedMin * MIN,
	target: g.minutes * MIN,
	ratio: usedMin / g.minutes,
	met: g.limit ? usedMin <= g.minutes : usedMin >= g.minutes
});
const at = (time: string) => new Date(`2026-11-01T${time}:00`);
const input = (over: Partial<FocusInput>): FocusInput => ({
	now: at('10:05'),
	today: '2026-11-01',
	goals: [],
	best: null,
	free: [],
	topTask: null,
	lastNudge: 0,
	sent: new Set(),
	quiet: false,
	...over
});

describe('focusNudge', () => {
	it('warns when a limit is nearly used up, then when it is passed', () => {
		expect(focusNudge(input({ goals: [progress(goal({}), 25)] }))).toEqual({
			key: 'limit:g1:2026-11-01',
			title: 'YouTube: 5m left',
			body: '25m of your 30m for today is used.'
		});
		expect(focusNudge(input({ goals: [progress(goal({}), 40)] }))?.key).toBe('over:g1:2026-11-01');
		expect(focusNudge(input({ goals: [progress(goal({}), 10)] }))).toBeNull();
		// Targets ("at least") are not nudged.
		expect(focusNudge(input({ goals: [progress(goal({ limit: false }), 29)] }))).toBeNull();
	});

	it('points out the best focus hours when they start free', () => {
		const free = [{ start: 10 * 60 + 15, end: 13 * 60 }];
		const nudge = focusNudge(input({ best: { hour: 10 }, free, topTask: 'Thesis chapter 2' }));
		expect(nudge?.key).toBe('focus:2026-11-01');
		expect(nudge?.body).toContain('nothing is planned. A good moment for “Thesis chapter 2”.');
		// A class in the window, or too late into it: nothing.
		expect(
			focusNudge(input({ best: { hour: 10 }, free: [{ start: 10 * 60 + 15, end: 11 * 60 }] }))
		).toBeNull();
		expect(focusNudge(input({ best: { hour: 10 }, free, now: at('10:40') }))).toBeNull();
	});

	it('nudges at most once an hour, once per kind a day, never in quiet hours', () => {
		const goals = [progress(goal({}), 25)];
		const now = at('10:05');
		expect(focusNudge(input({ goals, lastNudge: now.getTime() - NUDGE_GAP + MIN }))).toBeNull();
		expect(focusNudge(input({ goals, sent: new Set(['limit:g1:2026-11-01']) }))).toBeNull();
		expect(focusNudge(input({ goals, quiet: true }))).toBeNull();
	});
});

describe('topTask', () => {
	it('prefers a highlighted task, then today, then overdue', () => {
		const t = (text: string, date: string | null, highlight = false, status = 'open') => ({
			text,
			date,
			highlight,
			status
		});
		const today = '2026-11-01';
		expect(topTask([t('old', '2026-10-30'), t('today', today), t('hl', today, true)], today)).toBe(
			'hl'
		);
		expect(topTask([t('old', '2026-10-30'), t('today', today)], today)).toBe('today');
		expect(
			topTask([t('later', null), t('next', '2026-11-02'), t('done', today, true, 'done')], today)
		).toBeNull();
	});
});
