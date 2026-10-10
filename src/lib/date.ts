/** Date keys are local-time `YYYY-MM-DD` strings — they are also the Firestore doc ids for days. */

export function dateKey(date: Date = new Date()): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

export function isValidKey(key: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
	const date = fromKey(key);
	return dateKey(date) === key;
}

export function fromKey(key: string): Date {
	const [y, m, d] = key.split('-').map(Number);
	return new Date(y, m - 1, d);
}

export function addDays(key: string, days: number): string {
	const date = fromKey(key);
	date.setDate(date.getDate() + days);
	return dateKey(date);
}

const HUMAN = new Intl.DateTimeFormat('en-US', {
	weekday: 'long',
	year: 'numeric',
	month: 'long',
	day: 'numeric'
});

export function humanDate(key: string): string {
	return HUMAN.format(fromKey(key));
}

/** "Today" / "Tomorrow" / "Yesterday" / "" for other days. */
export function relativeLabel(key: string): string {
	const today = dateKey();
	if (key === today) return 'Today';
	if (key === addDays(today, 1)) return 'Tomorrow';
	if (key === addDays(today, -1)) return 'Yesterday';
	return '';
}

/** Month key (`YYYY-MM`) of a day key. */
export function monthOf(key: string): string {
	return key.slice(0, 7);
}

export function daysInMonth(month: string): number {
	const [y, m] = month.split('-').map(Number);
	return new Date(y, m, 0).getDate();
}

/** Moves a month key by `delta` months, e.g. `shiftMonth('2026-01', -1)` → `'2025-12'`. */
export function shiftMonth(month: string, delta: number): string {
	const [y, m] = month.split('-').map(Number);
	const d = new Date(y, m - 1 + delta, 1);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `count` consecutive month keys ending at `last`, oldest first. */
export function monthsEnding(last: string, count: number): string[] {
	return Array.from({ length: count }, (_, i) => shiftMonth(last, i - count + 1));
}

/** Index of the name `word` abbreviates (at least 3 letters: `thu`, `sept`), or -1. */
function nameIndex(word: string, names: string[]): number {
	return word.length < 3 ? -1 : names.findIndex((n) => n.startsWith(word));
}

const WEEKDAYS_FULL = [
	'sunday',
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday'
];
const MONTHS_FULL = [
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december'
];

/**
 * Reads a loosely typed date relative to `today`: `today`, `tmr`, `yesterday`,
 * weekday names (`fri` = the coming Friday, today if it is Friday; `next fri`
 * a week later; `last fri` the one before today), `+3` / `-2` days, `oct 12`,
 * `12 oct 2027`, or an ISO key. Returns a day key, or null if it isn't a date.
 */
export function parseDateWord(input: string, today: string = dateKey()): string | null {
	const text = input.trim().toLowerCase().replace(/\s+/g, ' ');
	if (!text) return null;
	if (isValidKey(text)) return text;
	if (/^(today|tod|now)$/.test(text)) return today;
	if (/^(tomorrow|tmr|tmrw|tom)$/.test(text)) return addDays(today, 1);
	if (/^(yesterday|yday|yest)$/.test(text)) return addDays(today, -1);
	const offset = /^([+-])\s*(\d{1,3})\s*d?$/.exec(text);
	if (offset) return addDays(today, Number(offset[2]) * (offset[1] === '-' ? -1 : 1));

	const weekday = /^(next |last |this )?([a-z]+)$/.exec(text);
	if (weekday) {
		const wd = nameIndex(weekday[2], WEEKDAYS_FULL);
		if (wd !== -1) {
			const current = fromKey(today).getDay();
			if (weekday[1] === 'last ') return addDays(today, -(((current - wd + 6) % 7) + 1));
			const ahead = (wd - current + 7) % 7;
			return addDays(today, ahead + (weekday[1] === 'next ' ? 7 : 0));
		}
	}

	const monthDay =
		/^([a-z]+) (\d{1,2})(?:,? (\d{4}))?$/.exec(text) ??
		/^(\d{1,2}) ([a-z]+)(?:,? (\d{4}))?$/.exec(text);
	if (monthDay) {
		const [, a, b, year] = monthDay;
		const [word, day] = /^\d/.test(a) ? [b, a] : [a, b];
		const month = nameIndex(word, MONTHS_FULL);
		if (month === -1) return null;
		const y = year ?? today.slice(0, 4);
		const key = `${y}-${String(month + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
		return isValidKey(key) ? key : null;
	}
	return null;
}
