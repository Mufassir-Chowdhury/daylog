/**
 * Everything the assistant does on its own, run by whichever window holds
 * the lease (Steps 5.3–5.5), once a minute:
 * 1. the scheduled check-in that's due (`checkin.ts`);
 * 2. follow-ups it scheduled for itself (`schedule_checkin`);
 * 3. prep notes shortly before meetings and exams (`detectors/prep.ts`), checked
 *    every minute since timing matters;
 * 4. every 30 minutes outside quiet hours, the detectors: each new signal
 *    gets a short background run, within the daily limit on unprompted cards,
 *    except kinds you muted ("Don't suggest these again") or mostly dismiss
 *    (paused until you resume them).
 * Returns the new cards; `notifyAbout` turns them into a notification.
 */
import { addDays, dateKey } from '../date';
import {
	claimFollowup,
	claimSignal,
	listDeadlines,
	listEvents,
	listFollowups,
	listSlots,
	listSignalKeys,
	listTasks,
	listTransactions,
	loadAssistantConfig,
	loadFeedback,
	loadDay,
	pruneSignals,
	saveFollowup
} from '../db';
import { backgroundRun, saveBrief } from './background';
import { withinBudget } from './budget';
import { runDueCheckins } from './checkin';
import { inQuietHours } from './config';
import { detect, DETECTORS, type Detector, type Signal } from './detectors';
import { upcomingPrep } from './detectors/prep';
import { occurrences } from '../schedule';
import { desktop } from '../desktop';
import { loadDevicePrefs } from './device';
import { isOff, noticeFor } from './feedback';
import { isDue, isMissed, type FollowUp } from './followup';
import type { InboxItem } from './inbox';
import { inbox } from './inbox.svelte';
import { captureKey, type Candidate } from './capture';
import { captureMessage, followupMessage, NOTHING, signalMessage } from './prompt';
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
/** What prep looks at, re-read every 10 minutes. */
let prepData: {
	uid: string;
	at: number;
	date: string;
	data: Awaited<ReturnType<typeof loadPrepData>>;
} | null = null;
/** Prep signals already dealt with here, so the minute check doesn't claim them again. */
const prepDone = new Set<string>();
const PREP_DATA_EVERY = 10 * 60_000;

/** Forgets what's cached (tests, or after signing out). */
export function resetEngine(): void {
	lastScan = 0;
	followups = null;
	prepData = null;
	prepDone.clear();
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
				kind: 'followup',
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
	const [day, deadlines, tasks, transactions] = await Promise.all([
		areas.days ? loadDay(uid, yesterday) : Promise.resolve(''),
		areas.schedule ? listDeadlines(uid) : Promise.resolve([]),
		areas.schedule ? listTasks(uid) : Promise.resolve([]),
		areas.finance ? listTransactions(uid) : Promise.resolve([])
	]);
	return { today, days: { [yesterday]: day }, deadlines, tasks, transactions };
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
	const [signals, seen, feedback] = await Promise.all([
		detectorInput(uid, today, config.areas).then((data) => detect(data, detectors)),
		listSignalKeys(uid),
		loadFeedback(uid).catch(() => ({}))
	]);
	pruneSignals(uid, ms - 30 * 86_400_000).catch(() => {});
	const fresh = signals
		.filter((s) => !seen.has(s.key) && !isOff(feedback, s.type))
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
			kind: 'signal',
			message: signalMessage(signal.about),
			signalKey: signal.key,
			priority: signal.priority,
			facts: signal.facts
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

async function loadPrepData(uid: string, today: string) {
	const [slots, events, tasks, dayText] = await Promise.all([
		listSlots(uid),
		listEvents(uid),
		listTasks(uid),
		loadDay(uid, today)
	]);
	return { events: occurrences(slots, events, today, today).map((o) => o.event), tasks, dayText };
}

/** Prep notes for what starts in about half an hour; returns the cards. */
export async function runPrep(
	uid: string,
	displayName: string | null,
	now: Date
): Promise<InboxItem[]> {
	const config = await loadAssistantConfig(uid);
	if (!config.areas.schedule || inQuietHours(config, clock(now))) return [];
	const ms = now.getTime();
	const today = dateKey(now);
	if (
		!prepData ||
		prepData.uid !== uid ||
		prepData.date !== today ||
		ms - prepData.at > PREP_DATA_EVERY
	)
		prepData = { uid, at: ms, date: today, data: await loadPrepData(uid, today) };
	const signals = upcomingPrep({
		today,
		now: now.getHours() * 60 + now.getMinutes(),
		...prepData.data,
		dayText: config.areas.days ? prepData.data.dayText : ''
	}).filter((s) => !prepDone.has(s.key));
	if (!signals.length) return [];
	if (isOff(await loadFeedback(uid).catch(() => ({})), 'prep')) return [];
	const out: InboxItem[] = [];
	for (const signal of signals) {
		prepDone.add(signal.key);
		if (cardsLeftToday(config, inbox.items, ms) <= 0) break;
		if (!(await claimSignal(uid, signal.key, signal.type))) continue;
		const run = await backgroundRun({
			uid,
			displayName,
			now,
			kind: 'prep',
			message: signalMessage(signal.about),
			signalKey: signal.key,
			priority: signal.priority,
			facts: signal.facts
		});
		out.push(...run.proposals);
		if (run.text && run.text !== NOTHING)
			out.push(
				saveBrief(uid, {
					title: signal.title,
					body: run.text,
					signalKey: signal.key,
					priority: signal.priority
				})
			);
	}
	return out;
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
		out.push(...(await runPrep(uid, displayName, now).catch(() => [])));
		out.push(...(await runSignals(uid, displayName, now).catch(() => [])));
	} finally {
		busy = false;
	}
	return out;
}

