import { resolve } from '$app/paths';
import { dayHref } from '../../nav';
import { dayKey, optStr, params, str, type Tool } from './registry';

const PAGES: Record<string, () => string> = {
	schedule: () => resolve('/schedule'),
	people: () => resolve('/people'),
	notes: () => resolve('/notes'),
	routines: () => resolve('/routines'),
	finance: () => resolve('/finance'),
	activity: () => resolve('/activity'),
	settings: () => resolve('/settings')
};

export const openPage: Tool = {
	area: 'ui',
	kind: 'ui',
	def: {
		name: 'open_page',
		description:
			'Open a page of the app for the user. "day" needs a date; "person" needs a handle; "note" needs a note id.',
		parameters: params({
			page: { ...str('Which page.'), enum: ['day', ...Object.keys(PAGES), 'person', 'note'] },
			target: optStr('Date (YYYY-MM-DD) for day, handle for person, id for note; else null.')
		})
	},
	describe: (i) => `Opening ${i.page}`,
	async run(ctx, input) {
		const page = String(input.page);
		const target = input.target ? String(input.target) : '';
		let path: string;
		if (page === 'day') path = dayHref(target ? dayKey(target, 'target') : ctx.today);
		else if (page === 'person') {
			if (!target) throw new Error('target should be the handle.');
			path = resolve('/people/[handle]', { handle: target.replace(/^@/, '') });
		} else if (page === 'note') {
			if (!target) throw new Error('target should be the note id.');
			path = resolve('/notes/[id]', { id: target });
		} else path = PAGES[page]();
		ctx.navigate(path);
		return `Opened ${page}${target ? ` ${target}` : ''}.`;
	}
};

export const UI_TOOLS = [openPage];
