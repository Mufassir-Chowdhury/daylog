/**
 * Pre-event prep: shortly before a meeting, exam or invigilation — or a class
 * with open tasks about it, or anything with an @person — gather what's
 * related (open tasks, notes, and a brief on each person). Checked every
 * minute (engine.ts), since timing matters; pure.
 */
import type { PlanTask, ScheduleEvent } from '../../db';
import { extractMentions, parseDay } from '../../parse';
import { formatTimeRange, minutes } from '../../schedule';
import { lineHash } from '../capture';
import type { FactSource } from '../facts';
import { topicWords, type Signal } from './index';

/** Prep is made this many minutes before the start, give or take. */
export const PREP_FROM = 20;
export const PREP_TO = 40;

export interface PrepData {
	today: string;
	/** Minutes since midnight. */
	now: number;
	/** Today's classes and events (timetable rows included). */
	events: ScheduleEvent[];
	tasks: PlanTask[];
	/** Today's page, for timed lines like "15:00 meet @rahim". */
	dayText: string;
}

const ALWAYS = new Set(['exam', 'invigilation', 'meeting']);
const MEETING_WORDS = /\b(?:meet|meeting|interview|viva|discuss|discussion|call with|session)\b/i;

const inWindow = (start: number, now: number) => start - now >= PREP_FROM && start - now <= PREP_TO;

function facts(today: string, title: string, handles: string[]): FactSource[] {
	const words = topicWords(title.replace(/@\S+/g, ''));
	// The most telling word: the longest.
	const topic = words.sort((a, b) => b.length - a.length)[0];
	return [
		{
			label: "Today's schedule and tasks",
			tool: 'schedule_snapshot',
			input: { from: today, to: today }
		},
		...(topic
			? [{ label: `Notes about “${topic}”`, tool: 'search_notes', input: { query: topic } }]
			: []),
		...handles.map((h) => ({ label: `About @${h}`, tool: 'get_person', input: { handle: h } }))
	];
}

function about(what: string, when: string, related: string[], handles: string[]): string {
	return [
		`${what} starts at ${when}.`,
		...(related.length ? [`Open tasks that look related: ${related.join('; ')}.`] : []),
		...(handles.length ? [`It involves ${handles.map((h) => `@${h}`).join(', ')}.`] : []),
		'Write a short prep note: what it is and where, the related open tasks and notes worth a look before it, and for each person a two-line brief (who they are, the latest mention, money between you if any).',
		`If nothing useful comes up beyond the time and room, answer NOTHING.`
	].join(' ');
}

export function upcomingPrep({ today, now, events, tasks, dayText }: PrepData): Signal[] {
	const open = tasks.filter((t) => t.status === 'open');
	const relatedTo = (title: string) => {
		const words = topicWords(title);
		return open.filter((t) => topicWords(t.text).some((w) => words.includes(w))).map((t) => t.text);
	};
	const out: Signal[] = [];

	for (const e of events) {
		if (e.date !== today || e.status !== 'planned' || !/^\d{1,2}:\d{2}$/.test(e.start)) continue;
		if (!inWindow(minutes(e.start), now)) continue;
		const handles = extractMentions(`${e.title} ${e.note}`);
		const related = relatedTo(e.title);
		if (!ALWAYS.has(e.kind) && !handles.length && !related.length) continue;
		const when = `${formatTimeRange(e.start, e.end)}${e.room ? ` in ${e.room}` : ''}`;
		out.push({
			key: `prep:${today}:${e.id}`,
			type: 'prep',
			title: `Before ${e.title}`,
			about: about(`The ${e.kind} “${e.title}”`, when, related, handles),
			priority: 2,
			facts: facts(today, e.title, handles)
		});
	}

	for (const line of parseDay(dayText).timed) {
		if (line.done || line.time === null || !inWindow(line.time, now)) continue;
		const handles = extractMentions(line.raw);
		if (!handles.length || !MEETING_WORDS.test(line.raw)) continue;
		const text = line.raw.trim();
		out.push({
			key: `prep:${today}:line-${lineHash(text)}`,
			type: 'prep',
			title: `Before “${text}”`,
			about: about(`“${text}” on today's page`, line.timeLabel ?? '', relatedTo(text), handles),
			priority: 2,
			facts: facts(today, text, handles)
		});
	}
	return out;
}
