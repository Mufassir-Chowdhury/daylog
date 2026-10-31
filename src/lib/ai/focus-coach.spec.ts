import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from './config';

const db = vi.hoisted(() => ({
	loadAssistantConfig: vi.fn(),
	listSlots: vi.fn(async () => []),
	listEvents: vi.fn(async () => []),
	listTasks: vi.fn(async () => [])
}));
const activityFor = vi.hoisted(() => vi.fn());
const desktop = vi.hoisted(() => ({ notify: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
const prefs = vi.hoisted(() => ({ focusCoach: true, notify: true }));
vi.mock('../db', () => db);
vi.mock('../desktop', () => ({ desktop }));
vi.mock('../toast.svelte', () => ({ toast }));
vi.mock('./tools/activity', () => ({ activityFor }));
vi.mock('./device', () => ({ loadDevicePrefs: () => prefs }));

const { startFocusCoach } = await import('./focus-coach');

const limitPassed = {
	goal: {
		id: 'g1',
		kind: 'subjects',
		category: 'distraction',
		keys: [],
		names: ['YouTube'],
		minutes: 30,
		limit: true
	},
	ms: 40 * 60_000,
	target: 30 * 60_000,
	ratio: 4 / 3,
	met: false
};

beforeEach(() => {
	vi.useFakeTimers({ now: new Date(2026, 10, 1, 15, 0) });
	db.loadAssistantConfig.mockResolvedValue(structuredClone(DEFAULT_CONFIG));
	activityFor.mockResolvedValue({ goals: [limitPassed], best: null, day: {}, base: {} });
	desktop.notify.mockClear();
	toast.mockClear();
	prefs.focusCoach = true;
	return () => vi.useRealTimers();
});

function run() {
	let tick = () => {};
	const stop = startFocusCoach(
		'u1',
		() => 'Jarvis',
		(cb) => {
			tick = cb;
			return () => {};
		}
	);
	return { tick: () => tick(), stop };
}

describe('startFocusCoach', () => {
	it('nudges once about a passed limit, by notification and bubble', async () => {
		const coach = run();
		coach.tick();
		await vi.waitFor(() => expect(desktop.notify).toHaveBeenCalledTimes(1));
		expect(desktop.notify).toHaveBeenCalledWith(
			'Jarvis · YouTube: limit passed',
			'40m today, against at most 30m.',
			'/activity'
		);
		expect(toast).toHaveBeenCalledWith(expect.stringContaining('limit passed'), expect.anything());
		// Later the same day, and after another hour: that nudge isn't repeated.
		vi.setSystemTime(new Date(2026, 10, 1, 16, 30));
		coach.tick();
		await vi.advanceTimersByTimeAsync(10);
		expect(desktop.notify).toHaveBeenCalledTimes(1);
	});

	it('does nothing while switched off', async () => {
		prefs.focusCoach = false;
		vi.setSystemTime(new Date(2026, 10, 2, 15, 0));
		const coach = run();
		coach.tick();
		await vi.advanceTimersByTimeAsync(10);
		expect(activityFor).not.toHaveBeenCalledWith('u1', '2026-11-02');
		expect(desktop.notify).not.toHaveBeenCalled();
	});
});
