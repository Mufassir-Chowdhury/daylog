/**
 * A check-in: the assistant working on its own, with nobody in the chat. It
 * uses the background model and a fresh conversation, looks things up with
 * the read tools, and leaves its results in the Inbox — a brief (its answer)
 * plus a proposal card for each change it suggests. Nothing is applied: in a
 * check-in even small additions wait for you.
 *
 * `runDueCheckins` runs whatever the scheduler says is due (called by the web
 * and desktop triggers, Steps 5.4–5.5); Settings' "Run now" calls `runCheckin`
 * directly.
 */
import { dateKey } from '../date';
import {
	claimCheckin,
	listCheckinRecords,
	listMemory,
	loadAssistantConfig,
	newInboxId,
	saveCheckinRecord
} from '../db';
import { describeChange } from '../ops/describe';
import { runAgent } from './agent';
import { addressName, type Checkin } from './config';
import { withinBudget } from './budget';
import { deviceId, loadDevicePrefs } from './device';
import { PROPOSAL_LIFETIME, type InboxItem } from './inbox';
import { putItem } from './inbox.svelte';
import { loadAdapter } from './index';
import { memoryBlock } from './memory';
import { checkinMessage, contextBlock } from './prompt';
import { dueCheckins, type CheckinRecord } from './scheduler';
import { keyStatus } from './transport';
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

let running = false;
/**
 * Today's records as last read. Other devices only ever add records (which
 * stop runs), so when even these say nothing is due, nothing is: the
 * minute-by-minute check then skips Firestore.
 */
let known: { uid: string; date: string; records: CheckinRecord[] } | null = null;

/**
 * Runs the check-in that's due now, if any, and records it so no device runs
 * it again. Returns what it left in the Inbox, or null when nothing ran.
 * Does nothing without a key or with the background budget used up, so no
 * attempt is wasted.
 */
export async function runDueCheckins(
	uid: string,
	displayName: string | null,
	now: Date = new Date()
): Promise<CheckinResult | null> {
	if (running) return null;
	running = true;
	try {
		const prefs = loadDevicePrefs();
		if (!withinBudget('background', prefs) || !(await keyStatus())[prefs.provider]) return null;
		const config = await loadAssistantConfig(uid);
		const today = dateKey(now);
		const cached = known?.uid === uid && known.date === today ? known.records : [];
		const guess = dueCheckins(config, now, today, cached);
		if (!guess.run && !guess.skip.length) return null;

		const records = await listCheckinRecords(uid, today);
		known = { uid, date: today, records };
		const { run, skip } = dueCheckins(config, now, today, records);
		const device = deviceId();
		const save = (record: CheckinRecord) => {
			if (known)
				known.records = [...known.records.filter((r) => r.checkinId !== record.checkinId), record];
			return saveCheckinRecord(uid, record);
		};
		for (const c of skip)
			save({
				date: today,
				checkinId: c.id,
				status: 'skipped',
				at: now.getTime(),
				attempts: 0,
				device
			}).catch(() => {});
		if (!run) return null;
		const claim = await claimCheckin(uid, run, today, device);
		if (!claim) {
			// Someone else has it; read again next time something looks due.
			known = null;
			return null;
		}
		try {
			const result = await runCheckin(uid, run, displayName, now);
			await save({ ...claim, status: 'done' });
			return result;
		} catch (e) {
			await save({ ...claim, status: 'failed' }).catch(() => {});
			throw e;
		}
	} finally {
		running = false;
	}
}
