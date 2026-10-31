/**
 * The assistant's chat as app state: whether the panel is open, the messages
 * shown, the conversation it continues, and what happens to the changes it
 * wants to make. Any part of the app can open it or hand it a question (the
 * palette's `?`, the quick bar).
 *
 * Changes (docs/assistant/decisions.md): small additions are applied at once
 * and shown in a bubble with Undo; everything else becomes an Inbox card
 * (`inbox.svelte.ts`) you apply or dismiss, shown in the chat too. What you did
 * with a card is told to the assistant with your next message.
 *
 * The conversation is saved (`assistantThreads`), so a reload picks it up again.
 */
import { dateKey } from '../date';
import {
	listMemory,
	listThreads,
	loadAssistantConfig,
	newInboxId,
	newThreadId,
	pruneThreads,
	saveThread
} from '../db';
import { invert, type Change } from '../ops/change';
import { describeChange } from '../ops/describe';
import { toast } from '../toast.svelte';
import { runAgent } from './agent';
import { addressName, DEFAULT_CONFIG, permissionFor, type AssistantConfig } from './config';
import { loadDevicePrefs } from './device';
import { PROPOSAL_LIFETIME } from './inbox';
import { applyChanges, forgetOutcomes, noteOutcome, outcomesSoFar, putItem } from './inbox.svelte';
import { loadAdapter } from './index';
import { memoryBlock } from './memory';
import { contextBlock } from './prompt';
import { ALL_TOOLS } from './tools';
import { toolsFor, type Proposal } from './tools/registry';
import { AiError, type AiErrorKind, type ProviderId } from './types';

/** Something it changed straight away. */
export interface DoneAction {
	summary: string;
	changes: Change[];
	undone: boolean;
}

export interface ChatEntry {
	id: number;
	role: 'user' | 'assistant' | 'error';
	text: string;
	/** What it looked at on the way. */
	steps?: string[];
	done?: DoneAction[];
	/** Ids of the Inbox cards it proposed. */
	cards?: string[];
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

/**
 * The conversation being continued: its saved id and the provider-format
 * history behind the messages. A provider or model switch starts the history
 * afresh (the messages stay).
 */
let thread: { id: string; provider: ProviderId; model: string; history: unknown[] } | null = null;
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
	forgetOutcomes();
	assistant.entries = [];
}

// ——— Saving the conversation.

/** A conversation untouched for longer than this isn't picked up again. */
const RESUME_WITHIN = 12 * 3_600_000;
/** Conversations kept in Firestore. */
const KEEP_THREADS = 20;
/** Past this the provider history isn't saved (a Firestore doc holds 1 MiB). */
const MAX_HISTORY = 600_000;
const MAX_ENTRIES = 250_000;

let restored: string | null = null;

/** Picks up the latest conversation after a reload (once per account). */
export async function restoreConversation(uid: string): Promise<void> {
	if (restored === uid) return;
	restored = uid;
	try {
		const [latest] = await listThreads(uid, 1);
		pruneThreads(uid, KEEP_THREADS).catch(() => {});
		if (!latest || Date.now() - latest.updatedAt > RESUME_WITHIN) return;
		// Something was asked meanwhile — that conversation wins.
		if (thread || assistant.entries.length) return;
		const entries = JSON.parse(latest.entries) as ChatEntry[];
		thread = {
			id: latest.id,
			provider: latest.provider as ProviderId,
			model: latest.model,
			history: latest.history ? JSON.parse(latest.history) : []
		};
		assistant.entries = entries;
		nextId = Math.max(nextId, ...entries.map((e) => e.id + 1));
	} catch {
		// Offline or a damaged save: start afresh.
	}
}

