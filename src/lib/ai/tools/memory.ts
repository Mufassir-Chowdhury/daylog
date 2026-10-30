import { listMemory, newMemoryId } from '../../db';
import { change } from '../../ops/change';
import { cleanMemoryText, searchMemory, type MemoryItem } from '../memory';
import { cached, enumOf, optStr, params, str, type Tool, type ToolContext } from './registry';

const memories = (ctx: ToolContext) => cached(ctx, 'memory', () => listMemory(ctx.uid));

async function find(ctx: ToolContext, id: unknown): Promise<MemoryItem> {
	const item = (await memories(ctx)).find((m) => m.id === id);
	if (!item) throw new Error('No memory with that id. Use recall to find it.');
	return item;
}

const short = (text: string) => (text.length > 60 ? `${text.slice(0, 59)}…` : text);

export const recall: Tool = {
	area: 'assistant',
	kind: 'read',
	def: {
		name: 'recall',
		description:
			'Search what you remember about the owner (newest first). Null query lists everything. Only needed when <memory> said there is more than it showed.',
		parameters: params({ query: optStr('Words to find, or null for everything.') })
	},
	describe: () => 'Checking what I remember',
	async run(ctx, input) {
		return searchMemory(await memories(ctx), String(input.query ?? ''))
			.slice(0, 50)
			.map(({ id, kind, text }) => ({ id, kind, text }));
	}
};

export const remember: Tool = {
	area: 'assistant',
	kind: 'write',
	small: true,
	label: 'Remember things about you',
	def: {
		name: 'remember',
		description:
			'Keep something for future conversations: a lasting preference or a useful fact. One short sentence each. To correct a memory, pass its id in replaces.',
		parameters: params({
			text: str('The memory, in one short sentence written about the owner ("Prefers…").'),
			kind: enumOf(['preference', 'fact'], 'preference = how the owner likes things done.'),
			replaces: optStr('Id of a memory this corrects, or null for a new one.')
		})
	},
	describe: () => 'Making a note to remember',
	async plan(ctx, input) {
		const text = cleanMemoryText(String(input.text));
		if (!text) throw new Error('text is empty.');
		const kind = input.kind === 'preference' ? 'preference' : 'fact';
		const updatedAt = Date.now();
		if (input.replaces) {
			const before = await find(ctx, input.replaces);
			if (before.text === text && before.kind === kind)
				return { changes: [], summary: `remembering “${short(text)}”` };
			return {
				changes: [change('memory', before, { ...before, text, kind, updatedAt })],
				summary: `Remember “${short(text)}” instead`
			};
		}
		const same = (await memories(ctx)).find((m) => m.text.toLowerCase() === text.toLowerCase());
		if (same) return { changes: [], summary: `remembering “${short(text)}”` };
		return {
			changes: [change('memory', null, { id: newMemoryId(ctx.uid), text, kind, updatedAt })],
			summary: `Remember “${short(text)}”`
		};
	}
};

export const forget: Tool = {
	area: 'assistant',
	kind: 'write',
	label: 'Forget things',
	def: {
		name: 'forget',
		description: 'Forget a memory that is wrong or no longer true.',
		parameters: params({ id: str('Memory id from <memory> or recall.') })
	},
	describe: () => 'Forgetting something',
	async plan(ctx, input) {
		const before = await find(ctx, input.id);
		return {
			changes: [change('memory', before, null)],
			summary: `Forget “${short(before.text)}”`
		};
	}
};

export const MEMORY_TOOLS = [recall, remember, forget];
