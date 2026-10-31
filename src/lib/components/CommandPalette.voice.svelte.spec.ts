import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import CommandPalette from './CommandPalette.svelte';

// The quick bar's mic, with voice on (an ElevenLabs key saved).

const said = vi.hoisted(() => ({ text: 'spent 250 on lunch' as string | null }));
const voiceApi = vi.hoisted(() => ({
	listen: vi.fn(async () => said.text),
	stopListening: vi.fn(),
	cancelListening: vi.fn()
}));
vi.mock('$lib/ai/voice.svelte', async () => {
	const { voice } = await import('./voice-state.test-helper.svelte');
	return { voice, ...voiceApi };
});
vi.mock('$lib/db', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/db')>()),
	listPeople: vi.fn(async () => []),
	listNotes: vi.fn(async () => [])
}));

const props = () => ({
	uid: 'u1',
	quick: true,
	voiceInput: true,
	navigate: vi.fn(),
	capture: vi.fn(),
	ask: vi.fn(),
	assistantName: 'Jarvis',
	close: vi.fn()
});

beforeEach(() => {
	said.text = 'spent 250 on lunch';
	voiceApi.listen.mockClear();
});

describe('the quick bar mic', () => {
	it('puts what you said in the box, ready to add to today', async () => {
		const p = props();
		const screen = render(CommandPalette, p);
		await screen.getByRole('button', { name: 'Say it instead of typing' }).click();
		await expect.element(screen.getByLabelText('Command')).toHaveValue('spent 250 on lunch');
		await expect
			.element(screen.getByRole('option', { name: /^spent 250 on lunch Add to/ }))
			.toBeInTheDocument();
		expect(p.ask).not.toHaveBeenCalled();
	});

	it('asks the assistant out loud when you typed ? first', async () => {
		said.text = "what's up today";
		const p = props();
		const screen = render(CommandPalette, p);
		await screen.getByLabelText('Command').fill('?');
		await screen.getByRole('button', { name: 'Ask Jarvis out loud' }).click();
		await vi.waitFor(() => expect(p.ask).toHaveBeenCalledWith("what's up today", true));
	});

	it('hides the mic when voice input is not offered', async () => {
		const screen = render(CommandPalette, { ...props(), voiceInput: false });
		await expect.element(screen.getByLabelText('Command')).toBeInTheDocument();
		expect(screen.container.querySelector('[aria-label="Say it instead of typing"]')).toBeNull();
	});
});
