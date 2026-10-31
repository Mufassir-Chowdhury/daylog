import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { assistant, newConversation, openAssistant } from '$lib/ai/assistant.svelte';
import { DEFAULT_CONFIG } from '$lib/ai/config';
import type { RunResult, SendRequest } from '$lib/ai/types';
import AssistantPanel from './AssistantPanel.svelte';

// Voice on (a key is saved): the mic shows, a spoken question is answered aloud.

const send = vi.hoisted(() => vi.fn<(req: SendRequest) => Promise<RunResult>>());
const voiceApi = vi.hoisted(() => ({
	listen: vi.fn(async () => "what's up today"),
	speak: vi.fn(async () => {}),
	stopListening: vi.fn(),
	cancelListening: vi.fn(),
	stopSpeaking: vi.fn()
}));
vi.mock('$lib/ai/voice.svelte', async () => {
	const { voice } = await import('./voice-state.test-helper.svelte');
	return { voice, ...voiceApi };
});
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/') } }));
vi.mock('$lib/auth.svelte', () => ({ session: { user: { uid: 'u1', displayName: 'M' } } }));
vi.mock('$lib/db', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/db')>()),
	loadAssistantConfig: vi.fn(async () => structuredClone(DEFAULT_CONFIG)),
	listMemory: vi.fn(async () => []),
	listThreads: vi.fn(async () => []),
	pruneThreads: vi.fn(async () => {}),
	saveThread: vi.fn(async () => {}),
	newThreadId: () => 'thread-1',
	watchInbox: vi.fn(() => () => {})
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$lib/ai', () => ({ loadAdapter: async () => ({ id: 'anthropic', send }) }));

describe('AssistantPanel with voice', () => {
	it('sends what you said as a spoken question and reads the reply aloud', async () => {
		send.mockResolvedValueOnce({
			text: 'Two classes and a meeting at nine.',
			calls: [],
			stop: 'done',
			usage: { input: 1, output: 1, cacheRead: 0 },
			model: 'm',
			messages: ['u1', 'a1']
		});
		assistant.open = true;
		const screen = render(AssistantPanel);
		await screen.getByRole('button', { name: 'Talk to Jarvis' }).click();

		await expect
			.element(screen.getByText('Two classes and a meeting at nine.'))
			.toBeInTheDocument();
		const turn = send.mock.calls[0][0].turn;
		expect(turn.kind === 'user' && turn.text).toContain('The owner spoke this message');
		expect(turn.kind === 'user' && turn.text).toContain("what's up today");
		expect(voiceApi.speak).toHaveBeenCalledWith('Two classes and a meeting at nine.');
		await expect.element(screen.getByRole('button', { name: 'Read aloud' })).toBeInTheDocument();
	});

	it('answers aloud a spoken question handed over from the quick bar', async () => {
		newConversation();
		voiceApi.speak.mockClear();
		send.mockResolvedValueOnce({
			text: 'Clear until noon.',
			calls: [],
			stop: 'done',
			usage: { input: 1, output: 1, cacheRead: 0 },
			model: 'm',
			messages: ['u2', 'a2']
		});
		openAssistant('am I free this morning', true);
		render(AssistantPanel);
		await vi.waitFor(() => expect(voiceApi.speak).toHaveBeenCalledWith('Clear until noon.'));
		const turn = send.mock.calls.at(-1)![0].turn;
		expect(turn.kind === 'user' && turn.text).toContain('The owner spoke this message');
	});
});
