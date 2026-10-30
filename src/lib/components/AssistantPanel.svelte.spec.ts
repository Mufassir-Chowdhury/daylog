import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { assistant, newConversation } from '$lib/ai/assistant.svelte';
import { DEFAULT_CONFIG } from '$lib/ai/config';
import { AiError, type RunResult, type SendRequest } from '$lib/ai/types';
import AssistantPanel from './AssistantPanel.svelte';

const db = vi.hoisted(() => ({
	loadAssistantConfig: vi.fn(),
	loadDay: vi.fn()
}));
const send = vi.hoisted(() => vi.fn<(req: SendRequest) => Promise<RunResult>>());

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/finance') } }));
vi.mock('$lib/auth.svelte', () => ({
	session: { user: { uid: 'u1', displayName: 'Mufassir Chowdhury' } }
}));
vi.mock('$lib/db', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/db')>()),
	...db
}));
vi.mock('$lib/ai', () => ({
	loadAdapter: async () => ({ id: 'anthropic', send })
}));

const reply = (over: Partial<RunResult>): RunResult => ({
	text: '',
	calls: [],
	stop: 'done',
	usage: { input: 1, output: 1, cacheRead: 0 },
	model: 'm',
	messages: [],
	...over
});

beforeEach(() => {
	newConversation();
	assistant.open = true;
	db.loadAssistantConfig.mockResolvedValue(structuredClone(DEFAULT_CONFIG));
	db.loadDay.mockResolvedValue('21:00 gym');
	send.mockReset();
});

describe('AssistantPanel', () => {
	it('greets you and offers a few questions to start', async () => {
		const screen = render(AssistantPanel);
		await expect
			.element(screen.getByText(/, Mufassir\. What can I look into\?/))
			.toBeInTheDocument();
		await expect.element(screen.getByRole('heading', { name: 'Jarvis' })).toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: "What's up today?" }))
			.toBeInTheDocument();
	});

	it('answers using its tools and shows what it looked at', async () => {
		send
			.mockResolvedValueOnce(
				reply({
					stop: 'tool_use',
					calls: [{ id: 'c1', name: 'read_day', input: { date: '2026-10-30' } }],
					messages: ['u1', 'a1']
				})
			)
			.mockResolvedValueOnce(
				reply({ text: 'Gym at 9:00 PM. Otherwise clear.', messages: ['u2', 'a2'] })
			);
		const screen = render(AssistantPanel);
		await screen.getByRole('button', { name: "What's up today?" }).click();

		await expect.element(screen.getByText('Gym at 9:00 PM. Otherwise clear.')).toBeInTheDocument();
		await expect.element(screen.getByText('Reading 2026-10-30')).toBeInTheDocument();

		// The page and today's date went along with the question.
		const first = send.mock.calls[0][0];
		expect(first.turn.kind === 'user' && first.turn.text).toContain('Finance page (/finance)');
		expect(first.turn.kind === 'user' && first.turn.text).toContain("What's up today?");
		// The tool ran against the day and its result went back.
		expect(send.mock.calls[1][0].turn).toEqual({
			kind: 'tool_results',
			results: [
				{
					callId: 'c1',
					name: 'read_day',
					content: expect.stringContaining('"text":"gym"')
				}
			]
		});
	});

	it('continues the same conversation with the history', async () => {
		send
			.mockResolvedValueOnce(reply({ text: 'One.', messages: ['u1', 'a1'] }))
			.mockResolvedValueOnce(reply({ text: 'Two.', messages: ['u2', 'a2'] }));
		const screen = render(AssistantPanel);
		const box = screen.getByLabelText('Message');
		await box.fill('first');
		await userEvent.keyboard('{Enter}');
		await expect.element(screen.getByText('One.')).toBeInTheDocument();
		await box.fill('second');
		await userEvent.keyboard('{Enter}');
		await expect.element(screen.getByText('Two.')).toBeInTheDocument();
		expect(send.mock.calls[1][0].history).toEqual(['u1', 'a1']);
	});

	it('points to Settings when there is no key', async () => {
		send.mockRejectedValue(new AiError('no_key', 'No API key on this device yet.'));
		const screen = render(AssistantPanel);
		await screen.getByLabelText('Message').fill('hello');
		await screen.getByRole('button', { name: 'Send' }).click();
		await expect.element(screen.getByText('No API key on this device yet.')).toBeInTheDocument();
		await expect.element(screen.getByRole('link', { name: 'Open Settings' })).toBeInTheDocument();
	});
});
