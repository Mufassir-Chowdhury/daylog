/**
 * Parsing for day text. The stored text stays exactly as typed — parsing only
 * affects how a day is rendered (timed tasks grouped at top, @mentions linked).
 */

/** `@handle` — word chars, with internal `.` or `-` separators (trailing punctuation is not captured). */
const MENTION_RE = /@([A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*)/g;

/** A time at the start of a line, e.g. `09:00PM`, `9:00 pm`, `21:00`. Optional `-`/`*` bullet before it. */
const TIME_RE =
	/^\s*(?:[-*]\s+)?(\d{1,2}):(\d{2})\s*([ap])\.?m\.?(?=\s|$)|^\s*(?:[-*]\s+)?(\d{1,2}):(\d{2})(?=\s|$)/i;

export type Segment =
	{ kind: 'text'; text: string } | { kind: 'mention'; handle: string; text: string };

export interface Line {
	raw: string;
	/** Minutes since midnight, or null for untimed lines. */
	time: number | null;
	/** e.g. "9:00 PM" for timed lines. */
	timeLabel: string | null;
	/** Line content split into text and mention segments (time prefix removed for timed lines). */
	segments: Segment[];
}

export interface ParsedDay {
	/** Timed lines, sorted by time ascending. */
	timed: Line[];
	/** Everything else, in original order (blank lines dropped). */
	notes: Line[];
}

export function parseTime(line: string): { minutes: number; rest: string } | null {
	const m = TIME_RE.exec(line);
	if (!m) return null;
	let hours: number;
	let mins: number;
	if (m[1] !== undefined) {
		hours = Number(m[1]);
		mins = Number(m[2]);
		if (hours < 1 || hours > 12 || mins > 59) return null;
		hours %= 12;
		if (m[3].toLowerCase() === 'p') hours += 12;
	} else {
		hours = Number(m[4]);
		mins = Number(m[5]);
		if (hours > 23 || mins > 59) return null;
	}
	return { minutes: hours * 60 + mins, rest: line.slice(m[0].length).trim() };
}

export function timeLabel(minutes: number): string {
	const h24 = Math.floor(minutes / 60);
	const m = String(minutes % 60).padStart(2, '0');
	const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
	return `${h12}:${m} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export function segments(text: string): Segment[] {
	const out: Segment[] = [];
	let last = 0;
	MENTION_RE.lastIndex = 0;
	for (let m = MENTION_RE.exec(text); m !== null; m = MENTION_RE.exec(text)) {
		if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
		out.push({ kind: 'mention', handle: m[1].toLowerCase(), text: m[0] });
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
	return out;
}

export type HighlightSegment = Segment | { kind: 'time'; text: string };

/**
 * Segments a raw line for inline highlighting in the editor. Unlike parseDay,
 * every character of the line is preserved (including the time prefix and its
 * whitespace) so the highlighted backdrop aligns exactly with the textarea.
 */
export function highlightLine(line: string): HighlightSegment[] {
	const m = TIME_RE.exec(line);
	if (!m) return segments(line);
	return [{ kind: 'time', text: m[0] }, ...segments(line.slice(m[0].length))];
}

/** True if `handle` is exactly what MENTION_RE would capture after an `@`. */
export function isValidHandle(handle: string): boolean {
	return /^[A-Za-z0-9_]+(?:[.-][A-Za-z0-9_]+)*$/.test(handle);
}

/** Replaces every `@handle` mention of the given handle with the bare text (no `@`). */
export function stripMention(text: string, handle: string): string {
	return text.replace(MENTION_RE, (m, h: string) => (h.toLowerCase() === handle ? m.slice(1) : m));
}

export function parseDay(text: string): ParsedDay {
	const timed: Line[] = [];
	const notes: Line[] = [];
	for (const raw of text.split('\n')) {
		if (raw.trim() === '') continue;
		const t = parseTime(raw);
		if (t) {
			timed.push({
				raw,
				time: t.minutes,
				timeLabel: timeLabel(t.minutes),
				segments: segments(t.rest)
			});
		} else {
			notes.push({ raw, time: null, timeLabel: null, segments: segments(raw) });
		}
	}
	timed.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
	return { timed, notes };
}

/** Unique lowercase handles mentioned anywhere in the text. */
export function extractMentions(text: string): string[] {
	const handles = new Set<string>();
	MENTION_RE.lastIndex = 0;
	for (let m = MENTION_RE.exec(text); m !== null; m = MENTION_RE.exec(text)) {
		handles.add(m[1].toLowerCase());
	}
	return [...handles];
}

/** Lines of a day that mention the given handle (used on profile pages). */
export function linesMentioning(text: string, handle: string): Line[] {
	const { timed, notes } = parseDay(text);
	return [...timed, ...notes].filter((line) =>
		line.segments.some((s) => s.kind === 'mention' && s.handle === handle)
	);
}
