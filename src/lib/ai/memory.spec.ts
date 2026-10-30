import { describe, expect, it } from 'vitest';
import { cleanMemoryText, memoryBlock, searchMemory, type MemoryItem } from './memory';

const item = (id: string, text: string, kind: MemoryItem['kind'], updatedAt: number) => ({
	id,
	text,
	kind,
	updatedAt
});

describe('memory', () => {
	it('lists preferences first, then facts, newest first', () => {
		const block = memoryBlock([
			item('a', 'Old fact', 'fact', 1),
			item('b', 'New fact', 'fact', 3),
			item('c', 'Likes short briefs', 'preference', 2)
		]);
		expect(block).toBe(
			'<memory>\n- [c] (preference) Likes short briefs\n- [b] (fact) New fact\n- [a] (fact) Old fact\n</memory>'
		);
	});

	it('says when there is nothing, and points to recall past the budget', () => {
		expect(memoryBlock([])).toContain('(nothing yet)');
		const many = Array.from({ length: 40 }, (_, i) => item(`m${i}`, 'x'.repeat(200), 'fact', i));
		const block = memoryBlock(many);
		expect(block.length).toBeLessThan(4300);
		expect(block).toMatch(/\(\d+ more — use recall to search them\)/);
	});

	it('cleans and caps text', () => {
		expect(cleanMemoryText('  two\n lines  ')).toBe('two lines');
		expect(cleanMemoryText('y'.repeat(400))).toHaveLength(300);
	});

	it('searches every word', () => {
		const items = [item('a', 'DM in room 304', 'fact', 1), item('b', 'OS in room 210', 'fact', 2)];
		expect(searchMemory(items, 'room').map((m) => m.id)).toEqual(['b', 'a']);
		expect(searchMemory(items, 'dm 304').map((m) => m.id)).toEqual(['a']);
	});
});
