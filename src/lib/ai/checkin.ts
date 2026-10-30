/**
 * A check-in: the assistant working on its own, with nobody in the chat. It
 * uses the background model and a fresh conversation, looks things up with
 * the read tools, and leaves its results in the Inbox — a brief (its answer)
 * plus a proposal card for each change it suggests. Nothing is applied: in a
 * check-in even small additions wait for you.
 *
 * When check-ins run on their own is Step 5.2 onwards; for now Settings has
 * "Run now".
 */
import { dateKey } from '../date';
import { listMemory, loadAssistantConfig, newInboxId } from '../db';
import { describeChange } from '../ops/describe';
import { runAgent } from './agent';
import { addressName, type Checkin } from './config';
import { loadDevicePrefs } from './device';
import { PROPOSAL_LIFETIME, type InboxItem } from './inbox';
import { putItem } from './inbox.svelte';
import { loadAdapter } from './index';
import { memoryBlock } from './memory';
import { checkinMessage, contextBlock } from './prompt';
import { ALL_TOOLS } from './tools';
import { toolsFor, type Proposal } from './tools/registry';

/** A brief stays in view this long. */
const BRIEF_LIFETIME = 18 * 3_600_000;

export interface CheckinResult {
	brief: InboxItem | null;
	proposals: InboxItem[];
}

const SHORT_DATE = new Intl.DateTimeFormat('en-GB', {
	weekday: 'short',
	day: 'numeric',
	month: 'short'
});

/** The key a check-in's brief carries, so the same check-in isn't briefed twice a day. */
export const checkinKey = (checkin: Checkin, date: string) => `checkin:${checkin.id}:${date}`;

export async function runCheckin(
	uid: string,
	checkin: Checkin,
	displayName: string | null,
	now: Date = new Date()
): Promise<CheckinResult> {
	const prefs = loadDevicePrefs();
	const config = await loadAssistantConfig(uid);
	const adapter = await loadAdapter(prefs.provider);
	const today = dateKey(now);
	const signalKey = checkinKey(checkin, today);
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
			priority: 0,
			createdAt: at,
			expiresAt: at + PROPOSAL_LIFETIME
		};
		proposals.push(item);
		putItem(uid, item);
		return `Saved as a card in the owner's Inbox: “${summary}”. Mention it in a few words in your brief.`;
	};

	const memory = memoryBlock(await listMemory(uid).catch(() => []));
	const result = await runAgent({
		adapter,
		model: prefs.models[prefs.provider].background,
		slot: 'background',
		prefs,
		// No opening pages (nobody is looking) and no memory changes (nobody to confirm them).
		tools: toolsFor(config, ALL_TOOLS).filter((t) => t.kind !== 'ui' && t.area !== 'assistant'),
		ctx: {
			uid,
			today,
			cache: new Map(),
			navigate: () => {},
			propose
		},
		history: [],
		message: [
			contextBlock({
				now,
				config,
				address: addressName(config, displayName),
				view: 'Nothing — this is a scheduled check-in; the owner reads it later in the Inbox'
			}),
			memory,
			checkinMessage(checkin)
		].join('\n\n')
	});

	const text = result.text.trim();
	if (!text || result.stop === 'refusal') return { brief: null, proposals };
	const at = Date.now();
	const brief: InboxItem = {
		id: newInboxId(uid),
		kind: 'brief',
		source: 'checkin',
		title: `${checkin.label} · ${SHORT_DATE.format(now)}`,
		body: result.stop === 'max_tokens' ? `${text}…` : text,
		tool: '',
		details: [],
		changes: [],
		status: 'pending',
		signalKey,
		// Above its own proposals, which it introduces.
		priority: 1,
		createdAt: at,
		expiresAt: at + BRIEF_LIFETIME
	};
	putItem(uid, brief);
	return { brief, proposals };
}
