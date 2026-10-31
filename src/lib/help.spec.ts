import { describe, expect, it } from 'vitest';
import { CHECKLIST, codeParts, named, searchTopics, SECTIONS, TOPICS } from './help';

const ROUTES = [
	'/day',
	'/schedule',
	'/people',
	'/notes',
	'/routines',
	'/finance',
	'/activity',
	'/settings'
];

describe('the guide', () => {
	it('puts every topic in a known section, with unique ids', () => {
		const sections = new Set(SECTIONS.map((s) => s.id));
		expect(TOPICS.every((t) => sections.has(t.section))).toBe(true);
		expect(new Set(TOPICS.map((t) => t.id)).size).toBe(TOPICS.length);
		// Every section has something in it.
		for (const s of SECTIONS) expect(TOPICS.some((t) => t.section === s.id)).toBe(true);
	});

	it('only links to pages that exist', () => {
		const paths = [
			...TOPICS.flatMap((t) => t.tries ?? [])
				.filter((a) => a.kind === 'go')
				.map((a) => a.value),
			...CHECKLIST.flatMap((c) => (c.href ? [c.href] : []))
		];
		for (const path of paths) expect(ROUTES).toContain(path);
	});

	it('searches every word across titles, points, keywords and sections', () => {
		expect(searchTopics(TOPICS, 'undo card').map((t) => t.id)).toContain('ai-change');
		expect(searchTopics(TOPICS, 'quick bar').map((t) => t.id)).toContain('desktop');
		expect(searchTopics(TOPICS, 'lakh').map((t) => t.id)).toEqual(['start-checklist']);
		expect(searchTopics(TOPICS, 'zzz nothing')).toEqual([]);
		expect(searchTopics(TOPICS, '  ')).toBe(TOPICS);
		// The assistant's name is searchable as it's shown.
		expect(searchTopics(TOPICS, 'friday', 'Friday').length).toBeGreaterThan(0);
	});

	it('fills in the name and splits out code', () => {
		expect(named('Ask {name}', 'Friday')).toBe('Ask Friday');
		expect(codeParts('Press `Ctrl K` now')).toEqual([
			{ code: false, text: 'Press ' },
			{ code: true, text: 'Ctrl K' },
			{ code: false, text: ' now' }
		]);
	});
});
