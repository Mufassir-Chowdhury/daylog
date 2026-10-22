/**
 * Uploads this computer's recorded activity (kept by the desktop shell, see
 * desktop/activity.cjs) to the user's account, one doc per day, so the
 * Activity page shows it on every device. Runs in the main window, which
 * stays loaded while hidden in the tray.
 */
import { addDays, dateKey } from './date';
import { saveActivityDay } from './db';
import { desktop, type ActivitySpan } from './desktop';

const EVERY = 3 * 60_000;
/** Stay well under Firestore's 1 MiB document limit. */
const MAX_DOC_CHARS = 700_000;

const storageKey = (uid: string) => `daylog-activity-synced:${uid}`;

/** What was last uploaded per day, as a cheap fingerprint of the spans. */
function loadSynced(uid: string): Record<string, string> {
	try {
		return JSON.parse(localStorage.getItem(storageKey(uid)) ?? '{}');
	} catch {
		return {};
	}
}

function saveSynced(uid: string, synced: Record<string, string>) {
	try {
		localStorage.setItem(storageKey(uid), JSON.stringify(synced));
	} catch {
		/* not remembered — the next run just uploads again */
	}
}

/** Forget what was uploaded (after deleting everything), so nothing is skipped later. */
export function forgetSynced(uid: string) {
	try {
		localStorage.removeItem(storageKey(uid));
	} catch {
		/* nothing to forget */
	}
}

const fingerprint = (spans: ActivitySpan[]) =>
	`${spans.length}:${spans[0]?.s ?? 0}:${spans[spans.length - 1]?.e ?? 0}`;

/** Drops window titles from the shortest spans until the day fits in one document. */
export function fitSpans(spans: ActivitySpan[], limit = MAX_DOC_CHARS): ActivitySpan[] {
	if (JSON.stringify(spans).length <= limit) return spans;
	const out = spans.map((s) => ({ ...s }));
	const byLength = [...out].sort((a, b) => a.e - a.s - (b.e - b.s));
	for (const span of byLength) {
		delete span.title;
		if (JSON.stringify(out).length <= limit) break;
	}
	return out;
}

/** Starts uploading in the background; returns a stop function. */
export function startActivitySync(uid: string): () => void {
	const bridge = desktop;
	if (!bridge) return () => {};
	let running = false;
	const run = async () => {
		if (running) return;
		running = true;
		try {
			const status = await bridge.activityStatus();
			if (!status) return;
			const today = dateKey();
			const days = await bridge.activityDays(addDays(today, -status.retentionDays), today);
			const synced = loadSynced(uid);
			for (const [date, spans] of Object.entries(days).sort()) {
				const print = fingerprint(spans);
				if (synced[date] === print) continue;
				await saveActivityDay(uid, {
					date,
					device: status.device.id,
					deviceName: status.device.name,
					spans: fitSpans(spans)
				});
				synced[date] = print;
				saveSynced(uid, synced);
			}
		} catch {
			/* offline or signed out — the next run catches up */
		} finally {
			running = false;
		}
	};
	run();
	const timer = setInterval(run, EVERY);
	return () => clearInterval(timer);
}
