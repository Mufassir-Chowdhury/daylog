/**
 * The eval cases (docs/assistant/evals.md), against the sample week in
 * `fixture.ts`. Each says which tools a good answer calls; the reply itself is
 * graded by reading the report.
 */
import type { CheckinKind } from '../config';

export interface ChatCase {
	id: number;
	say: string;
	/** Every one of these must be called. */
	all?: string[];
	/** At least one of these must be called. */
	any?: string[];
	/** No change may be planned (it should ask, or just answer). */
	noChanges?: boolean;
	/** What a good answer does, for whoever reads the report. */
	good: string;
}

export interface CheckinCase {
	id: number;
	kind: CheckinKind;
	/** Tools whose cards it should leave. */
	proposes: string[];
	good: string;
}

export const CHAT_CASES: ChatCase[] = [
	{
		id: 1,
		say: "Monday's SWE class is cancelled, Monday's invigilation is postponed to Tuesday 12:30",
		all: ['set_event_status', 'move_event'],
		good: 'SWE on Mon 2 Nov → cancelled; the invigilation → Tue 3 Nov 12:30. Two cards.'
	},
	{
		id: 2,
		say: "I don't have to grade the Excel exam now",
		all: ['set_task_status'],
		good: '“Grade the Excel exam” → dropped with a short reason. A card.'
	},
	{
		id: 3,
		say: 'DBMS evaluations 1 and 2 are done',
		all: ['set_task_status'],
		good: 'Both evaluation tasks → done (two calls). Cards.'
	},
	{
		id: 4,
		say: 'The Wednesday lab is shifted to Thursday, same time, room 304',
		all: ['move_event'],
		good: 'The DBMS lab of Wed 4 Nov → Thu 5 Nov, 14:00–17:00, room 304.'
	},
	{
		id: 5,
		say: 'No classes next week',
		all: ['cancel_week_classes'],
		good: 'Next week (from Sun 1 Nov) cancelled. A card.'
	},
	{
		id: 6,
		say: 'Thursday class is taken',
		noChanges: true,
		good: 'Asks which one — DM or OS — instead of guessing.'
	},
	{
		id: 7,
		say: 'Add grading DM to later',
		all: ['add_task'],
		good: 'A Later task, applied at once (small addition).'
	},
	{
		id: 8,
		say: 'Remind me to call mom at 9 tonight',
		all: ['append_line'],
		good: 'A timed line on today like “21:00 call @mom”.'
	},
	{
		id: 9,
		say: 'Spent 300 on a taxi',
		all: ['add_transaction'],
		good: 'An expense of 300, transport, from Cash (the only account). A card.'
	},
	{
		id: 11,
		say: 'Gave rahim 500',
		all: ['add_transaction'],
		good: 'A lend of 500 to @rahim. A card.'
	},
	{
		id: 12,
		say: 'Read 12 pages today',
		all: ['log_routine_value'],
		good: 'Reading = 12 for today, applied at once.'
	},
	{
		id: 13,
		say: "Move yesterday's unfinished stuff to today",
		all: ['move_line'],
		good: 'Finds “buy chalk” and “call @rahim about the invoice” open on Wed 28 Oct; a move_line for each.'
	},
	{
		id: 14,
		say: "What's up today?",
		any: ['read_day', 'schedule_snapshot'],
		noChanges: true,
		good: 'The meeting at 9, DM 11:30 in 304 and OS 15:00 in 305, the two DBMS evaluations, the hard report due Mon.'
	},
	{
		id: 16,
		say: 'I like my briefs short, keep that in mind',
		all: ['remember'],
		good: 'Remembers it as a preference; says so in a few words.'
	},
	{
		id: 19,
		say: 'Forget that I grade exams on Saturdays',
		all: ['forget'],
		good: 'Proposes forgetting memory m1. A card.'
	},
	{
		id: 21,
		say: 'Check after my OS class today whether it got marked done',
		all: ['schedule_checkin'],
		good: 'A follow-up today around 16:30–17:00; says when it will look.'
	},
	{
		id: 28,
		say: 'When am I free on Sunday?',
		all: ['free_time'],
		good: 'Sun 1 Nov: free around ICA (09:00–10:30), named as blocks.'
	},
	{
		id: 35,
		say: 'When did I last talk to @rahim?',
		any: ['search_days', 'get_person'],
		noChanges: true,
		good: 'Yesterday (Wed 28 Oct), about the invoice; may mention the 500 he owes.'
	}
];

export const CHECKIN_CASES: CheckinCase[] = [
	{
		id: 22,
		kind: 'warmup',
		proposes: ['move_line'],
		good: 'Opens with the day’s shape; DM and OS with rooms; the report due Mon (hard); move_line cards for yesterday’s open lines.'
	},
	{
		id: 23,
		kind: 'brief',
		proposes: [],
		good: 'What’s open (the two evaluations), tomorrow (Fri, weekend) — short.'
	},
	{
		id: 24,
		kind: 'wrapup',
		proposes: ['add_transaction'],
		good: '“lunch 250” on the page isn’t recorded → an add_transaction card; open lines → move_line cards.'
	},
	{
		id: 30,
		kind: 'review',
		proposes: [],
		good: '“This week:” / “Next week:” parts; next week’s report deadline and the cancelled-or-not classes; saved as a note.'
	}
];
