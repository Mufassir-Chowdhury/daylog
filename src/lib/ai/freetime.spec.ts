import { describe, expect, it } from 'vitest';
import type { PlanTask, ScheduleEvent, ScheduleSlot } from '../db';
import { freeTime, gaps, hhmm } from './freetime';

const h = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const show = (blocks: { start: number; end: number }[]) =>
	blocks.map((b) => `${hhmm(b.start)}–${hhmm(b.end)}`);

describe('gaps', () => {
	it('finds the gaps of at least the minimum between busy blocks', () => {
		const busy = [
			{ start: h('09:00'), end: h('10:30') },
			{ start: h('10:00'), end: h('11:00') }, // overlaps
			{ start: h('11:30'), end: h('12:00') }, // leaves a 30-minute gap
			{ start: h('21:30'), end: h('23:00') } // runs past the day's end
		];
		expect(show(gaps(busy, 60))).toEqual(['08:00–09:00', '12:00–21:30']);
		expect(show(gaps(busy, 30))).toEqual(['08:00–09:00', '11:00–11:30', '12:00–21:30']);
		expect(show(gaps([], 60))).toEqual(['08:00–22:00']);
	});
});

describe('freeTime', () => {
	// Thursday 2026-10-29 and Friday 2026-10-30.
	const slot: ScheduleSlot = {
		id: 's1',
		weekday: 4,
		start: '09:00',
		end: '10:30',
		title: 'DM',
		kind: 'class',
		room: '304'
	} as ScheduleSlot;
	const event = (over: Partial<ScheduleEvent>): ScheduleEvent => ({
		id: 'e',
		slotId: null,
		date: '2026-10-29',
		start: '14:00',
		end: '',
		title: 'Meeting',
		kind: 'meeting',
		room: '',
		status: 'planned',
		note: '',
		...over
	});
	const task = (over: Partial<PlanTask>): PlanTask => ({
		id: 't',
		text: 'Grade',
		date: '2026-10-29',
		until: null,
		start: '16:00',
		end: '18:00',
		status: 'open',
		note: '',
		highlight: false,
		createdAt: 1,
		...over
	});

	it('leaves out classes, events (an hour when there is no end) and timed tasks', () => {
		const [thu, fri] = freeTime(
			{
				slots: [slot],
				events: [event({}), event({ id: 'x', start: '19:00', status: 'cancelled' })],
				tasks: [task({}), task({ id: 'done', start: '20:00', end: '21:00', status: 'done' })]
			},
			'2026-10-29',
			'2026-10-30',
			60,
			'2026-10-28',
			0
		);
		expect(show(thu.blocks)).toEqual(['08:00–09:00', '10:30–14:00', '15:00–16:00', '18:00–22:00']);
		expect(show(fri.blocks)).toEqual(['08:00–22:00']);
	});

	it('starts today from now and skips past days', () => {
		const days = freeTime(
			{ slots: [], events: [], tasks: [] },
			'2026-10-28',
			'2026-10-29',
			60,
			'2026-10-29',
			h('13:10')
		);
		expect(days.map((d) => [d.date, show(d.blocks)])).toEqual([['2026-10-29', ['13:15–22:00']]]);
	});
});
