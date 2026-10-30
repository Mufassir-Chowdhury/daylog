/**
 * What the assistant remembers between conversations: your lasting preferences
 * and facts worth keeping (a course's room, who someone is). Stored per account
 * (`assistantMemory`), editable in Settings, and handed to the model at the
 * start of each conversation.
 */

export type MemoryKind = 'preference' | 'fact';

export interface MemoryItem {
	id: string;
	text: string;
	kind: MemoryKind;
	/** Milliseconds since the epoch. */
	updatedAt: number;
}

/** Longest single memory, in characters. */
export const MEMORY_MAX_TEXT = 300;
/** How much memory goes in front of a conversation; the rest is found with `recall`. */
const MEMORY_BUDGET = 4000;

export function cleanMemoryText(text: string): string {
	return text.replace(/\s+/g, ' ').trim().slice(0, MEMORY_MAX_TEXT);
}

/** Newest first. */
export function sortMemory(items: MemoryItem[]): MemoryItem[] {
	return items.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The `<memory>` block for the first message of a conversation: preferences
 * first, then facts, newest first, until the budget runs out.
 */
export function memoryBlock(items: MemoryItem[]): string {
	if (!items.length) return '<memory>\n(nothing yet)\n</memory>';
	const ordered = [
		...sortMemory(items.filter((m) => m.kind === 'preference')),
		...sortMemory(items.filter((m) => m.kind !== 'preference'))
	];
	const lines: string[] = [];
	let used = 0;
	for (const m of ordered) {
		const line = `- [${m.id}] (${m.kind}) ${m.text}`;
		if (used + line.length > MEMORY_BUDGET) break;
		lines.push(line);
		used += line.length + 1;
	}
	const more = ordered.length - lines.length;
	if (more) lines.push(`(${more} more — use recall to search them)`);
	return `<memory>\n${lines.join('\n')}\n</memory>`;
}

/** Memories with every word of `query`, newest first. */
export function searchMemory(items: MemoryItem[], query: string): MemoryItem[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	return sortMemory(items).filter((m) => {
		const text = m.text.toLowerCase();
		return words.every((w) => text.includes(w));
	});
}
