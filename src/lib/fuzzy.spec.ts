import { describe, expect, it } from 'vitest';
import { fuzzyScore } from './fuzzy';

describe('fuzzyScore', () => {
	it('requires every character in order', () => {
		expect(fuzzyScore('fnc', 'Finance')).not.toBeNull();
		expect(fuzzyScore('cnf', 'Finance')).toBeNull();
	});

	it('matches everything on an empty query', () => {
		expect(fuzzyScore('', 'Anything')).toBe(0);
	});

	it('prefers prefixes and word starts', () => {
		const rank = (q: string, items: string[]) =>
			[...items].sort((a, b) => (fuzzyScore(q, b) ?? -1e9) - (fuzzyScore(q, a) ?? -1e9));
		expect(rank('fin', ['Daily routine info', 'Finance'])[0]).toBe('Finance');
		expect(rank('ns', ['Notes', 'New schedule slot', 'Settings'])[0]).toBe('New schedule slot');
	});
});
