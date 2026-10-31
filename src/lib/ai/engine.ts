/**
 * Everything the assistant does on its own, run by whichever window holds
 * the lease (Steps 5.3–5.5), once a minute:
 * 1. the scheduled check-in that's due (`checkin.ts`);
 * 2. follow-ups it scheduled for itself (`schedule_checkin`);
 * 3. every 30 minutes outside quiet hours, the detectors: each new signal
 *    gets a short background run, within the daily limit on unprompted cards.
 * Returns the cards worth a bubble.
 */
import { addDays, dateKey } from '../date';
import {
	claimFollowup,
	claimSignal,
	listDeadlines,
	listFollowups,
	listSignalKeys,
	listTasks,
	loadAssistantConfig,
	loadDay,
	pruneSignals,
	saveFollowup
} from '../db';
import { backgroundRun, saveBrief } from './background';
import { withinBudget } from './budget';
import { runDueCheckins } from './checkin';
import { inQuietHours } from './config';
import { detect, DETECTORS, type Detector, type Signal } from './detectors';
import { loadDevicePrefs } from './device';
import { isDue, isMissed, type FollowUp } from './followup';
import type { InboxItem } from './inbox';
import { inbox } from './inbox.svelte';
import { followupMessage, NOTHING, signalMessage } from './prompt';
import { cardsLeftToday, clock } from './scheduler';
import { keyStatus } from './transport';

/** How often the detectors look. */
export const SCAN_EVERY = 30 * 60_000;
/** Signals handled per scan, at most: each one is a model run. */
const SIGNALS_PER_SCAN = 2;
/** Follow-ups are re-read this often, so one runs within this long of its time. */
const FOLLOWUPS_EVERY = 5 * 60_000;

const SHORT = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit' });

let busy = false;
let lastScan = 0;
let followups: { uid: string; at: number; list: FollowUp[] } | null = null;

/** Forgets what's cached (tests, or after signing out). */
export function resetEngine(): void {
	lastScan = 0;
	followups = null;
}

async function canRun(): Promise<boolean> {
	const prefs = loadDevicePrefs();
	return withinBudget('background', prefs) && (await keyStatus())[prefs.provider];
}

/** Runs the follow-ups that are due; returns the cards they left. */
export async function runDueFollowups(
	uid: string,
	displayName: string | null,
	now: Date
): Promise<InboxItem[]> {
	const ms = now.getTime();
	if (!followups || followups.uid !== uid || ms - followups.at > FOLLOWUPS_EVERY)
		followups = { uid, at: ms, list: await listFollowups(uid) };
	const out: InboxItem[] = [];
	for (const f of followups.list) {
		if (isMissed(f, ms)) {
			f.status = 'missed';
			saveFollowup(uid, { ...f }).catch(() => {});
			continue;
		}
		if (!isDue(f, ms)) continue;
		const claim = await claimFollowup(uid, f.id);
		if (!claim) {
			f.status = 'done'; // someone else has it
			continue;
		}
		f.status = 'running';
		const signalKey = `followup:${f.id}`;
		try {
			const run = await backgroundRun({
				uid,
				displayName,
				now,
				message: followupMessage(f.why, new Date(f.at)),
				signalKey,
				priority: 1
			});
			out.push(...run.proposals);
			if (run.text && run.text !== NOTHING)
				out.push(
					saveBrief(uid, {
						title: `Checked back at ${SHORT.format(f.at)}`,
						body: run.text,
						signalKey,
						priority: 1
					})
				);
			f.status = 'done';
		} catch {
			// Stalled runs are taken over after 10 minutes, so leave it running.
			continue;
		}
		await saveFollowup(uid, { ...claim, status: 'done' }).catch(() => {});
	}
	return out;
}

/** What the detectors look at, from the areas the assistant may see. */
async function detectorInput(uid: string, today: string, areas: Record<string, boolean>) {
	const yesterday = addDays(today, -1);
	const [day, deadlines, tasks] = await Promise.all([
		areas.days ? loadDay(uid, yesterday) : Promise.resolve(''),
		areas.schedule ? listDeadlines(uid) : Promise.resolve([]),
		areas.schedule ? listTasks(uid) : Promise.resolve([])
	]);
	return { today, days: { [yesterday]: day }, deadlines, tasks };
}

/** Looks for new signals and runs the most important ones; returns the cards they left. */
export async function runSignals(
	uid: string,
	displayName: string | null,
	now: Date,
	detectors: Detector[] = DETECTORS
): Promise<InboxItem[]> {
	const ms = now.getTime();
	if (ms - lastScan < SCAN_EVERY) return [];
	lastScan = ms;
	const config = await loadAssistantConfig(uid);
	if (inQuietHours(config, clock(now))) return [];
	let left = cardsLeftToday(config, inbox.items, ms);
	if (left <= 0) return [];

	const today = dateKey(now);
	const [signals, seen] = await Promise.all([
		detectorInput(uid, today, config.areas).then((data) => detect(data, detectors)),
		listSignalKeys(uid)
	]);
	pruneSignals(uid, ms - 30 * 86_400_000).catch(() => {});
	const fresh = signals
		.filter((s) => !seen.has(s.key))
		.sort((a, b) => b.priority - a.priority)
		.slice(0, SIGNALS_PER_SCAN);

	const out: InboxItem[] = [];
	for (const signal of fresh) {
		if (left <= 0) break;
		if (!(await claimSignal(uid, signal.key, signal.type))) continue;
		if (covered(signal, ms)) continue;
		const run = await backgroundRun({
			uid,
			displayName,
			now,
			message: signalMessage(signal.about),
			signalKey: signal.key,
			priority: signal.priority
		});
		left -= run.proposals.length;
		out.push(...run.proposals);
		// A note goes with the cards only when there are none: the cards speak for themselves.
		if (!run.proposals.length && run.text && run.text !== NOTHING) {
			out.push(
				saveBrief(uid, {
					title: signal.title,
					body: run.text,
					signalKey: signal.key,
					priority: signal.priority
				})
			);
			left -= 1;
		}
	}
	return out;
}

/** A card from the tool that deals with this was already made today. */
function covered(signal: Signal, now: number): boolean {
	if (!signal.coveredBy) return false;
	const today = dateKey(new Date(now));
	return inbox.items.some(
		(i) => i.tool === signal.coveredBy && dateKey(new Date(i.createdAt)) === today
	);
}

/** One round of background work (see the top of this file). */
export async function runBackgroundWork(
	uid: string,
	displayName: string | null,
	now: Date = new Date()
): Promise<InboxItem[]> {
	if (busy || !(await canRun())) return [];
	busy = true;
	const out: InboxItem[] = [];
	try {
		// Each part on its own: one failing doesn't stop the rest.
		const checkin = await runDueCheckins(uid, displayName, now).catch(() => null);
		if (checkin?.brief) out.push(checkin.brief);
		out.push(...(await runDueFollowups(uid, displayName, now).catch(() => [])));
		out.push(...(await runSignals(uid, displayName, now).catch(() => [])));
	} finally {
		busy = false;
	}
	return out;
}
