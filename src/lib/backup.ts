import { isValidKey } from './date';
import type {
	Account,
	Deadline,
	PlanTask,
	ScheduleEvent,
	ScheduleSlot,
	WeekNote,
	LongTermTask,
	Note,
	Person,
	Routine,
	RoutineLog,
	Subtask,
	Transaction,
	TransactionKind,
	UserData
} from './db';
import { EVENT_KINDS, type EventKind, type EventStatus, type TaskStatus } from './schedule';
import { THEMES, type AppSettings, type Theme } from './settings.svelte';

/** Shape of a `daylog-backup-*.json` file: the user's data plus an identifying envelope. */
export interface Backup extends UserData {
	app: 'daylog';
	version: 1;
	exportedAt: string;
}

export function serializeBackup(data: UserData): string {
	const backup: Backup = {
		app: 'daylog',
		version: 1,
		exportedAt: new Date().toISOString(),
		...data
	};
	return JSON.stringify(backup, null, '\t');
}

/** "3 days, 2 people, …" — shown in the confirm dialog before importing. */
export function backupSummary(data: UserData): string {
	return [
		`${data.days.length} days`,
		`${data.people.length} people`,
		`${data.notes.length} notes`,
		`${data.longTermTasks.length} long-term tasks`,
		`${data.accounts.length} accounts`,
		`${data.transactions.length} transactions`,
		`${data.routines.length} routines`,
		`${data.routineLogs.length} routine days`,
		`${data.slots.length} timetable slots`,
		`${data.events.length} events`,
		`${data.tasks.length} plan tasks`,
		`${data.deadlines.length} deadlines`
	].join(', ');
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const rec = (v: unknown): Record<string, unknown> =>
	typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);

const KINDS: TransactionKind[] = ['income', 'expense', 'transfer', 'lend', 'borrow'];
const EVENT_KIND_IDS: EventKind[] = EVENT_KINDS.map((k) => k.id);
const EVENT_STATUSES: EventStatus[] = ['planned', 'done', 'cancelled', 'moved'];
const TASK_STATUSES: TaskStatus[] = ['open', 'done', 'dropped', 'moved'];
const dayOrNull = (v: unknown): string | null =>
	typeof v === 'string' && isValidKey(v) ? v : null;
const eventKind = (v: unknown, fallback: EventKind): EventKind =>
	EVENT_KIND_IDS.includes(v as EventKind) ? (v as EventKind) : fallback;

/**
 * Parses and sanitizes a backup file: unknown fields are dropped, missing ones
 * get defaults, and entries without a usable key (valid date, handle or id)
 * are skipped. Throws with a human-readable message when the file isn't a
 * daylog backup at all.
 */
