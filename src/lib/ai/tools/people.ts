import {
	daysMentioning,
	listPeople,
	listPersonTransactions,
	listTransactions,
	loadPerson
} from '../../db';
import { personBalances } from '../../finance';
import { appendPersonNote, setPersonName } from '../../ops/records';
import { isValidHandle, linesMentioning } from '../../parse';
import { cached, compact, params, str, type Tool } from './registry';

const text = (segments: { text: string }[]) =>
	segments
		.map((s) => s.text)
		.join('')
		.trim();

export const listPeopleTool: Tool = {
	area: 'people',
	kind: 'read',
	def: {
		name: 'list_people',
		description:
			'Everyone with a profile: handle, name, and money balance (positive: they owe the user; negative: the user owes them).',
		parameters: params({})
	},
	describe: () => 'Looking through your people',
	async run(ctx) {
		const [people, txns] = await Promise.all([
			cached(ctx, 'people', () => listPeople(ctx.uid)),
			cached(ctx, 'txns', () => listTransactions(ctx.uid))
		]);
		const owed = personBalances(txns);
		return people.map((p) =>
			compact({ handle: p.handle, name: p.name, balance: owed.get(p.handle) })
		);
	}
};

export const getPerson: Tool = {
	area: 'people',
	kind: 'read',
	def: {
		name: 'get_person',
		description:
			"One person's profile: name, bio, money between you, recent lend/borrow records, and the latest day lines mentioning them.",
		parameters: params({ handle: str('Their handle, without the @.') })
	},
	describe: (i) => `Looking up @${String(i.handle).replace(/^@/, '')}`,
	async run(ctx, input) {
		const handle = String(input.handle).replace(/^@/, '');
		const [person, days, txns] = await Promise.all([
			loadPerson(ctx.uid, handle),
			daysMentioning(ctx.uid, handle),
			listPersonTransactions(ctx.uid, handle)
		]);
		if (!person.name && !person.bio && !days.length && !txns.length)
			throw new Error(`No one called @${handle}. Try list_people.`);
		const balance = personBalances(txns).get(handle) ?? 0;
		return compact({
			handle,
			name: person.name,
			bio: person.bio,
			balance,
			transactions: txns
				.slice(0, 10)
				.map((t) => compact({ date: t.date, kind: t.kind, amount: t.amount, note: t.note })),
			mentions: days
				.slice(0, 15)
				.flatMap(({ date, text: day }) =>
					linesMentioning(day, handle).map((l) => ({ date, line: text(l.segments) }))
				)
		});
	}
};

// ——— Changes.

async function person(uid: string, raw: unknown) {
	const handle = String(raw).replace(/^@/, '');
	if (!isValidHandle(handle)) throw new Error(`“${raw}” isn't a handle.`);
	const { name, bio } = await loadPerson(uid, handle);
	return { handle, ...(name ? { name } : {}), ...(bio ? { bio } : {}) };
}

export const appendPersonNoteTool: Tool = {
	area: 'people',
	kind: 'write',
	label: 'Add to people’s bios',
	def: {
		name: 'append_person_note',
		description: 'Add a line to a person’s bio — something learned about them.',
		parameters: params({ handle: str('Their handle, without the @.'), text: str('What to add.') })
	},
	describe: () => 'Updating a profile',
	async plan(ctx, input) {
		const p = await person(ctx.uid, input.handle);
		return {
			changes: appendPersonNote(p, String(input.text)),
			summary: `Add to @${p.handle}’s bio`
		};
	}
};

export const setPersonNameTool: Tool = {
	area: 'people',
	kind: 'write',
	label: 'Name people',
	def: {
		name: 'set_person_name',
		description: 'Set the full name shown on a person’s profile.',
		parameters: params({ handle: str('Their handle, without the @.'), name: str('Their name.') })
	},
	describe: () => 'Updating a profile',
	async plan(ctx, input) {
		const p = await person(ctx.uid, input.handle);
		const name = String(input.name).trim();
		return {
			changes: setPersonName(p, name),
			summary: `Name @${p.handle} “${name}”`
		};
	}
};

export const PEOPLE_TOOLS = [listPeopleTool, getPerson, appendPersonNoteTool, setPersonNameTool];
