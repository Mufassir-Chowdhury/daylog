/**
 * The sample week the evals run against: Thursday 29 Oct 2026, 10:00, at the
 * end of a Sun–Thu work week. Matches the setup in docs/assistant/evals.md.
 * Stands in for `db.ts` (reads from these lists; writes are recorded, never
 * stored — the evals only look at what the assistant planned).
 */
import { DEFAULT_CONFIG } from '../config';
import type {
	Account,
	Deadline,
	Note,
	Person,
	PlanTask,
	Routine,
	RoutineLog,
	ScheduleEvent,
	ScheduleSlot,
	Transaction
} from '../../db';
import type { MemoryItem } from '../memory';

export const TODAY = '2026-10-29';
export const NOW = new Date(2026, 9, 29, 10, 0);

const slot = (
	s: Partial<ScheduleSlot> & Pick<ScheduleSlot, 'id' | 'title' | 'weekday' | 'start' | 'end'>
): ScheduleSlot =>
	({ kind: 'class', room: '', startsOn: null, endsOn: null, ...s }) as ScheduleSlot;

export const slots: ScheduleSlot[] = [
	slot({ id: 'ica', title: 'ICA', weekday: 0, start: '09:00', end: '10:30', room: '402' }),
	slot({ id: 'swe', title: 'SWE', weekday: 1, start: '10:00', end: '11:30', room: '501' }),
	slot({
		id: 'dbms-lab',
		title: 'DBMS lab',
		kind: 'lab',
		weekday: 3,
		start: '14:00',
		end: '17:00',
		room: 'Lab 2'
	}),
	// Two Thursday classes, for the "which one?" case.
	slot({ id: 'dm', title: 'DM', weekday: 4, start: '11:30', end: '13:00', room: '304' }),
	slot({ id: 'os', title: 'OS', weekday: 4, start: '15:00', end: '16:30', room: '305' })
];

export const events: ScheduleEvent[] = [
	{
		id: 'invig',
		slotId: null,
		date: '2026-11-02',
		start: '13:00',
		end: '16:00',
		title: 'Invigilation',
		kind: 'invigilation',
		room: '601',
		status: 'planned',
		note: ''
	}
];

const task = (t: Partial<PlanTask> & Pick<PlanTask, 'id' | 'text'>): PlanTask => ({
	date: TODAY,
	until: null,
	start: '',
	end: '',
	status: 'open',
	note: '',
	highlight: false,
	createdAt: 1,
	...t
});

export const tasks: PlanTask[] = [
	task({ id: 'grade-excel', text: 'Grade the Excel exam', date: '2026-11-01' }),
	task({ id: 'dbms-eval-1', text: 'DBMS evaluation 1' }),
	task({ id: 'dbms-eval-2', text: 'DBMS evaluation 2' })
];

export const deadlines: Deadline[] = [
	{
		id: 'dbms-report',
		text: 'DBMS project report',
		due: '2026-11-02',
		label: '',
		hard: true,
		done: false,
		note: ''
	}
];

export const days: Record<string, string> = {
	'2026-10-28': 'buy chalk\n~~grade the quiz~~\ncall @rahim about the invoice',
	[TODAY]: '09:00AM department meeting\nlunch 250'
};

export const people: Person[] = [
	{ handle: 'rahim', name: 'Rahim Uddin', bio: 'Colleague in CSE.' },
	{ handle: 'mom' }
];

export const accounts: Account[] = [{ id: 'cash', name: 'Cash', startingBalance: 5000, order: 1 }];

let n = 0;
const txn = (t: Partial<Transaction>): Transaction => ({
	id: `t${++n}`,
	date: TODAY,
	kind: 'expense',
	category: 'food',
	amount: 120,
	from: 'cash',
	to: null,
	person: null,
	note: '',
	fixed: false,
	group: null,
	createdAt: n,
	...t
});

