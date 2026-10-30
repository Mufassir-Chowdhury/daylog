/**
 * Changes in plain words, for the assistant's cards: "Status: planned → cancelled".
 */
import type { Change, Kind } from './change';

const NOUN: Record<Kind, string> = {
	slot: 'Timetable slot',
	event: 'Event',
	task: 'Task',
	deadline: 'Deadline',
	weekNote: 'Week note',
	transaction: 'Transaction',
	note: 'Note',
	longterm: 'Long-term task',
	person: 'Profile',
	routineValue: 'Routine',
	dayLine: 'Line'
};

/** Fields that only order or identify things. */
const HIDDEN = new Set(['id', 'createdAt', 'order', 'slotId', 'handle', 'routineId', 'week']);

const NAMES: Record<string, string> = {
	completedOn: 'finished',
	until: 'until',
	highlight: 'highlighted',
	fixed: 'recurring'
};

function show(value: unknown): string {
	if (value === null || value === undefined || value === '') return '—';
	if (typeof value === 'boolean') return value ? 'yes' : 'no';
	if (Array.isArray(value))
		return (
			value
				.map((v) => (typeof v === 'object' ? ((v as { text?: string }).text ?? '…') : v))
				.join(', ') || '—'
		);
	const text = String(value).replace(/\s+/g, ' ');
	return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

const label = (key: string) => {
	const name = NAMES[key] ?? key.replace(/([A-Z])/g, ' $1').toLowerCase();
	return name[0].toUpperCase() + name.slice(1);
};

/** What the change does, as one or a few short lines. */
export function describeChange(c: Change): string[] {
	if (c.kind === 'dayLine') {
		const when = c.id;
		if (!c.before) return [`Add to ${when}: ${show(c.after!.line)}`];
		if (!c.after) return [`Remove from ${when}: ${show(c.before.line)}`];
		return [`On ${when}: ${show(c.before.line)} → ${show(c.after.line)}`];
	}
	const noun = NOUN[c.kind];
	const doc = (c.after ?? c.before) as unknown as Record<string, unknown>;
	const name = show(doc.title ?? doc.text ?? doc.name ?? doc.category ?? '');
	if (!c.after) return [`Remove ${noun.toLowerCase()} ${name}`];
	if (!c.before) {
		const facts = Object.entries(c.after as unknown as Record<string, unknown>)
			.filter(
				([k, v]) =>
					!HIDDEN.has(k) && v !== '' && v !== null && v !== false && k !== 'title' && k !== 'text'
			)
			.map(([k, v]) => `${label(k)}: ${show(v)}`);
		return [`New ${noun.toLowerCase()} ${name}`, ...facts];
	}
	const before = c.before as unknown as Record<string, unknown>;
	const after = c.after as unknown as Record<string, unknown>;
	const diffs = Object.keys({ ...before, ...after })
		.filter((k) => !HIDDEN.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
		.map((k) => `${label(k)}: ${show(before[k])} → ${show(after[k])}`);
	return [`${noun} ${name}`, ...diffs];
}
