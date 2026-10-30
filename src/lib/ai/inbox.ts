/**
 * The Inbox: the assistant's cards that outlive a conversation — changes it
 * proposed (from the chat now, from check-ins in Step 5) and, later, briefs.
 * Stored per account (`assistantInbox`) so every device sees the same ones.
 * Everything in this file is pure.
 */
import type { Change } from '../ops/change';

export type InboxStatus = 'pending' | 'applied' | 'undone' | 'dismissed' | 'stale';

export interface InboxItem {
	id: string;
	kind: 'proposal' | 'brief';
	/** Where it came from: a conversation, or a check-in on its own. */
	source: 'chat' | 'checkin';
	/** One line: "Cancel DM on Thu 12 Nov". */
	title: string;
	/** A brief's text; empty for proposals. */
	body: string;
	/** The write tool that planned it (for "always do this"); empty for briefs. */
	tool: string;
	/** The changes in plain words. */
	details: string[];
	changes: Change[];
	status: InboxStatus;
	/** Same key = same suggestion, so it isn't made twice (Step 5). */
	signalKey: string;
	/** Higher shows first. */
	priority: number;
	/** Milliseconds since the epoch. */
	createdAt: number;
	/** After this a pending card is no longer shown. */
	expiresAt: number;
}

const DAY = 86_400_000;
/** How long a proposal waits before it's dropped from view. */
export const PROPOSAL_LIFETIME = 7 * DAY;
/** Settled or expired cards are deleted after this. */
const KEEP = 30 * DAY;

/** Waiting for you, highest priority then newest first. */
export function pendingItems(items: InboxItem[], now: number): InboxItem[] {
	return items
		.filter((i) => i.status === 'pending' && i.expiresAt > now)
		.sort((a, b) => b.priority - a.priority || b.createdAt - a.createdAt);
}

/** Cards old enough to delete: settled a month ago, or expired a month ago. */
export function staleItems(items: InboxItem[], now: number): InboxItem[] {
	return items.filter((i) =>
		i.status === 'pending' ? i.expiresAt < now - KEEP : i.createdAt < now - KEEP
	);
}
