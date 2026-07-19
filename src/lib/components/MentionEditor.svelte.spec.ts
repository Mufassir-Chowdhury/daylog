import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import MentionEditor from './MentionEditor.svelte';

const people = [{ handle: 'mom' }, { handle: 'rahim', name: 'Rahim Khan' }];

describe('MentionEditor', () => {
	it('shows all people when @ is typed, then narrows', async () => {
		const screen = render(MentionEditor, { props: { value: '', people } });
		await userEvent.keyboard('@');
		await expect.element(screen.getByRole('listbox')).toBeVisible();
		expect(screen.getByRole('option').elements()).toHaveLength(2);

		await userEvent.keyboard('ra');
		expect(screen.getByRole('option').elements()).toHaveLength(1);
		await expect.element(screen.getByRole('option')).toHaveTextContent('@rahim');
	});

	it('enter inserts the top suggestion', async () => {
		const screen = render(MentionEditor, { props: { value: '', people } });
		await userEvent.keyboard('@ra{Enter}');
		await expect.element(screen.getByRole('textbox')).toHaveValue('@rahim ');
	});

	it('arrow keys move the selection before enter', async () => {
		const screen = render(MentionEditor, { props: { value: '', people } });
		await userEvent.keyboard('@{ArrowDown}{Enter}');
		await expect.element(screen.getByRole('textbox')).toHaveValue('@rahim ');
	});

	it('space commits a typed name as a new person', async () => {
		const onnewperson = vi.fn();
		const screen = render(MentionEditor, { props: { value: '', people, onnewperson } });
		await userEvent.keyboard('@bob ');
		expect(onnewperson).toHaveBeenCalledWith('bob');
		await expect.element(screen.getByRole('textbox')).toHaveValue('@bob ');
	});

	it('enter with no matching suggestion commits a new person', async () => {
		const onnewperson = vi.fn();
		render(MentionEditor, { props: { value: '', people, onnewperson } });
		await userEvent.keyboard('@zoe{Enter}');
		expect(onnewperson).toHaveBeenCalledWith('zoe');
	});

	it('does not create a person for an existing handle', async () => {
		const onnewperson = vi.fn();
		const screen = render(MentionEditor, { props: { value: '', people, onnewperson } });
		await userEvent.keyboard('@mom{Escape} ');
		expect(onnewperson).not.toHaveBeenCalled();
		await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument();
	});

	it('escape dismisses the suggestion dropdown', async () => {
		const screen = render(MentionEditor, { props: { value: '', people } });
		await userEvent.keyboard('@');
		await expect.element(screen.getByRole('listbox')).toBeVisible();
		await userEvent.keyboard('{Escape}');
		await expect.element(screen.getByRole('listbox')).not.toBeInTheDocument();
	});
});
