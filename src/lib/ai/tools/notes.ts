import { listNotes, loadNote, newNoteId } from '../../db';
import { appendToNote, createNote } from '../../ops/records';
import { cached, optStr, params, str, strList, type Tool } from './registry';

/** About 160 characters around the first hit. */
function snippet(content: string, word: string): string {
	const i = word ? content.toLowerCase().indexOf(word) : -1;
	const start = Math.max(0, i - 60);
	const out = content
		.slice(start, start + 160)
		.replace(/\s+/g, ' ')
		.trim();
	return (start > 0 ? '…' : '') + out + (start + 160 < content.length ? '…' : '');
}

export const searchNotes: Tool = {
	area: 'notes',
	kind: 'read',
	def: {
		name: 'search_notes',
		description:
			'Find notes by words in the title, text or tags (most recently edited first). Null query lists the latest notes.',
		parameters: params({ query: optStr('Words to find, or null for the latest notes.') })
	},
	describe: (i) => (i.query ? `Searching notes for “${i.query}”` : 'Looking through your notes'),
	async run(ctx, input) {
		const words = String(input.query ?? '')
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean);
		const notes = await cached(ctx, 'notes', () => listNotes(ctx.uid));
		return notes
			.filter((n) => {
				const hay = `${n.title} ${n.content} ${n.tags.join(' ')}`.toLowerCase();
				return words.every((w) => hay.includes(w));
			})
			.slice(0, 20)
			.map((n) => ({
				id: n.id,
				title: n.title || 'Untitled',
				...(n.tags.length ? { tags: n.tags } : {}),
				snippet: snippet(n.content, words[0] ?? '')
			}));
	}
};

export const readNote: Tool = {
	area: 'notes',
	kind: 'read',
	def: {
		name: 'read_note',
		description: 'The full text of one note.',
		parameters: params({ id: str('Note id from search_notes.') })
	},
	describe: () => 'Reading a note',
	async run(ctx, input) {
		const note = await loadNote(ctx.uid, String(input.id));
		if (!note.title && !note.content) throw new Error('No note with that id.');
		return note;
	}
};

// ——— Changes.

export const createNoteTool: Tool = {
	area: 'notes',
	kind: 'write',
	small: true,
	label: 'Create notes',
	def: {
		name: 'create_note',
		description: 'Create a new note.',
		parameters: params({
			title: str('Title.'),
			content: str('Text of the note (may be empty).'),
			tags: strList('Tags without #, often empty.')
		})
	},
	describe: () => 'Creating a note',
	async plan(ctx, input) {
		const title = String(input.title).trim();
		const tags = [
			...new Set((input.tags as string[]).map((t) => t.replace(/^#/, '').trim()))
		].filter(Boolean);
		return {
			changes: createNote({ id: newNoteId(ctx.uid), title, content: String(input.content), tags }),
			summary: `Create the note “${title || 'Untitled'}”`
		};
	}
};

export const appendToNoteTool: Tool = {
	area: 'notes',
	kind: 'write',
	small: true,
	label: 'Add to notes',
	def: {
		name: 'append_to_note',
		description: 'Add text at the end of an existing note.',
		parameters: params({ id: str('Note id from search_notes.'), text: str('Text to add.') })
	},
	describe: () => 'Adding to a note',
	async plan(ctx, input) {
		const note = await loadNote(ctx.uid, String(input.id));
		if (!note.title && !note.content) throw new Error('No note with that id.');
		return {
			changes: appendToNote(note, String(input.text)),
			summary: `Add to the note “${note.title || 'Untitled'}”`
		};
	}
};

export const NOTE_TOOLS = [searchNotes, readNote, createNoteTool, appendToNoteTool];
