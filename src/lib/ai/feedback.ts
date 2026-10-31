/**
 * Notifications and feedback for what the assistant does on its own. Pure.
 *
 * - Which cards are worth a notification: check-in briefs, follow-ups and
 *   urgent cards (priority 2+), never in quiet hours. One notification per
 *   round of background work.
 * - How each kind of suggestion (detector type) is received: applied and
 *   dismissed counts, and whether you said "don't suggest these again".
 *   Stored at `assistant/feedback`; muted types aren't raised any more.
 */
import { inQuietHours, type AssistantConfig } from './config';
import type { InboxItem } from './inbox';
import { clock } from './scheduler';

/** The detector types, for Settings and for telling feedback apart from check-ins. */
export const SUGGESTION_TYPES = [
	{ id: 'carryover', label: 'Carry over lines left open yesterday' },
	{ id: 'deadline', label: 'Plan tasks for a deadline coming up' },
	{ id: 'capture', label: 'Turn money, dates and cancellations you type into cards' },
	{ id: 'prep', label: 'Prep notes before meetings, exams and classes with open tasks' }
] as const;

export interface TypeFeedback {
	applied: number;
	dismissed: number;
	muted: boolean;
}

export type Feedback = Record<string, TypeFeedback>;

/** The detector type a card came from (`deadline:d1` → `deadline`), or null. */
export function suggestionType(signalKey: string): string | null {
	const type = signalKey.split(':')[0];
	return SUGGESTION_TYPES.some((t) => t.id === type) ? type : null;
}

export function normalizeFeedback(raw: unknown): Feedback {
	const out: Feedback = {};
	if (!raw || typeof raw !== 'object') return out;
	for (const [type, value] of Object.entries(raw as Record<string, unknown>)) {
		const v = (value ?? {}) as Record<string, unknown>;
		out[type] = {
			applied: Number(v.applied) || 0,
			dismissed: Number(v.dismissed) || 0,
			muted: v.muted === true
		};
	}
	return out;
}

export const isMuted = (feedback: Feedback, type: string) => feedback[type]?.muted === true;

export interface Notice {
	title: string;
	body: string;
}

/** The notification for a round's new cards, or null when none is worth one. */
export function noticeFor(cards: InboxItem[], config: AssistantConfig, now: Date): Notice | null {
	if (inQuietHours(config, clock(now))) return null;
	const worth = cards.filter((c) => /^(checkin|followup):/.test(c.signalKey) || c.priority >= 2);
	if (!worth.length) return null;
	const first = worth.find((c) => c.kind === 'brief') ?? worth[0];
	const body = first.kind === 'brief' ? first.body : first.title;
	const more = cards.length - 1;
	return {
		title: `${config.name} · ${first.kind === 'brief' ? first.title : 'Suggestion'}`,
		body:
			(body.length > 180 ? `${body.slice(0, 179)}…` : body) +
			(more > 0 ? `\n+${more} more in your Inbox` : '')
	};
}
