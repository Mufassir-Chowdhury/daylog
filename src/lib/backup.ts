import { isValidKey } from './date';
import type {
	Account,
	LongTermTask,
	Note,
	Person,
	Subtask,
	Transaction,
	TransactionKind,
	UserData
} from './db';
import type { AppSettings } from './settings.svelte';

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
		`${data.transactions.length} transactions`
	].join(', ');
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const rec = (v: unknown): Record<string, unknown> =>
	typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);

const KINDS: TransactionKind[] = ['income', 'expense', 'transfer', 'lend', 'borrow'];

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
	if (typeof s.currency === 'string') settings.currency = s.currency;
	if (s.grouping === 'lakh' || s.grouping === 'thousand') settings.grouping = s.grouping;
	for (const key of ['showNotePanel', 'showLongTermPanel', 'showFinancePanel'] as const)
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
				createdAt: num(t.createdAt)
			}))
	};
}
