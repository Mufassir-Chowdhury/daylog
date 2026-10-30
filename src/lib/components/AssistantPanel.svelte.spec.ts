import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { assistant, newConversation } from '$lib/ai/assistant.svelte';
import { DEFAULT_CONFIG } from '$lib/ai/config';
import { AiError, type RunResult, type SendRequest } from '$lib/ai/types';
import AssistantPanel from './AssistantPanel.svelte';

const db = vi.hoisted(() => ({
	loadAssistantConfig: vi.fn(),
	saveAssistantConfig: vi.fn(async () => {}),
	loadDay: vi.fn(),
	listTasks: vi.fn()
}));
const writes = vi.hoisted(() => ({
	commit: vi.fn<(uid: string, changes: unknown[]) => Promise<void>>(async () => {}),
	stale: vi.fn<(uid: string, changes: unknown[]) => Promise<unknown[]>>(async () => [])
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
vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
	invalidateAll: vi.fn(async () => {})
}));
vi.mock('$lib/ops/commit', () => ({ commit: writes.commit }));
vi.mock('$lib/ops/fresh', () => ({ staleChanges: writes.stale }));
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
	writes.commit.mockClear();
	writes.stale.mockReset().mockResolvedValue([]);
});

const task = {
	id: 't1',
	text: 'Grade DM',
	date: '2026-10-30',
	until: null,
	start: '',
	end: '',
	status: 'open',
	note: '',
	highlight: false,
	createdAt: 1
};

/** One tool call, then a short reply. */
function callsThen(name: string, input: Record<string, unknown>, text: string) {
	send
		.mockResolvedValueOnce(
			reply({ stop: 'tool_use', calls: [{ id: 'c1', name, input }], messages: ['u1', 'a1'] })
		)
		.mockResolvedValueOnce(reply({ text, messages: ['u2', 'a2'] }));
}

async function askAndWait(screen: ReturnType<typeof render>, question: string, answer: string) {
	await screen.getByLabelText('Message').fill(question);
	await screen.getByRole('button', { name: 'Send' }).click();
	await expect.element(screen.getByText(answer)).toBeInTheDocument();
}

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

	it('applies a small addition at once and can undo it', async () => {
		callsThen(
			'add_task',
			{ text: 'Grade DM', date: null, until: null, start: null, end: null, highlight: null },
			'Added.'
		);
		const screen = render(AssistantPanel);
		await askAndWait(screen, 'add grading DM to later', 'Added.');

		expect(writes.commit).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[1][0].turn).toMatchObject({
			results: [{ content: expect.stringContaining('Done: Add “Grade DM” to Later') }]
		});
		await expect.element(screen.getByText('Add “Grade DM” to Later')).toBeInTheDocument();

		await screen.getByRole('button', { name: 'Undo' }).click();
		expect(writes.commit).toHaveBeenCalledTimes(2);
		// The undo removes the task it created.
		expect(writes.commit.mock.calls[1][1]).toEqual([
			expect.objectContaining({ kind: 'task', after: null })
		]);
		await expect.element(screen.getByText('undone')).toBeInTheDocument();
	});

	it('proposes other changes as a card, applied only when you say so', async () => {
		db.listTasks.mockResolvedValue([task]);
		callsThen(
			'set_task_status',
			{ id: 't1', status: 'dropped', note: 'Not needed — exam postponed' },
			'Proposed.'
		);
		const screen = render(AssistantPanel);
		await askAndWait(screen, 'drop grading DM', 'Proposed.');

		expect(writes.commit).not.toHaveBeenCalled();
		await expect.element(screen.getByText('Mark “Grade DM” not needed')).toBeInTheDocument();
		await expect.element(screen.getByText('Status: open → dropped')).toBeInTheDocument();

		await screen.getByRole('button', { name: 'Apply' }).click();
		await expect.element(screen.getByText('Applied')).toBeInTheDocument();
		expect(writes.commit).toHaveBeenCalledTimes(1);

		// The next message tells it what happened.
		send.mockResolvedValueOnce(reply({ text: 'Noted.', messages: ['u3', 'a3'] }));
		await askAndWait(screen, 'thanks', 'Noted.');
		expect(send.mock.calls[2][0].turn).toMatchObject({
			text: expect.stringContaining('The owner applied: Mark “Grade DM” not needed.')
		});
	});

	it("won't apply a card when things changed since", async () => {
		db.listTasks.mockResolvedValue([task]);
		writes.stale.mockResolvedValue([{}]);
		callsThen('set_task_status', { id: 't1', status: 'done', note: null }, 'Proposed.');
		const screen = render(AssistantPanel);
		await askAndWait(screen, 'grading done', 'Proposed.');
		await screen.getByRole('button', { name: 'Apply' }).click();
		await expect.element(screen.getByText(/Things changed since/)).toBeInTheDocument();
		expect(writes.commit).not.toHaveBeenCalled();
	});

	it('remembers "always do this" for that kind of change', async () => {
		db.listTasks.mockResolvedValue([task]);
		callsThen('set_task_status', { id: 't1', status: 'done', note: null }, 'Proposed.');
		const screen = render(AssistantPanel);
		await askAndWait(screen, 'grading done', 'Proposed.');
		await screen.getByLabelText('Always do this without asking').click();
		await screen.getByRole('button', { name: 'Apply' }).click();
		await expect.element(screen.getByText('Applied')).toBeInTheDocument();
		expect(db.saveAssistantConfig).toHaveBeenCalledWith(
			'u1',
			expect.objectContaining({ permissions: { set_task_status: 'auto' } })
		);
	});
});
