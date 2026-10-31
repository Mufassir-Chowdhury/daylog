/**
 * The assistant working on its own, with nobody in the chat: a check-in, a
 * detector's signal (Step 5.6) or a follow-up it scheduled. It uses the
 * background model and a fresh conversation, looks things up with the read
 * tools, and leaves its results in the Inbox. Nothing is applied: every change
 * it suggests, even a small addition, becomes a proposal card.
 */
import { dateKey } from '../date';
import { listMemory, loadAssistantConfig, newInboxId } from '../db';
import { describeChange } from '../ops/describe';
import { runAgent } from './agent';
import { addressName } from './config';
import { loadDevicePrefs } from './device';
import { PROPOSAL_LIFETIME, type InboxItem } from './inbox';
import { putItem } from './inbox.svelte';
import { loadAdapter } from './index';
import { memoryBlock } from './memory';
import { contextBlock } from './prompt';
import { ALL_TOOLS } from './tools';
import { toolsFor, type Proposal } from './tools/registry';

/** A brief stays in view this long. */
const BRIEF_LIFETIME = 18 * 3_600_000;

export interface BackgroundJob {
	uid: string;
	displayName: string | null;
	now: Date;
	/** What to do, after the context and memory blocks. */
	message: string;
	/** Carried by every card it leaves, for dedupe and feedback. */
	signalKey: string;
	/** Of the proposal cards. */
	priority: number;
}

export interface BackgroundResult {
	/** Its final answer, trimmed; empty when there was none (or it was refused). */
	text: string;
	truncated: boolean;
	proposals: InboxItem[];
}

export async function backgroundRun(job: BackgroundJob): Promise<BackgroundResult> {
	const { uid, now, signalKey } = job;
	const prefs = loadDevicePrefs();
	const config = await loadAssistantConfig(uid);
	const adapter = await loadAdapter(prefs.provider);
	const proposals: InboxItem[] = [];

	// Changes are collected as cards, never applied.
	const propose = async ({ tool, summary, changes }: Proposal): Promise<string> => {
		const at = Date.now();
		const item: InboxItem = {
			id: newInboxId(uid),
			kind: 'proposal',
			source: 'checkin',
			title: summary,
			body: '',
			tool: tool.def.name,
			details: changes.flatMap(describeChange),
			changes,
			status: 'pending',
			signalKey,
			priority: job.priority,
			createdAt: at,
			expiresAt: at + PROPOSAL_LIFETIME
		};
		proposals.push(item);
		putItem(uid, item);
		return `Saved as a card in the owner's Inbox: “${summary}”. Mention it in a few words in your answer.`;
	};

	const memory = memoryBlock(await listMemory(uid).catch(() => []));
	const result = await runAgent({
		adapter,
		model: prefs.models[prefs.provider].background,
		slot: 'background',
		prefs,
		// No opening pages (nobody is looking) and no memory changes (nobody to confirm them).
		tools: toolsFor(config, ALL_TOOLS).filter((t) => t.kind !== 'ui' && t.area !== 'assistant'),
		ctx: { uid, today: dateKey(now), cache: new Map(), navigate: () => {}, propose },
		history: [],
		message: [
			contextBlock({
				now,
				config,
				address: addressName(config, job.displayName),
				view: 'Nothing — you are working on your own; the owner reads the result later in the Inbox'
			}),
			memory,
			job.message
		].join('\n\n')
	});
	const refused = result.stop === 'refusal';
	return {
		text: refused ? '' : result.text.trim(),
		truncated: result.stop === 'max_tokens',
		proposals
	};
}

/** Saves a brief card. */
export function saveBrief(
	uid: string,
	brief: { title: string; body: string; signalKey: string; priority: number }
): InboxItem {
	const at = Date.now();
	const item: InboxItem = {
		id: newInboxId(uid),
		kind: 'brief',
		source: 'checkin',
		title: brief.title,
		body: brief.body,
		tool: '',
		details: [],
		changes: [],
		status: 'pending',
		signalKey: brief.signalKey,
		priority: brief.priority,
		createdAt: at,
		expiresAt: at + BRIEF_LIFETIME
	};
	putItem(uid, item);
	return item;
}
