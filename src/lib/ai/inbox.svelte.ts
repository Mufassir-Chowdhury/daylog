/**
 * The Inbox as app state: the cards waiting for you, kept live from Firestore
 * so every device shows the same ones, and what happens when you apply,
 * dismiss or undo one. The chat's cards are Inbox cards too, so they survive a
 * reload. What you did with a card is noted for the assistant's next message.
 */
import { invalidateAll } from '$app/navigation';
import { SvelteSet } from 'svelte/reactivity';
import {
	deleteInboxItem,
	loadAssistantConfig,
	saveAssistantConfig,
	saveInboxItem,
	watchInbox
} from '../db';
import { invert, type Change } from '../ops/change';
import { commit } from '../ops/commit';
import { staleChanges } from '../ops/fresh';
import { saveFailed, toast } from '../toast.svelte';
import { staleItems, type InboxItem, type InboxStatus } from './inbox';

export const inbox = $state({ items: [] as InboxItem[] });
/** Cards being applied right now. */
export const applying = new SvelteSet<string>();

// ——— What you did, told to the assistant with your next message.

const outcomes: string[] = [];

export function noteOutcome(text: string): void {
	outcomes.push(text);
}

/** What happened since the assistant's last reply. */
export function outcomesSoFar(): string[] {
	return outcomes.slice();
}

/** Drops the first `count` outcomes once the assistant has been told. */
export function forgetOutcomes(count = outcomes.length): void {
	outcomes.splice(0, count);
}

// ——— Keeping the Inbox live.

let watching: { uid: string; stop: () => void } | null = null;

/** Starts watching the Inbox for `uid` (once); returns a stop function. */
export function startInbox(uid: string): () => void {
	if (watching?.uid !== uid) {
		watching?.stop();
		let pruned = false;
		const stop = watchInbox(uid, (items) => {
			inbox.items = items;
			if (pruned) return;
			pruned = true;
			for (const old of staleItems(items, Date.now())) deleteInboxItem(uid, old.id).catch(() => {});
		});
		watching = { uid, stop };
	}
	return () => {
		watching?.stop();
		watching = null;
	};
}

export function inboxItem(id: string): InboxItem | undefined {
	return inbox.items.find((i) => i.id === id);
}

/** Saves a card, showing it at once. */
export function putItem(uid: string, item: InboxItem): void {
	const i = inbox.items.findIndex((x) => x.id === item.id);
	if (i === -1) inbox.items.push(item);
	else inbox.items[i] = item;
	saveInboxItem(uid, item).catch(saveFailed);
}

function setStatus(uid: string, id: string, status: InboxStatus): void {
	const item = inboxItem(id);
	if (item) putItem(uid, { ...$state.snapshot(item), status });
}

// ——— Applying changes.

/**
 * Writes the changes, then reloads the page's data so it shows them. Firestore
 * keeps a write locally straight away; the short wait just lets it register
 * before the reload reads.
 */
export async function applyChanges(uid: string, changes: Change[]): Promise<void> {
	const saving = commit(uid, changes);
	saving.catch(saveFailed);
	await Promise.race([saving.catch(() => {}), new Promise((r) => setTimeout(r, 600))]);
	await invalidateAll();
}

export interface ApplyOptions {
	/** Stop asking for this kind of change from now on. */
	always?: boolean;
	/** The assistant's name, for the bubble. */
	from: string;
}

export async function applyItem(uid: string, id: string, opts: ApplyOptions): Promise<void> {
	const item = inboxItem(id);
	if (!item || item.status !== 'pending' || applying.has(id)) return;
	applying.add(id);
	try {
		const changes = $state.snapshot(item.changes) as Change[];
		if ((await staleChanges(uid, changes)).length) {
			setStatus(uid, id, 'stale');
			noteOutcome(`Not applied — things had changed since you proposed it: ${item.title}.`);
			return;
		}
		if (opts.always && item.tool) {
			const config = await loadAssistantConfig(uid);
			config.permissions[item.tool] = 'auto';
			saveAssistantConfig(uid, config).catch(saveFailed);
		}
		await applyChanges(uid, changes);
		setStatus(uid, id, 'applied');
		noteOutcome(`The owner applied: ${item.title}.`);
		toast(`${item.title}.`, { from: opts.from, undo: () => undoItem(uid, id) });
	} catch {
		toast("Couldn't apply that — check your connection and try again.", { tone: 'error' });
	} finally {
		applying.delete(id);
	}
}

export function undoItem(uid: string, id: string): void {
	const item = inboxItem(id);
	if (item?.status !== 'applied') return;
	setStatus(uid, id, 'undone');
	applyChanges(uid, invert($state.snapshot(item.changes) as Change[]));
	noteOutcome(`The owner undid: ${item.title}.`);
}

export function dismissItem(uid: string, id: string): void {
	const item = inboxItem(id);
	if (item?.status !== 'pending' || applying.has(id)) return;
	setStatus(uid, id, 'dismissed');
	noteOutcome(`The owner dismissed: ${item.title}.`);
}
