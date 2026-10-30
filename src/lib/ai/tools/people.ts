import {
	daysMentioning,
	listPeople,
	listPersonTransactions,
	listTransactions,
	loadPerson
} from '../../db';
import { personBalances } from '../../finance';
import { linesMentioning } from '../../parse';
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

export const PEOPLE_TOOLS = [listPeopleTool, getPerson];
