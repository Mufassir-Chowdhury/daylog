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
