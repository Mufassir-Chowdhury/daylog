import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEASE_FOR, mayTake, RENEW_EVERY, type Lease } from './lease';

const db = vi.hoisted(() => ({
	takeLease: vi.fn<(uid: string, holder: string, kind: string) => Promise<boolean>>(),
	releaseLease: vi.fn(async () => {}),
	watchLease: vi.fn<(uid: string, cb: (lease: Lease | null) => void) => () => void>()
}));
vi.mock('../db', () => db);
vi.mock('./transport', () => ({ keyStatus: async () => ({ anthropic: true, gemini: false }) }));

const { holderId, lease, startLease } = await import('./lease.svelte');

describe('mayTake', () => {
	const web = { holder: 'a:1', kind: 'web' as const };
	const desktop = { holder: 'b:1', kind: 'desktop' as const };
	const held = (by: { holder: string; kind: 'web' | 'desktop' }, until = 1000): Lease => ({
		...by,
		until
	});

	it('takes a free or lapsed lease and keeps its own', () => {
		expect(mayTake(null, web, 0)).toBe(true);
		expect(mayTake(held(desktop, 1000), web, 1000)).toBe(true);
		expect(mayTake(held(web, 5000), web, 1000)).toBe(true);
	});

	it('lets the desktop app take over from a web tab, never the reverse', () => {
		expect(mayTake(held(web, 5000), desktop, 1000)).toBe(true);
		expect(mayTake(held(desktop, 5000), web, 1000)).toBe(false);
		expect(mayTake(held({ holder: 'c:1', kind: 'web' }, 5000), web, 1000)).toBe(false);
	});
});

describe('startLease', () => {
	let push: (lease: Lease | null) => void = () => {};

	beforeEach(() => {
		vi.useFakeTimers();
		// The node test runner has no window.
		vi.stubGlobal('addEventListener', vi.fn());
		vi.stubGlobal('removeEventListener', vi.fn());
		db.takeLease.mockReset().mockResolvedValue(true);
		db.releaseLease.mockClear();
		db.watchLease.mockReset().mockImplementation((_uid, cb) => {
			push = cb;
			return () => {};
		});
		lease.held = false;
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('takes the lease, renews it every minute and gives it up when stopped', async () => {
		const onHeld = vi.fn();
		const stop = startLease('u1', { kind: 'web', onHeld, eligible: async () => true });
		await vi.waitFor(() => expect(lease.held).toBe(true));
		expect(db.takeLease).toHaveBeenCalledWith('u1', holderId, 'web');
		await vi.advanceTimersByTimeAsync(RENEW_EVERY);
		expect(db.takeLease).toHaveBeenCalledTimes(2);
		expect(onHeld).toHaveBeenCalledTimes(2);
		stop();
		expect(db.releaseLease).toHaveBeenCalledWith('u1', holderId);
		expect(lease.held).toBe(false);
	});

	it('notices when the desktop app takes over', async () => {
		const stop = startLease('u1', { kind: 'web', eligible: async () => true });
		await vi.waitFor(() => expect(lease.held).toBe(true));
		push({ holder: 'other:1', kind: 'desktop', until: Date.now() + LEASE_FOR });
		expect(lease.held).toBe(false);
		stop();
		expect(db.releaseLease).not.toHaveBeenCalled();
	});

	it("doesn't compete when it couldn't run a check-in", async () => {
		const stop = startLease('u1', { kind: 'web', eligible: async () => false });
		await vi.advanceTimersByTimeAsync(RENEW_EVERY * 2);
		expect(db.takeLease).not.toHaveBeenCalled();
		expect(lease.held).toBe(false);
		stop();
	});
});