/**
 * Notifies about a round's new cards when they're worth it (check-in briefs,
 * follow-ups, urgent cards) and it's not quiet hours: on the desktop always, in
 * a browser only when it allowed notifications and the page isn't in view (in
 * view, the bubble is enough). Off with "Notify me" in Settings.
 */
export async function notifyAbout(
	uid: string,
	cards: InboxItem[],
	now = new Date()
): Promise<void> {
	if (!cards.length || !loadDevicePrefs().notify) return;
	const notice = noticeFor(cards, await loadAssistantConfig(uid), now);
	if (!notice) return;
	const route = `/day/${dateKey(now)}`;
	if (desktop) return desktop.notify(notice.title, notice.body, route);
	if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
	if (document.visibilityState === 'visible') return;
	const n = new Notification(notice.title, { body: notice.body, tag: 'daylog-assistant' });
	n.onclick = () => {
		focus();
		n.close();
	};
}

/** Lines looked at per run, at most. */
const CAPTURE_BATCH = 5;
let capturing: Promise<unknown> = Promise.resolve();

/**
 * Lines just typed that look like money, dates or cancellations (`capture.ts`)
 * get one short background run that proposes the matching records as cards.
 * Each line is claimed once (`assistantSignals`), so editing elsewhere on the
 * page or another device doesn't ask again. Runs one at a time. Returns the cards.
 */
export function runCapture(
	uid: string,
	displayName: string | null,
	date: string,
	candidates: Candidate[],
	now: Date = new Date()
): Promise<InboxItem[]> {
	const run = capturing.then(() => capture(uid, displayName, date, candidates, now));
	capturing = run.catch(() => {});
	return run;
}

async function capture(
	uid: string,
	displayName: string | null,
	date: string,
	candidates: Candidate[],
	now: Date
): Promise<InboxItem[]> {
	if (!candidates.length || !(await canRun())) return [];
	const config = await loadAssistantConfig(uid);
	if (!config.areas.days) return [];
	if (isOff(await loadFeedback(uid).catch(() => ({})), 'capture')) return [];
	const lines: string[] = [];
	for (const c of candidates.slice(0, CAPTURE_BATCH))
		if (await claimSignal(uid, captureKey(date, c.line), 'capture')) lines.push(c.line);
	if (!lines.length) return [];
	const run = await backgroundRun({
		uid,
		displayName,
		now,
		kind: 'capture',
		message: captureMessage(date, lines),
		signalKey: captureKey(date, lines[0]),
		priority: 1,
		facts: [
			{
				label: 'Around that day (for event ids)',
				tool: 'schedule_snapshot',
				input: { from: addDays(date, -1), to: addDays(date, 14) }
			}
		]
	});
	// Cards only; a note about typing would just be noise.
	return run.proposals;
}
