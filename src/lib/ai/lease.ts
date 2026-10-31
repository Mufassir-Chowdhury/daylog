/**
 * Which open device looks after the check-ins: the one holding the lease
 * (`assistant/lease`). Holders renew it every minute; it lapses three minutes
 * after the last renewal, so a device that closes hands over on its own.
 * The desktop app is preferred because it's always on: it takes the lease
 * from a web tab, never the other way round. Everything here is pure.
 */

export type HolderKind = 'desktop' | 'web';

export interface Lease {
	/** The holding page: device id plus a per-page suffix, so two tabs differ. */
	holder: string;
	kind: HolderKind;
	/** Lapses at this time, ms since the epoch. */
	until: number;
}

export const LEASE_FOR = 3 * 60_000;
export const RENEW_EVERY = 60_000;

/** Whether `me` may take (or keep) the lease at `now`. */
export function mayTake(
	current: Lease | null,
	me: { holder: string; kind: HolderKind },
	now: number
): boolean {
	if (!current || current.until <= now) return true;
	if (current.holder === me.holder) return true;
	return current.kind === 'web' && me.kind === 'desktop';
}