export function parseBackup(json: string): UserData {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		throw new Error('This file is not valid JSON.');
	}
	const backup = rec(raw);
	if (backup.app !== 'daylog') throw new Error('This file is not a daylog backup.');
	if (backup.version !== 1)
		throw new Error(`Unsupported backup version: ${String(backup.version)}.`);

	const s = rec(backup.settings);
	const settings: Partial<AppSettings> = {};
	if (THEMES.includes(s.theme as Theme)) settings.theme = s.theme as Theme;
	if (typeof s.currency === 'string') settings.currency = s.currency;
	if (s.grouping === 'lakh' || s.grouping === 'thousand') settings.grouping = s.grouping;
	for (const key of [
		'showNotePanel',
		'showLongTermPanel',
		'showFinancePanel',
		'showRoutinePanel',
		'showPlanPanel'
	] as const)
		if (typeof s[key] === 'boolean') settings[key] = s[key];

	return {
		settings,
		days: arr(backup.days)
			.filter((d) => isValidKey(str(d.date)))
			.map((d) => ({ date: str(d.date), text: str(d.text) })),
		people: arr(backup.people)
			.filter((p) => str(p.handle) !== '')
			.map((p) => {
				const person: Person = { handle: str(p.handle) };
				if (typeof p.name === 'string') person.name = p.name;
				if (typeof p.bio === 'string') person.bio = p.bio;
				return person;
			}),
		notes: arr(backup.notes)
			.filter((n) => str(n.id) !== '')
			.map((n): Note => ({
				id: str(n.id),
				title: str(n.title),
				content: str(n.content),
				tags: Array.isArray(n.tags) ? n.tags.filter((t): t is string => typeof t === 'string') : []
			})),
		longTermTasks: arr(backup.longTermTasks)
			.filter((t) => str(t.id) !== '')
			.map((t): LongTermTask => ({
				id: str(t.id),
				text: str(t.text),
				order: num(t.order),
				createdOn: str(t.createdOn),
				completedOn: strOrNull(t.completedOn),
				subtasks: arr(t.subtasks).map((st): Subtask => ({
					text: str(st.text),
					done: st.done === true
				}))
			})),
		accounts: arr(backup.accounts)
			.filter((a) => str(a.id) !== '')
			.map((a): Account => ({
				id: str(a.id),
				name: str(a.name),
				startingBalance: num(a.startingBalance),
				order: num(a.order)
			})),
		transactions: arr(backup.transactions)
			.filter((t) => str(t.id) !== '' && isValidKey(str(t.date)))
			.map((t): Transaction => ({
				id: str(t.id),
				date: str(t.date),
				kind: KINDS.includes(t.kind as TransactionKind) ? (t.kind as TransactionKind) : 'expense',
				category: str(t.category),
				amount: num(t.amount),
				from: strOrNull(t.from),
				to: strOrNull(t.to),
				person: strOrNull(t.person),
				note: str(t.note),
				fixed: t.fixed === true,
				group: str(t.group).trim() || null,
				createdAt: num(t.createdAt)
			})),
		routines: arr(backup.routines)
			.filter((r) => str(r.id) !== '')
			.map((r): Routine => ({
				id: str(r.id),
				name: str(r.name),
				unit: str(r.unit),
				threshold: num(r.threshold),
				order: num(r.order)
			})),
		routineLogs: arr(backup.routineLogs)
			.filter((l) => isValidKey(str(l.date)))
			.map((l): RoutineLog => ({
				date: str(l.date),
				values: Object.fromEntries(
					Object.entries(rec(l.values)).filter(
						(e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1])
					)
				)
			})),
		slots: arr(backup.slots)
			.filter((sl) => str(sl.id) !== '')
			.map((sl): ScheduleSlot => ({
				id: str(sl.id),
				title: str(sl.title),
				kind: eventKind(sl.kind, 'class'),
				weekday: Math.min(6, Math.max(0, Math.trunc(num(sl.weekday)))),
				start: str(sl.start),
				end: str(sl.end),
				room: str(sl.room),
				startsOn: dayOrNull(sl.startsOn),
				endsOn: dayOrNull(sl.endsOn)
			})),
		events: arr(backup.events)
			.filter((e) => str(e.id) !== '')
			.map((e): ScheduleEvent => ({
				id: str(e.id),
				slotId: strOrNull(e.slotId),
				date: dayOrNull(e.date),
				start: str(e.start),
				end: str(e.end),
				title: str(e.title),
				kind: eventKind(e.kind, 'other'),
				room: str(e.room),
				status: EVENT_STATUSES.includes(e.status as EventStatus)
					? (e.status as EventStatus)
					: 'planned',
				note: str(e.note)
			})),
		tasks: arr(backup.tasks)
			.filter((t) => str(t.id) !== '')
			.map((t): PlanTask => ({
				id: str(t.id),
				text: str(t.text),
				date: dayOrNull(t.date),
				until: dayOrNull(t.until),
				start: str(t.start),
				end: str(t.end),
				status: TASK_STATUSES.includes(t.status as TaskStatus) ? (t.status as TaskStatus) : 'open',
				note: str(t.note),
				highlight: t.highlight === true,
				createdAt: num(t.createdAt)
			})),
		deadlines: arr(backup.deadlines)
			.filter((d) => str(d.id) !== '')
			.map((d): Deadline => ({
				id: str(d.id),
				text: str(d.text),
				due: dayOrNull(d.due),
				label: str(d.label),
				hard: d.hard === true,
				done: d.done === true,
				note: str(d.note)
			})),
		weekNotes: arr(backup.weekNotes)
			.filter((w) => isValidKey(str(w.week)))
			.map((w): WeekNote => ({ week: str(w.week), text: str(w.text) }))
	};
}
