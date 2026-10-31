import { describe, expect, it } from 'vitest';
import type { Deadline, PlanTask } from '../../db';
import { carryOver, detect, unplannedDeadline, type DetectorData } from './index';

const TODAY = '2026-10-31';
const data = (over: Partial<DetectorData> = {}): DetectorData => ({
	today: TODAY,
	days: {},
	deadlines: [],
	tasks: [],
	...over
});
const deadline = (over: Partial<Deadline>): Deadline => ({
	id: 'd1',
	text: 'DBMS project report',
	due: '2026-11-03',
	label: '',
	hard: false,
	done: false,
	note: '',
	...over
});
const task = (text: string, status: PlanTask['status'] = 'open'): PlanTask => ({
	id: text,
	text,
	date: TODAY,
	until: null,
	start: '',
	end: '',
	status,
	note: '',
	highlight: false,
	createdAt: 1
});

describe('carryOver', () => {
	it("raises yesterday's open lines once, under a key for that day", () => {
		const signals = carryOver(
			data({ days: { '2026-10-30': 'call @mom\n~~grade DM~~\n21:00 gym' } })
		);
		expect(signals).toHaveLength(1);
		expect(signals[0]).toMatchObject({
			key: 'carryover:2026-10-30',
			type: 'carryover',
			coveredBy: 'move_line'
		});
		expect(signals[0].about).toContain('2 lines were left open');
		expect(signals[0].about).toContain('“call @mom”');
		expect(signals[0].about).not.toContain('grade DM');
	});

	it('says nothing when everything was done or the day was empty', () => {
		expect(carryOver(data({ days: { '2026-10-30': '~~a~~\n~~b~~' } }))).toEqual([]);
		expect(carryOver(data())).toEqual([]);
	});
});

describe('unplannedDeadline', () => {
	it('raises a deadline within 5 days with no open task about it', () => {
		const [signal] = unplannedDeadline(data({ deadlines: [deadline({})] }));
		expect(signal).toMatchObject({ key: 'deadline:d1', type: 'deadline', priority: 1 });
		expect(signal.about).toContain('due 2026-11-03 (in 3 days)');
		expect(signal.title).toBe('Coming up: DBMS project report');
	});

	it('stays quiet when an open task is about it', () => {
		expect(
			unplannedDeadline(data({ deadlines: [deadline({})], tasks: [task('Write DBMS intro')] }))
		).toEqual([]);
		// A finished or dropped task doesn't count.
		expect(
			unplannedDeadline(
				data({ deadlines: [deadline({})], tasks: [task('Write DBMS intro', 'done')] })
			)
		).toHaveLength(1);
	});

	it('ignores done, undated, past and far-off deadlines', () => {
		const deadlines = [
			deadline({ id: 'a', done: true }),
			deadline({ id: 'b', due: null }),
			deadline({ id: 'c', due: '2026-10-30' }),
			deadline({ id: 'd', due: '2026-11-06' })
		];
		expect(unplannedDeadline(data({ deadlines }))).toEqual([]);
	});

	it('ranks hard and close ones higher', () => {
		const signals = detect(
			data({
				deadlines: [
					deadline({ id: 'hard', text: 'Thesis draft', hard: true }),
					deadline({ id: 'soon', text: 'Quiz grading', due: '2026-11-01' })
				]
			})
		);
		expect(signals.map((s) => [s.key, s.priority])).toEqual([
			['deadline:hard', 2],
			['deadline:soon', 2]
		]);
		expect(signals[1].about).toContain('in 1 day');
	});
});
