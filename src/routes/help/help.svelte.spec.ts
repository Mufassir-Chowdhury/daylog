import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { assistant } from '$lib/ai/assistant.svelte';
import { palette } from '$lib/palette.svelte';
import Help from './+page.svelte';

const go = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/help') } }));
vi.mock('$lib/nav', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/nav')>()),
	go
}));

beforeEach(() => {
	localStorage.clear();
	assistant.open = false;
	assistant.pending = '';
	palette.open = false;
	go.mockClear();
});

describe('Help', () => {
	it('walks through every section, with the assistant by name', async () => {
		const screen = render(Help);
		await expect
			.element(screen.getByRole('heading', { name: 'Help', level: 1 }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('heading', { name: 'Jarvis, the assistant' }))
			.toBeInTheDocument();
		await expect
			.element(screen.getByRole('heading', { name: 'Best practices' }))
			.toBeInTheDocument();
		await expect.element(screen.getByText('Getting started')).toBeInTheDocument();
	});

	it('filters by search and by section', async () => {
		const screen = render(Help);
		await screen.getByLabelText('Search the guide').fill('quick bar');
		await expect
			.element(screen.getByRole('heading', { name: 'The desktop app' }))
			.toBeInTheDocument();
		await expect.element(screen.getByRole('heading', { name: 'Finance' })).not.toBeInTheDocument();
		await screen.getByLabelText('Search the guide').fill('');
		await screen.getByRole('button', { name: 'Routines and money' }).click();
		await expect.element(screen.getByRole('heading', { name: 'Finance' })).toBeInTheDocument();
		await expect.element(screen.getByRole('heading', { name: 'Notes' })).not.toBeInTheDocument();
	});

	it('tries things: asks the assistant, opens the palette, goes to a page', async () => {
		const screen = render(Help);
		await screen.getByRole('button', { name: "Ask: “What's up today?”" }).first().click();
		expect(assistant.open).toBe(true);
		expect(assistant.pending).toBe("What's up today?");
		await screen.getByRole('button', { name: 'Jump to next Monday' }).click();
		expect(palette.open).toBe(true);
		expect(palette.query).toBe('next mon');
		await screen.getByRole('button', { name: 'Open Finance' }).click();
		expect(go).toHaveBeenCalledWith('/finance');
	});

	it('reads lines the way the day page does', async () => {
		const screen = render(Help);
		await expect
			.element(screen.getByText('on the schedule at 9:00 AM · reminder on the desktop'))
			.toBeInTheDocument();
		await expect
			.element(screen.getByText('Jarvis offers to record it in Finance'))
			.toBeInTheDocument();
		await expect
			.element(screen.getByText('Jarvis offers to add it as a deadline'))
			.toBeInTheDocument();
	});

	it('remembers the getting-started ticks in this browser', async () => {
		const screen = render(Help);
		await screen.getByLabelText('Download a backup').click();
		await expect.element(screen.getByText('1 of 7')).toBeInTheDocument();
		expect(JSON.parse(localStorage.getItem('daylog.help.checklist')!)).toEqual(['backup']);
	});
});
