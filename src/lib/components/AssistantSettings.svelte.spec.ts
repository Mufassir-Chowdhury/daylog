import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { DEFAULT_CONFIG } from '$lib/ai/config';
import AssistantSettings from './AssistantSettings.svelte';

const db = vi.hoisted(() => ({
	loadAssistantConfig: vi.fn(),
	saveAssistantConfig: vi.fn(async () => {})
}));
const listModels = vi.hoisted(() => vi.fn());

vi.mock('$lib/auth.svelte', () => ({
	session: { user: { uid: 'u1', displayName: 'Mufassir Chowdhury' } }
}));
vi.mock('$lib/db', () => db);
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
});
