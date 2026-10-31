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
import { claimCheckin, listCheckinRecords, loadAssistantConfig, saveCheckinRecord } from '../db';
import { backgroundRun, saveBrief } from './background';
import { withinBudget } from './budget';
import type { Checkin } from './config';
import { deviceId, loadDevicePrefs } from './device';
import type { InboxItem } from './inbox';
import { checkinFacts } from './facts';
import { checkinMessage } from './prompt';
import { dueCheckins, type CheckinRecord } from './scheduler';
import { keyStatus } from './transport';

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
	const signalKey = checkinKey(checkin, dateKey(now));
	const { text, truncated, proposals } = await backgroundRun({
		uid,
		displayName,
		now,
		message: checkinMessage(checkin),
		facts: checkinFacts(checkin.kind, dateKey(now)),
		signalKey,
		priority: 0
	});
	if (!text) return { brief: null, proposals };
	const brief = saveBrief(uid, {
		title: `${checkin.label} · ${SHORT_DATE.format(now)}`,
		body: truncated ? `${text}…` : text,
		signalKey,
		// Above its own proposals, which it introduces.
		priority: 1
	});
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
