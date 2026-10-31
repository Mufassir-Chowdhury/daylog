/**
 * Capture → structure: lines you type that look like something the app keeps
 * elsewhere — money, a deadline or exam date, a cancelled or moved class —
 * are offered as cards ("add as deadline", "record the lend"). The line stays
 * as written. This file is the cheap local part: which lines are worth asking
 * the model about. Everything here is pure.
 */
import { parseDay } from '../parse';

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*';
const WEEKDAY = '(?:sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day)?';

const PATTERNS: { kind: CaptureKind; re: RegExp }[] = [
	{
		kind: 'money',
		re: /\b(?:spent|spend|paid|pay|gave|lent|lend|borrowed|borrow|owe|owes|received|got|earned|salary|bought|cost|tk|taka|bdt)\b.*\d|[৳$€£]\s?\d|\d\s?(?:tk|taka|bdt)\b/i
	},
	{
		kind: 'cancel',
		re: /\b(?:cancel(?:l)?ed|postponed|called off|no class(?:es)?|shifted|rescheduled|moved to)\b/i
	},
	{
		kind: 'deadline',
		re: /\b(?:deadline|due|exam|quiz|midterm|final|submit|submission|presentation|viva|assignment)\b/i
	}
];

const DATE = new RegExp(
	`\\b(?:${MONTH}\\s+\\d{1,2}|\\d{1,2}\\s+${MONTH}|\\d{1,2}[/.-]\\d{1,2}(?:[/.-]\\d{2,4})?|${WEEKDAY}|tomorrow|next week)\\b`,
	'i'
);

export type CaptureKind = 'money' | 'cancel' | 'deadline';

export interface Candidate {
	/** The line as written. */
	line: string;
	kind: CaptureKind;
}

/**
 * The open (not crossed out) lines of a day's text worth a look. A deadline
 * word needs a date with it ("exam on nov 12"); money and cancellations stand
 * on their own.
 */
export function captureCandidates(text: string): Candidate[] {
	const { timed, notes } = parseDay(text);
	const out: Candidate[] = [];
	for (const l of [...timed, ...notes]) {
		if (l.done) continue;
		const line = l.raw.trim();
		const hit = PATTERNS.find((p) => p.re.test(line) && (p.kind !== 'deadline' || DATE.test(line)));
		if (hit) out.push({ line, kind: hit.kind });
	}
	return out;
}

/** Lines in `text` that weren't in `before` (by exact text). */
export function newLines(before: string, text: string): string {
	const old = new Set(before.split('\n').map((l) => l.trim()));
	return text
		.split('\n')
		.filter((l) => l.trim() && !old.has(l.trim()))
		.join('\n');
}

/** A short stable hash of a line, for its signal key. */
export function lineHash(line: string): string {
	let h = 5381;
	for (let i = 0; i < line.length; i++) h = ((h << 5) + h + line.charCodeAt(i)) | 0;
	return (h >>> 0).toString(36);
}

/** The signal key for a captured line on `date`; cards made from it carry it. */
export const captureKey = (date: string, line: string) => `capture:${date}:${lineHash(line)}`;
