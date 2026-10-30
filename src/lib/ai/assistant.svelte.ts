/**
 * The assistant's chat as app state: whether the panel is open, the messages
 * shown, and the conversation it continues. Any part of the app can open it or
 * hand it a question (the palette's `?`, the quick bar).
 */
import { dateKey } from '../date';
import { loadAssistantConfig } from '../db';
import { runAgent } from './agent';
import { addressName, DEFAULT_CONFIG } from './config';
import { loadDevicePrefs } from './device';
import { loadAdapter } from './index';
import { contextBlock } from './prompt';
import { ALL_TOOLS } from './tools';
import { toolsFor } from './tools/registry';
import { AiError, type AiErrorKind, type ProviderId } from './types';

export interface ChatEntry {
	id: number;
	role: 'user' | 'assistant' | 'error';
	text: string;
	/** What it looked at on the way. */
	steps?: string[];
	errorKind?: AiErrorKind;
}

export const assistant = $state({
	open: false,
	busy: false,
	/** What it's doing right now ("Checking your schedule"). */
	step: '',
	name: DEFAULT_CONFIG.name,
	/** How it addresses you. */
	address: '',
	entries: [] as ChatEntry[],
	/** A question handed over to be sent once the panel is up. */
	pending: ''
});

/** The provider-format history behind the messages. A provider or model switch starts afresh. */
let thread: { provider: ProviderId; model: string; history: unknown[] } | null = null;
let nextId = 1;

export function openAssistant(question = ''): void {
	assistant.open = true;
	if (question.trim()) assistant.pending = question.trim();
}

export function closeAssistant(): void {
	assistant.open = false;
}

export function newConversation(): void {
	thread = null;
	assistant.entries = [];
}

/** Picks up the name and form of address from Settings. */
export async function refreshIdentity(uid: string, displayName: string | null): Promise<void> {
	try {
		const config = await loadAssistantConfig(uid);
		assistant.name = config.name;
		assistant.address = addressName(config, displayName);
	} catch {
		// Offline with a cold cache — the defaults will do.
	}
}

export interface AskEnv {
	uid: string;
	displayName: string | null;
	/** The page being looked at, from `describeView`. */
	view: string;
	navigate: (path: string) => void;
}

export async function ask(question: string, env: AskEnv): Promise<void> {
	const text = question.trim();
	if (!text || assistant.busy) return;
	assistant.entries.push({ id: nextId++, role: 'user', text });
	assistant.busy = true;
	assistant.step = '';
	try {
		const prefs = loadDevicePrefs();
		const config = await loadAssistantConfig(env.uid);
		assistant.name = config.name;
		const address = addressName(config, env.displayName);
		assistant.address = address;

		const provider = prefs.provider;
		const model = prefs.models[provider].chat;
		if (!thread || thread.provider !== provider || thread.model !== model)
			thread = { provider, model, history: [] };
		const adapter = await loadAdapter(provider);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a timestamp, not state
		const now = new Date();
		const result = await runAgent({
			adapter,
			model,
			slot: 'chat',
			prefs,
			// Reading and opening pages only, until changes arrive in the next step.
			tools: toolsFor(config, ALL_TOOLS).filter((t) => t.kind !== 'write'),
			ctx: {
				uid: env.uid,
				today: dateKey(now),
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- per-turn fetch cache, not state
				cache: new Map(),
				navigate: env.navigate
			},
			history: thread.history,
			message: `${contextBlock({ now, config, address, view: env.view })}\n\n${text}`,
			onStep: (step) => (assistant.step = step)
		});
		thread.history = result.history;
		assistant.entries.push({
			id: nextId++,
			role: 'assistant',
			text:
				result.stop === 'refusal'
					? (result.text || "I'd rather not take that one on.") +
						' (The provider declined this request.)'
					: result.stop === 'max_tokens'
						? `${result.text}…`
						: result.text || 'Done.',
			steps: result.steps
		});
	} catch (e) {
		const error = e instanceof AiError ? e : new AiError('network', String(e));
		assistant.entries.push({
			id: nextId++,
			role: 'error',
			text: error.message,
			errorKind: error.kind
		});
	} finally {
		assistant.busy = false;
		assistant.step = '';
	}
}
