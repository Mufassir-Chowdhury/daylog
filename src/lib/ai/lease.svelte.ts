/**
 * Holding the check-in lease while this page is open: try to take it every
 * minute (renewing it when held), give it up when the page closes, and know
 * when another device took it. Only a page that could run a check-in — a key
 * for its provider and background budget left — competes for it.
 */
import { releaseLease, takeLease, watchLease } from '../db';
import { withinBudget } from './budget';
import { deviceId, loadDevicePrefs } from './device';
import { RENEW_EVERY, type HolderKind, type Lease } from './lease';
import { keyStatus } from './transport';

export const lease = $state({
	/** This page holds the lease. */
	held: false,
	/** Whoever holds it, as last seen. */
	current: null as Lease | null
});

/** This page, as a lease holder: the device plus a per-page suffix, so two tabs differ. */
export const holderId = `${deviceId()}:${Math.random().toString(36).slice(2, 8)}`;

/** Whether this device could run a check-in at all. */
export async function canRunCheckins(): Promise<boolean> {
	const prefs = loadDevicePrefs();
	return withinBudget('background', prefs) && (await keyStatus())[prefs.provider];
}

export interface LeaseOptions {
	kind: HolderKind;
	/** Called after each minute the lease is held, and on coming back to the tab. */
	onHeld?: () => void;
	eligible?: () => Promise<boolean>;
	/**
	 * Extra wake-ups from outside the page (the desktop app's minute tick), for
	 * when the page's own timer is throttled. Returns an unsubscribe function.
	 */
	ticks?: (callback: () => void) => () => void;
}

/** Competes for the lease until the returned function is called. */
export function startLease(uid: string, opts: LeaseOptions): () => void {
	const eligible = opts.eligible ?? canRunCheckins;
	let stopped = false;
	let last = 0;

	async function tick() {
		if (stopped) return;
		last = Date.now();
		const can = await eligible().catch(() => false);
		if (!can) {
			if (lease.held) releaseLease(uid, holderId).catch(() => {});
			lease.held = false;
			return;
		}
		lease.held = await takeLease(uid, holderId, opts.kind).catch(() => false);
		if (lease.held && !stopped) opts.onHeld?.();
	}

	const unwatch = watchLease(uid, (current) => {
		lease.current = current;
		// Taken over (by the desktop app) or lapsed while this page was asleep.
		if (lease.held && current?.holder !== holderId) lease.held = false;
	});
	const release = () => {
		if (lease.held) releaseLease(uid, holderId).catch(() => {});
		lease.held = false;
	};
	// Hidden tabs' timers are slowed down; check again on coming back.
	const onVisible = () => {
		if (document.visibilityState === 'visible' && Date.now() - last > 30_000) tick();
	};
	tick();
	const timer = setInterval(tick, RENEW_EVERY);
	// A tick right after the page's own one would only repeat it.
	const offTicks = opts.ticks?.(() => {
		if (Date.now() - last > 5_000) tick();
	});
	addEventListener('pagehide', release);
	addEventListener('visibilitychange', onVisible);

	return () => {
		stopped = true;
		clearInterval(timer);
		offTicks?.();
		removeEventListener('pagehide', release);
		removeEventListener('visibilitychange', onVisible);
		unwatch();
		release();
	};
}