function persist(uid: string): void {
	if (!thread) return;
	let history = JSON.stringify(thread.history);
	if (history.length > MAX_HISTORY) history = '';
	let entries = $state.snapshot(assistant.entries);
	let json = JSON.stringify(entries);
	while (json.length > MAX_ENTRIES && entries.length > 1) {
		entries = entries.slice(Math.ceil(entries.length / 4));
		json = JSON.stringify(entries);
	}
	saveThread(uid, {
		id: thread.id,
		provider: thread.provider,
		model: thread.model,
		history,
		entries: json,
		updatedAt: Date.now()
	}).catch(() => {});
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

// ——— Changes it made straight away.

export function undoAction(uid: string, action: DoneAction): void {
	if (action.undone) return;
	action.undone = true;
	applyChanges(uid, invert($state.snapshot(action.changes) as Change[]));
	noteOutcome(`The owner undid: ${action.summary}.`);
	persist(uid);
}

// ——— Asking.

export interface AskEnv {
	uid: string;
	displayName: string | null;
	/** The page being looked at, from `describeView`. */
	view: string;
	navigate: (path: string) => void;
}

/** Applies small changes at once and turns the rest into Inbox cards; tells the model which. */
function proposer(env: AskEnv, config: AssistantConfig, done: DoneAction[], cards: string[]) {
	return async ({ tool, summary, changes }: Proposal): Promise<string> => {
		if (permissionFor(config, tool.def.name, !!tool.small) === 'auto') {
			await applyChanges(env.uid, changes);
			const action: DoneAction = { summary, changes, undone: false };
			done.push(action);
			// Once the reply is shown the action lives in the chat (as a reactive copy); undo that one.
			toast(`${summary}.`, {
				from: assistant.name,
				undo: () =>
					undoAction(
						env.uid,
						assistant.entries.flatMap((e) => e.done ?? []).find((a) => a.changes === changes) ??
							action
					)
			});
			return `Done: ${summary}. It's applied; the owner can undo it.`;
		}
		const now = Date.now();
		const id = newInboxId(env.uid);
		putItem(env.uid, {
			id,
			kind: 'proposal',
			source: 'chat',
			title: summary,
			body: '',
			tool: tool.def.name,
			details: changes.flatMap(describeChange),
			changes,
			status: 'pending',
			signalKey: '',
			priority: 0,
			createdAt: now,
			expiresAt: now + PROPOSAL_LIFETIME
		});
		cards.push(id);
		return (
			`Not applied yet: “${summary}” is shown to the owner as a card to apply or dismiss. ` +
			"Mention it in a few words; don't ask for a yes in words or try another way."
		);
	};
}

export async function ask(question: string, env: AskEnv): Promise<void> {
	const text = question.trim();
	if (!text || assistant.busy) return;
	assistant.entries.push({ id: nextId++, role: 'user', text });
	assistant.busy = true;
	assistant.step = '';
	const done: DoneAction[] = [];
	const cards: string[] = [];
	try {
		const prefs = loadDevicePrefs();
		const config = await loadAssistantConfig(env.uid);
		assistant.name = config.name;
		const address = addressName(config, env.displayName);
		assistant.address = address;

		const provider = prefs.provider;
		const model = prefs.models[provider].chat;
		if (!thread || thread.provider !== provider || thread.model !== model)
			thread = { id: thread?.id ?? newThreadId(env.uid), provider, model, history: [] };
		// What it remembers goes in front of a conversation's first message.
		const memory = thread.history.length
			? ''
			: `${memoryBlock(await listMemory(env.uid).catch(() => []))}\n\n`;
		const adapter = await loadAdapter(provider);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a timestamp, not state
		const now = new Date();
		const outcomes = outcomesSoFar();
		const told = outcomes.length
			? `Since your last reply:\n${outcomes.map((o) => `- ${o}`).join('\n')}\n\n`
			: '';
		const result = await runAgent({
			adapter,
			model,
			slot: 'chat',
			kind: 'chat',
			prefs,
			tools: toolsFor(config, ALL_TOOLS),
			ctx: {
				uid: env.uid,
				today: dateKey(now),
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- per-turn fetch cache, not state
				cache: new Map(),
				navigate: env.navigate,
				propose: proposer(env, config, done, cards)
			},
			history: thread.history,
			message: `${contextBlock({ now, config, address, view: env.view })}\n\n${memory}${told}${text}`,
			onStep: (step) => (assistant.step = step)
		});
		forgetOutcomes(outcomes.length);
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
						: result.text || (done.length || cards.length ? '' : 'Done.'),
			steps: result.steps,
			done,
			cards
		});
	} catch (e) {
		const error = e instanceof AiError ? e : new AiError('network', String(e));
		assistant.entries.push({
			id: nextId++,
			role: 'error',
			text: error.message,
			errorKind: error.kind,
			// Anything already applied or proposed still shows.
			done,
			cards
		});
	} finally {
		assistant.busy = false;
		assistant.step = '';
		persist(env.uid);
	}
}
