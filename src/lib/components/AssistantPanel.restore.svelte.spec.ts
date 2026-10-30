import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { assistant } from '$lib/ai/assistant.svelte';
import { DEFAULT_CONFIG } from '$lib/ai/config';
import type { RunResult, SendRequest } from '$lib/ai/types';
import AssistantPanel from './AssistantPanel.svelte';

// A separate file: restoring happens once per account per page load.

const send = vi.hoisted(() => vi.fn<(req: SendRequest) => Promise<RunResult>>());
const saved = vi.hoisted(() => ({
	id: 'thread-9',
	provider: 'anthropic',
	model: 'claude-opus-5-5',
	history: JSON.stringify(['u1', 'a1']),
	entries: JSON.stringify([
		{ id: 1, role: 'user', text: 'What is up today?' },
		{ id: 2, role: 'assistant', text: 'Gym at 9:00 PM.', steps: [] }
	]),
	updatedAt: Date.now() - 60_000
}));
const db = vi.hoisted(() => ({
	loadAssistantConfig: vi.fn(),
	listMemory: vi.fn(async () => []),
	listThreads: vi.fn(async () => [saved]),
	pruneThreads: vi.fn(async () => {}),
	saveThread: vi.fn(async () => {}),
	newThreadId: () => 'thread-new',
	watchInbox: vi.fn(() => () => {})
}));

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/') } }));
vi.mock('$lib/auth.svelte', () => ({ session: { user: { uid: 'u1', displayName: 'M' } } }));
vi.mock('$lib/db', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/db')>()),
	...db
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$lib/ai', () => ({ loadAdapter: async () => ({ id: 'anthropic', send }) }));

describe('AssistantPanel after a reload', () => {
	it('picks up the latest conversation and continues it', async () => {
		db.loadAssistantConfig.mockResolvedValue(structuredClone(DEFAULT_CONFIG));
		assistant.open = true;
		const screen = render(AssistantPanel);
		await expect.element(screen.getByText('Gym at 9:00 PM.')).toBeInTheDocument();
		expect(db.pruneThreads).toHaveBeenCalledWith('u1', 20);

		send.mockResolvedValueOnce({
			text: 'Nothing else.',
			calls: [],
			stop: 'done',
			usage: { input: 1, output: 1, cacheRead: 0 },
			model: 'claude-opus-5-5',
			messages: ['u2', 'a2']
		});
		await screen.getByLabelText('Message').fill('anything else?');
		await screen.getByRole('button', { name: 'Send' }).click();
		await expect.element(screen.getByText('Nothing else.')).toBeInTheDocument();
		// Same conversation: the saved history goes along, and no memory block again.
		const request = send.mock.calls[0][0];
		expect(request.history).toEqual(['u1', 'a1']);
		expect(request.turn.kind === 'user' && request.turn.text).not.toContain('<memory>');
		expect(db.saveThread).toHaveBeenLastCalledWith(
			'u1',
			expect.objectContaining({ id: 'thread-9', history: '["u1","a1","u2","a2"]' })
		);
	});
});
