/**
 * Follow-ups: check-ins the assistant schedules for itself with
 * `schedule_checkin` ("I'll look again at 3 PM"). Stored per account
 * (`assistantFollowups`); whichever device holds the lease runs them.
 * Everything here is pure.
 */

export type FollowUpStatus = 'pending' | 'running' | 'done' | 'missed';

export interface FollowUp {
	id: string;
	/** When to look again, ms since the epoch. */
	at: number;
	/** What to look at, in the assistant's words. */
	why: string;
	status: FollowUpStatus;
	/** When a device started running it (for taking over a stalled run). */
	claimedAt: number;
}

/** Later than this after its time, a follow-up is no use any more. */
export const FOLLOWUP_GRACE = 6 * 3_600_000;
const STALLED = 10 * 60_000;

/** Due at `now`: time passed, still in its grace period, and not taken (or stalled). */
export function isDue(f: FollowUp, now: number): boolean {
	if (f.at > now || now - f.at > FOLLOWUP_GRACE) return false;
	return f.status === 'pending' || (f.status === 'running' && now - f.claimedAt > STALLED);
}

/** Pending but too late to be useful. */
export const isMissed = (f: FollowUp, now: number) =>
	f.status === 'pending' && now - f.at > FOLLOWUP_GRACE;