export const transactions: Transaction[] = [
	...Array.from({ length: 20 }, (_, i) =>
		txn({ date: `2026-09-${String(i + 1).padStart(2, '0')}` })
	),
	...Array.from({ length: 20 }, (_, i) =>
		txn({
			date: `2026-10-${String(i + 1).padStart(2, '0')}`,
			category: i % 2 ? 'food' : 'transport'
		})
	),
	txn({ date: '2026-09-10', kind: 'lend', category: '', person: 'rahim', amount: 500 })
];

export const routines: Routine[] = [
	{ id: 'reading', name: 'Reading', unit: 'pages', threshold: 10, order: 1 }
];
export const routineLogs: RoutineLog[] = [{ date: '2026-10-28', values: { reading: 12 } }];

export const notes: Note[] = [
	{ id: 'thesis', title: 'Thesis outline', content: '1. Intro\n2. Related work', tags: ['thesis'] }
];

export const memory: MemoryItem[] = [
	{ id: 'm1', text: 'Grades exams on Saturdays', kind: 'preference', updatedAt: 1 }
];

/** Everything written, by function name. */
export const writes: { fn: string; args: unknown[] }[] = [];

const list =
	<T>(items: T[]) =>
	async () =>
		structuredClone(items);
const write =
	(fn: string) =>
	async (...args: unknown[]) => {
		writes.push({ fn, args: args.slice(1) });
	};
let ids = 0;
const newId = (prefix: string) => () => `${prefix}-${++ids}`;

/** A `db.ts` stand-in over the lists above. */
export const db = {
	MANUAL_DEVICE: 'manual',
	loadAssistantConfig: async () => structuredClone(DEFAULT_CONFIG),
	loadDay: async (_uid: string, key: string) => days[key] ?? '',
	listDays: async () => Object.entries(days).map(([date, text]) => ({ date, text })),
	daysMentioning: async (_uid: string, handle: string) =>
		Object.entries(days)
			.filter(([, text]) => text.includes(`@${handle}`))
			.map(([date, text]) => ({ date, text }))
			.sort((a, b) => b.date.localeCompare(a.date)),
	listSlots: list(slots),
	listEvents: list(events),
	listTasks: list(tasks),
	listDeadlines: list(deadlines),
	listWeekNotes: list([]),
	listTransactions: list(transactions),
	listPersonTransactions: async (_uid: string, handle: string) =>
		transactions.filter((t) => t.person === handle),
	listAccounts: list(accounts),
	listPeople: list(people),
	loadPerson: async (_uid: string, handle: string) =>
		people.find((p) => p.handle === handle) ?? { handle },
	listRoutines: list(routines),
	listRoutineLogs: list(routineLogs),
	loadRoutineLog: async (_uid: string, date: string) =>
		routineLogs.find((l) => l.date === date)?.values ?? {},
	listNotes: list(notes),
	loadNote: async (_uid: string, id: string) =>
		notes.find((x) => x.id === id) ?? { id, title: '', content: '', tags: [] },
	listLongTermTasks: list([]),
	listMemory: list(memory),
	listFollowups: list([]),
	listActivityDocs: list([]),
	loadActivityConfig: async () => ({ categories: {}, defaultGoals: [] }),
	loadActivityGoals: list([]),
	newScheduleId: newId('sched'),
	newTransactionId: newId('txn'),
	newNoteId: newId('note'),
	newLongTermId: newId('lt'),
	newMemoryId: newId('mem'),
	newFollowupId: newId('fu'),
	newInboxId: newId('card'),
	...Object.fromEntries(
		[
			'saveDeadline',
			'saveEvent',
			'saveFollowup',
			'saveLongTermTask',
			'saveMemory',
			'saveNote',
			'savePerson',
			'saveRoutineValue',
			'saveSlot',
			'saveTask',
			'saveTransaction',
			'saveWeekNote',
			'deleteDeadline',
			'deleteEvent',
			'deleteFollowup',
			'deleteLongTermTask',
			'deleteMemory',
			'deleteNote',
			'deleteSlot',
			'deleteTask',
			'deleteTransaction'
		].map((fn) => [fn, write(fn)])
	)
};
