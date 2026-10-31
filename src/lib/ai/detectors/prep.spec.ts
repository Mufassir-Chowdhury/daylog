import { describe, expect, it } from 'vitest';
import type { PlanTask, ScheduleEvent } from '../../db';
import { upcomingPrep, type PrepData } from './prep';

const TODAY = '2026-11-01';
const at = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const event = (over: Partial<ScheduleEvent>): ScheduleEvent => ({
	id: 'e1',
	slotId: null,
	date: TODAY,
	start: '10:00',
	end: '11:00',
	title: 'Department meeting',
	kind: 'meeting',
	room: '501',
	status: 'planned',
	note: '',
	...over
});
const task = (text: string): PlanTask => ({
	id: text,
	text,
	date: TODAY,
	until: null,
	start: '',
	end: '',
	status: 'open',
	note: '',
	highlight: false,
	createdAt: 1
});
const data = (over: Partial<PrepData>): PrepData => ({
	today: TODAY,
	now: at('09:30'),
	events: [],
	tasks: [],
	dayText: '',
	...over
});
const keys = (d: PrepData) => upcomingPrep(d).map((s) => s.key);

describe('upcomingPrep', () => {
	it('raises a meeting about half an hour before it starts', () => {
		const [signal] = upcomingPrep(data({ events: [event({})] }));
		expect(signal).toMatchObject({
			key: 'prep:2026-11-01:e1',
			type: 'prep',
			title: 'Before Department meeting',
			priority: 2
		});
		expect(signal.about).toContain('starts at 10:00–11:00 AM in 501');
		expect(keys(data({ events: [event({})], now: at('09:10') }))).toEqual([]); // too early
		expect(keys(data({ events: [event({})], now: at('09:45') }))).toEqual([]); // too late
	});

	it('skips plain classes unless an open task is about them, and anything not planned', () => {
		const dm = event({ id: 'c', title: 'DM lecture', kind: 'class' });
		expect(keys(data({ events: [dm] }))).toEqual([]);
		const signals = upcomingPrep(data({ events: [dm], tasks: [task('Grade DM quiz')] }));
		expect(signals.map((s) => s.key)).toEqual(['prep:2026-11-01:c']);
		expect(signals[0].about).toContain('Open tasks that look related: Grade DM quiz.');
		expect(keys(data({ events: [event({ status: 'cancelled' })] }))).toEqual([]);
		expect(keys(data({ events: [event({ date: '2026-11-02' })] }))).toEqual([]);
	});

	it('briefs on the people involved, and looks for notes on the topic', () => {
		const [signal] = upcomingPrep(
			data({ events: [event({ title: 'Thesis review with @rahim', kind: 'other' })] })
		);
		expect(signal.about).toContain('It involves @rahim.');
		expect(signal.facts?.map((f) => [f.tool, f.input])).toEqual([
			['schedule_snapshot', { from: TODAY, to: TODAY }],
			['search_notes', { query: 'thesis' }],
			['get_person', { handle: 'rahim' }]
		]);
	});

	it('also preps a timed meeting line with someone on the page', () => {
		const signals = upcomingPrep(
			data({ dayText: '10:00AM meet @rahim about the invoice\n10:00AM gym\n~~10:00AM call @mom~~' })
		);
		expect(signals).toHaveLength(1);
		expect(signals[0].key).toMatch(/^prep:2026-11-01:line-/);
		expect(signals[0].title).toBe('Before “10:00AM meet @rahim about the invoice”');
	});
});
