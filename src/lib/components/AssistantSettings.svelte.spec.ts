import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { DEFAULT_CONFIG } from '$lib/ai/config';
import AssistantSettings from './AssistantSettings.svelte';

const db = vi.hoisted(() => ({
	loadAssistantConfig: vi.fn(),
	saveAssistantConfig: vi.fn(async () => {}),
	listMemory: vi.fn(),
	saveMemory: vi.fn(async () => {}),
	deleteMemory: vi.fn(async () => {}),
	newMemoryId: () => 'new-memory'
}));
const listModels = vi.hoisted(() => vi.fn());
const runCheckin = vi.hoisted(() => vi.fn());
vi.mock('$lib/ai/checkin', () => ({ runCheckin }));

vi.mock('$lib/auth.svelte', () => ({
	session: { user: { uid: 'u1', displayName: 'Mufassir Chowdhury' } }
}));
vi.mock('$lib/db', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/db')>()),
	...db
}));
vi.mock('$lib/ai', () => ({
	loadAdapter: async () => ({
		listModels,
		pickDefaults: () => ({ chat: 'claude-opus-5-5', background: 'claude-haiku-5-5' })
	})
}));

beforeEach(() => {
	localStorage.clear();
	db.loadAssistantConfig.mockResolvedValue(structuredClone(DEFAULT_CONFIG));
	db.saveAssistantConfig.mockClear();
	db.listMemory.mockResolvedValue([
		{ id: 'm1', text: 'Prefers short answers', kind: 'preference', updatedAt: 1 }
	]);
	db.saveMemory.mockClear();
	db.deleteMemory.mockClear();
	listModels.mockReset();
});

describe('AssistantSettings', () => {
	it('greets you as Jarvis by default and follows a new name', async () => {
		const screen = render(AssistantSettings);
		await expect
			.element(screen.getByText(/Good morning, Mufassir\. Jarvis here/))
			.toBeInTheDocument();

		await screen.getByLabelText('Name', { exact: true }).fill('Friday');
		await screen.getByLabelText('Calls you').fill('sir');
		await expect.element(screen.getByText(/Good morning, sir\. Friday here/)).toBeInTheDocument();
		await vi.waitFor(() =>
			expect(db.saveAssistantConfig).toHaveBeenLastCalledWith(
				'u1',
				expect.objectContaining({ name: 'Friday', addressAs: 'sir' })
			)
		);
	});

	it('shows the three default check-ins', async () => {
		const screen = render(AssistantSettings);
		const times = screen.getByLabelText('Check-in time');
		await expect.element(times.nth(0)).toHaveValue('08:00');
		await expect.element(times.nth(1)).toHaveValue('17:00');
		await expect.element(times.nth(2)).toHaveValue('23:15');
	});

	it('saves a key on this browser, tests it and fills the model pickers', async () => {
		listModels.mockResolvedValue([
			{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
			{ id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }
		]);
		const screen = render(AssistantSettings);
		await screen.getByLabelText('API key').fill('sk-ant-test');
		await screen.getByRole('button', { name: 'Save key' }).click();

		await expect.element(screen.getByText('Connected — 2 models available.')).toBeInTheDocument();
		expect(localStorage.getItem('daylog.ai.key.anthropic')).toBe('sk-ant-test');
		await expect.element(screen.getByLabelText(/^Chat model/)).toHaveValue('claude-opus-5-5');

		await screen.getByRole('button', { name: 'Remove key' }).click();
		await expect.element(screen.getByLabelText('API key')).toBeInTheDocument();
		expect(localStorage.getItem('daylog.ai.key.anthropic')).toBeNull();
	});

	it('shows a failed test in plain words', async () => {
		listModels.mockRejectedValue(new Error('The API key was rejected — check it in Settings.'));
		const screen = render(AssistantSettings);
		await screen.getByLabelText('API key').fill('bad');
		await screen.getByRole('button', { name: 'Save key' }).click();
		await expect.element(screen.getByText(/The API key was rejected/)).toBeInTheDocument();
	});

	it('lists the changes it may make without asking, small additions ticked', async () => {
		const screen = render(AssistantSettings);
		await expect.element(screen.getByLabelText('Add tasks to the plan')).toBeChecked();
		await expect.element(screen.getByLabelText('Record money')).not.toBeChecked();

		await screen.getByLabelText('Move tasks').click();
		await vi.waitFor(() =>
			expect(db.saveAssistantConfig).toHaveBeenLastCalledWith(
				'u1',
				expect.objectContaining({ permissions: { move_task: 'auto' } })
			)
		);
	});

	it('lists what it remembers, to add to, edit and forget', async () => {
		const screen = render(AssistantSettings);
		await expect.element(screen.getByText('Prefers short answers')).toBeInTheDocument();

		await screen.getByLabelText('New memory').fill('DM is taught in room 304');
		await screen.getByLabelText('Memory kind').selectOptions('fact');
		await screen.getByRole('button', { name: 'Add', exact: true }).click();
		expect(db.saveMemory).toHaveBeenCalledWith(
			'u1',
			expect.objectContaining({ id: 'new-memory', text: 'DM is taught in room 304', kind: 'fact' })
		);

		await screen.getByRole('button', { name: 'Edit' }).nth(1).click();
		await screen.getByLabelText('Memory', { exact: true }).fill('Prefers very short answers');
		await screen.getByRole('button', { name: 'Save', exact: true }).click();
		expect(db.saveMemory).toHaveBeenLastCalledWith(
			'u1',
			expect.objectContaining({ id: 'm1', text: 'Prefers very short answers' })
		);

		await screen.getByRole('button', { name: 'Forget: DM is taught in room 304' }).click();
		expect(db.deleteMemory).toHaveBeenCalledWith('u1', 'new-memory');
		await expect.element(screen.getByText('DM is taught in room 304')).not.toBeInTheDocument();
	});

	it('runs a check-in by hand', async () => {
		let finish: (v: unknown) => void = () => {};
		runCheckin.mockReturnValue(new Promise((r) => (finish = r)));
		const screen = render(AssistantSettings);
		await screen.getByRole('button', { name: 'Run now' }).first().click();
		await expect.element(screen.getByRole('button', { name: 'Running…' })).toBeInTheDocument();
		expect(runCheckin).toHaveBeenCalledWith(
			'u1',
			expect.objectContaining({ id: 'warmup', kind: 'warmup' }),
			'Mufassir Chowdhury'
		);
		finish({ brief: {}, proposals: [] });
		await expect
			.element(screen.getByRole('button', { name: 'Run now' }).first())
			.toBeInTheDocument();
	});
});
