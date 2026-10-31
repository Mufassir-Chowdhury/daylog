/**
 * Runs the focus coach (`focus.ts`) in the desktop app: every minute while
 * it's switched on for this computer, with activity re-read every 5 minutes
 * and the schedule every 10. Nudges go out as a notification and a bubble.
 * What was sent today is kept on this computer, so a restart doesn't repeat it.
 */
import { dateKey } from '../date';
import { listEvents, listSlots, listTasks, loadAssistantConfig } from '../db';
import { desktop } from '../desktop';
import { toast } from '../toast.svelte';
import { inQuietHours, type AssistantConfig } from './config';
import { loadDevicePrefs } from './device';
import { focusNudge, topTask, type Nudge } from './focus';
import { freeTime } from './freetime';
import { clock } from './scheduler';
import { deviceStorage, readJson, writeJson } from './storage';
import { activityFor } from './tools/activity';

const ACTIVITY_EVERY = 5 * 60_000;
const SCHEDULE_EVERY = 10 * 60_000;
const SENT_KEY = 'daylog.ai.focus';

interface Sent {
	date: string;
	keys: string[];
	last: number;
}

function loadSent(today: string): Sent {
	const sent = readJson<Sent>(deviceStorage(), SENT_KEY);
	return sent?.date === today ? sent : { date: today, keys: [], last: sent?.last ?? 0 };
}

/** Starts the coach; `ticks` is the desktop's minute tick. Returns a stop function. */
export function startFocusCoach(
	uid: string,
	name: () => string,
	ticks: (callback: () => void) => () => void
): () => void {
	let activity: { at: number; date: string; data: Awaited<ReturnType<typeof activityFor>> } | null =
		null;
	let schedule: {
		at: number;
		data: {
			slots: Awaited<ReturnType<typeof listSlots>>;
			events: Awaited<ReturnType<typeof listEvents>>;
			tasks: Awaited<ReturnType<typeof listTasks>>;
		};
	} | null = null;
	let config: { at: number; value: AssistantConfig } | null = null;
	let busy = false;

	async function check() {
		if (busy || !loadDevicePrefs().focusCoach) return;
		busy = true;
		try {
			const now = new Date();
			const ms = now.getTime();
			const today = dateKey(now);
			if (!config || ms - config.at > SCHEDULE_EVERY)
				config = { at: ms, value: await loadAssistantConfig(uid) };
			if (!config.value.areas.activity) return;
			if (!activity || activity.date !== today || ms - activity.at > ACTIVITY_EVERY)
				activity = { at: ms, date: today, data: await activityFor(uid, today) };
			if (!schedule || ms - schedule.at > SCHEDULE_EVERY) {
				const [slots, events, tasks] = await Promise.all([
					listSlots(uid),
					listEvents(uid),
					listTasks(uid)
				]);
				schedule = { at: ms, data: { slots, events, tasks } };
			}
			const minutes = now.getHours() * 60 + now.getMinutes();
			const [free] = freeTime(schedule.data, today, today, 60, today, minutes);
			const sent = loadSent(today);
			const nudge = focusNudge({
				now,
				today,
				goals: activity.data.goals,
				best: activity.data.best,
				free: free?.blocks ?? [],
				topTask: topTask(schedule.data.tasks, today),
				lastNudge: sent.last,
				sent: new Set(sent.keys),
				quiet: inQuietHours(config.value, clock(now))
			});
			if (!nudge) return;
			writeJson(deviceStorage(), SENT_KEY, {
				date: today,
				keys: [...sent.keys, nudge.key],
				last: ms
			} satisfies Sent);
			deliver(nudge, name());
		} catch {
			// Offline or no activity yet: try again next minute.
		} finally {
			busy = false;
		}
	}

	return ticks(check);
}

function deliver(nudge: Nudge, from: string) {
	if (loadDevicePrefs().notify)
		desktop?.notify(`${from} · ${nudge.title}`, nudge.body, '/activity');
	toast(`${nudge.title} — ${nudge.body}`, { from, duration: 10_000 });
}
