/**
 * The assistant's chat as app state: whether the panel is open, the messages
 * shown, the conversation it continues, and what happens to the changes it
 * wants to make. Any part of the app can open it or hand it a question (the
 * palette's `?`, the quick bar).
 *
 * Changes (docs/assistant/decisions.md): small additions are applied at once
 * and shown in a bubble with Undo; everything else becomes a card you apply or
 * dismiss. What you did with a card is told to the assistant with your next
 * message.
 */
import { invalidateAll } from '$app/navigation';
import { dateKey } from '../date';
import { loadAssistantConfig, saveAssistantConfig } from '../db';
import { invert, type Change } from '../ops/change';
import { commit } from '../ops/commit';
import { describeChange } from '../ops/describe';
import { staleChanges } from '../ops/fresh';
import { saveFailed, toast } from '../toast.svelte';
import { runAgent } from './agent';
import { addressName, DEFAULT_CONFIG, permissionFor, type AssistantConfig } from './config';
import { loadDevicePrefs } from './device';
import { loadAdapter } from './index';
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

/** A change waiting for you. */
export interface Card {
	id: number;
	tool: string;
	summary: string;
	/** The changes in plain words. */
	details: string[];
	changes: Change[];
	status: 'pending' | 'working' | 'applied' | 'undone' | 'dismissed' | 'stale';
	/** Tick to stop asking for this kind of change. */
	always: boolean;
}

export interface ChatEntry {
	id: number;
	role: 'user' | 'assistant' | 'error';
	text: string;
	/** What it looked at on the way. */
	steps?: string[];
	done?: DoneAction[];
	cards?: Card[];
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
/** What you did with its changes since its last reply, told with your next message. */
let outcomes: string[] = [];
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
	outcomes = [];
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

// ——— Applying changes.

/**
 * Writes the changes, then reloads the page's data so it shows them. Firestore
 * keeps a write locally straight away; the short wait just lets it register
 * before the reload reads.
 */
async function applyChanges(uid: string, changes: Change[]): Promise<void> {
	const saving = commit(uid, changes);
	saving.catch(saveFailed);
	await Promise.race([saving.catch(() => {}), new Promise((r) => setTimeout(r, 600))]);
	await invalidateAll();
}

/** A bubble saying what it did, with Undo. */
function bubble(summary: string, undo: () => void): void {
	toast(`${summary}.`, { from: assistant.name, undo });
}

export function undoAction(uid: string, action: DoneAction): void {
	if (action.undone) return;
	action.undone = true;
	applyChanges(uid, invert(action.changes));
	outcomes.push(`The owner undid: ${action.summary}.`);
}

export async function applyCard(uid: string, card: Card): Promise<void> {
	if (card.status !== 'pending') return;
	card.status = 'working';
	try {
		if ((await staleChanges(uid, card.changes)).length) {
			card.status = 'stale';
			outcomes.push(`Not applied — things had changed since you proposed it: ${card.summary}.`);
			return;
		}
		if (card.always) {
			const config = await loadAssistantConfig(uid);
			config.permissions[card.tool] = 'auto';
			saveAssistantConfig(uid, config).catch(saveFailed);
		}
		await applyChanges(uid, card.changes);
		card.status = 'applied';
		outcomes.push(`The owner applied: ${card.summary}.`);
		bubble(card.summary, () => undoCard(uid, card));
	} catch {
		card.status = 'pending';
		toast("Couldn't apply that — check your connection and try again.", { tone: 'error' });
	}
}

export function undoCard(uid: string, card: Card): void {
	if (card.status !== 'applied') return;
	card.status = 'undone';
	applyChanges(uid, invert(card.changes));
	outcomes.push(`The owner undid: ${card.summary}.`);
}

export function dismissCard(card: Card): void {
	if (card.status !== 'pending') return;
	card.status = 'dismissed';
	outcomes.push(`The owner dismissed: ${card.summary}.`);
}

// ——— Asking.

export interface AskEnv {
	uid: string;
	displayName: string | null;
	/** The page being looked at, from `describeView`. */
	view: string;
	navigate: (path: string) => void;
}

/** Applies small changes at once and turns the rest into cards; tells the model which. */
function proposer(env: AskEnv, config: AssistantConfig, done: DoneAction[], cards: Card[]) {
	return async ({ tool, summary, changes }: Proposal): Promise<string> => {
		if (permissionFor(config, tool.def.name, !!tool.small) === 'auto') {
			await applyChanges(env.uid, changes);
			const action: DoneAction = { summary, changes, undone: false };
			done.push(action);
			// Once the reply is shown the action lives in the chat (as a reactive copy); undo that one.
			bubble(summary, () =>
				undoAction(
					env.uid,
					assistant.entries.flatMap((e) => e.done ?? []).find((a) => a.changes === changes) ??
						action
				)
			);
			return `Done: ${summary}. It's applied; the owner can undo it.`;
		}
		cards.push({
			id: nextId++,
			tool: tool.def.name,
			summary,
			details: changes.flatMap(describeChange),
			changes,
			status: 'pending',
			always: false
		});
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
	const cards: Card[] = [];
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
		const told = outcomes.length
			? `Since your last reply:\n${outcomes.map((o) => `- ${o}`).join('\n')}\n\n`
			: '';
		const result = await runAgent({
			adapter,
			model,
			slot: 'chat',
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
			message: `${contextBlock({ now, config, address, view: env.view })}\n\n${told}${text}`,
			onStep: (step) => (assistant.step = step)
		});
		outcomes = [];
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
			// Anything already applied still shows, with its Undo.
			done
		});
	} finally {
		assistant.busy = false;
		assistant.step = '';
	}
}
