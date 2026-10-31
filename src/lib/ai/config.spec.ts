import { describe, expect, it } from 'vitest';
import { logUsage, recordUsage, spentToday, usageLog, withinBudget } from './budget';
import { addressName, DEFAULT_CONFIG, inQuietHours, normalizeConfig } from './config';
import {
	DEFAULT_DEVICE_PREFS,
	deviceId,
	loadDevicePrefs,
	normalizeDevicePrefs,
	saveDevicePrefs
} from './device';
import { memoryStorage } from './storage';
import { keyStatus, providerFetch, saveKey } from './transport';

describe('normalizeConfig', () => {
	it('starts as Jarvis with the daily check-ins, a Thursday review and every area on', () => {
		const config = normalizeConfig(null);
		expect(config.name).toBe('Jarvis');
		expect(config.checkins.map((c) => [c.time, c.kind, c.weekday])).toEqual([
			['08:00', 'warmup', null],
			['17:00', 'brief', null],
			['20:00', 'review', 4],
			['23:15', 'wrapup', null]
		]);
		expect(Object.values(config.areas).every(Boolean)).toBe(true);
	});

	it('keeps valid stored values and repairs the rest', () => {
		const config = normalizeConfig({
			name: '  Friday ',
			checkins: [
				{ id: 'late', label: 'Late', time: '22:00', kind: 'wrapup', enabled: false },
				{ id: 'bad', time: '25:00' },
				{ id: 'early', label: '', time: '06:30', kind: 'nonsense' }
			],
			quietHours: { start: '23:00', end: 'later' },
			maxCardsPerDay: -2,
			areas: { finance: false }
		});
		expect(config.name).toBe('Friday');
		// Saved before the weekly review existed: it's added once.
		expect(config.checkins).toEqual([
			{
				id: 'early',
				label: 'Check-in',
				time: '06:30',
				kind: 'brief',
				enabled: true,
				weekday: null
			},
			{
				id: 'review',
				label: 'Weekly review',
				time: '20:00',
				kind: 'review',
				enabled: true,
				weekday: 4
			},
			{ id: 'late', label: 'Late', time: '22:00', kind: 'wrapup', enabled: false, weekday: null }
		]);
		expect(config.version).toBe(2);
		expect(config.quietHours).toEqual({ start: '23:00', end: DEFAULT_CONFIG.quietHours.end });
		expect(config.maxCardsPerDay).toBe(DEFAULT_CONFIG.maxCardsPerDay);
		expect(config.areas.finance).toBe(false);
		expect(config.areas.activity).toBe(true);
	});

	it("doesn't bring back a review you removed, and keeps a check-in's weekday", () => {
		const config = normalizeConfig({
			version: 2,
			checkins: [{ id: 'sat', label: 'Plan', time: '10:00', kind: 'brief', weekday: 6 }]
		});
		expect(config.checkins).toEqual([
			{ id: 'sat', label: 'Plan', time: '10:00', kind: 'brief', enabled: true, weekday: 6 }
		]);
		expect(
			normalizeConfig({ checkins: [{ id: 'x', time: '10:00', weekday: 9 }] }).checkins[0].weekday
		).toBeNull();
	});

	it('falls back to the default name when blank', () => {
		expect(normalizeConfig({ name: '   ' }).name).toBe('Jarvis');
	});
});

describe('addressName', () => {
	it('uses your choice, else your first name', () => {
		expect(addressName({ ...DEFAULT_CONFIG, addressAs: 'sir' }, 'Tony Stark')).toBe('sir');
		expect(addressName(DEFAULT_CONFIG, 'Mufassir Chowdhury')).toBe('Mufassir');
		expect(addressName(DEFAULT_CONFIG, null)).toBe('');
	});
});

describe('inQuietHours', () => {
	it('handles ranges that cross midnight', () => {
		const config = { ...DEFAULT_CONFIG, quietHours: { start: '23:00', end: '07:00' } };
		expect(inQuietHours(config, '23:30')).toBe(true);
		expect(inQuietHours(config, '03:00')).toBe(true);
		expect(inQuietHours(config, '07:00')).toBe(false);
		expect(inQuietHours({ ...config, quietHours: { start: '13:00', end: '14:00' } }, '13:30')).toBe(
			true
		);
	});
});

describe('device prefs', () => {
	it('round-trips and repairs bad values', () => {
		const storage = memoryStorage();
		expect(loadDevicePrefs(storage)).toEqual(DEFAULT_DEVICE_PREFS);
		const prefs = normalizeDevicePrefs({
			provider: 'gemini',
			models: { gemini: { chat: 'gemini-9-pro' } },
			dailyTokens: { chat: -1, background: 1234.4 }
		});
		expect(prefs.models.gemini).toEqual({
			chat: 'gemini-9-pro',
			background: DEFAULT_DEVICE_PREFS.models.gemini.background
		});
		expect(prefs.dailyTokens).toEqual({
			chat: DEFAULT_DEVICE_PREFS.dailyTokens.chat,
			background: 1234
		});
		saveDevicePrefs(prefs, storage);
		expect(loadDevicePrefs(storage)).toEqual(prefs);
	});
});

describe('budget', () => {
	it('counts tokens per slot per day, cache reads at a tenth', () => {
		const storage = memoryStorage();
		recordUsage('background', { input: 100, output: 50, cacheRead: 1000 }, storage, '2026-10-30');
		recordUsage('background', { input: 10, output: 0, cacheRead: 0 }, storage, '2026-10-30');
		expect(spentToday(storage, '2026-10-30')).toEqual({ chat: 0, background: 260 });
		expect(spentToday(storage, '2026-10-31')).toEqual({ chat: 0, background: 0 });

		const prefs = { ...DEFAULT_DEVICE_PREFS, dailyTokens: { chat: 10, background: 260 } };
		expect(withinBudget('background', prefs, storage, '2026-10-30')).toBe(false);
		expect(withinBudget('chat', prefs, storage, '2026-10-30')).toBe(true);
	});
});

describe('web key storage', () => {
	it('saves, reports and removes keys, and adds them to requests', async () => {
		const storage = memoryStorage();
		await saveKey('gemini', '  AIza-test ', storage);
		expect(await keyStatus(storage)).toEqual({ anthropic: false, gemini: true });

		let sent: Headers | null = null;
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit) => {
			sent = new Headers(init?.headers);
			return new Response('{}');
		}) as typeof fetch;
		try {
			await providerFetch(
				'gemini',
				storage
			)('https://generativelanguage.googleapis.com/v1beta/models');
		} finally {
			globalThis.fetch = realFetch;
		}
		expect(sent!.get('x-goog-api-key')).toBe('AIza-test');

		await saveKey('gemini', null, storage);
		expect(await keyStatus(storage)).toEqual({ anthropic: false, gemini: false });
		await expect(providerFetch('gemini', storage)('https://x')).rejects.toMatchObject({
			kind: 'no_key'
		});
	});
});

describe('deviceId', () => {
	it('is made once and lives apart from the device prefs', () => {
		const storage = memoryStorage();
		const prefs = { ...DEFAULT_DEVICE_PREFS, provider: 'gemini' as const, notify: false };
		saveDevicePrefs(prefs, storage);
		const id = deviceId(storage);
		expect(id).toMatch(/^[a-z0-9]{4,}$/);
		expect(deviceId(storage)).toBe(id);
		expect(loadDevicePrefs(storage)).toEqual(prefs);
	});
});

describe('usageLog', () => {
	it('adds up tokens and calls per kind and day, newest first, for 30 days', () => {
		const storage = memoryStorage();
		const u = { input: 1000, output: 200, cacheRead: 5000 };
		logUsage('chat', u, storage, '2026-10-30');
		logUsage('chat', u, storage, '2026-10-30');
		logUsage('checkin', u, storage, '2026-10-31');
		expect(usageLog(storage)).toEqual([
			{ date: '2026-10-31', total: 1700, byKind: { checkin: { tokens: 1700, calls: 1 } } },
			{ date: '2026-10-30', total: 3400, byKind: { chat: { tokens: 3400, calls: 2 } } }
		]);
		for (let d = 1; d <= 31; d++)
			logUsage('signal', u, storage, `2026-12-${String(d).padStart(2, '0')}`);
		const log = usageLog(storage);
		expect(log).toHaveLength(30);
		expect(log.at(-1)?.date).toBe('2026-12-02');
	});
});

describe('voice prefs', () => {
	it('default to a fast voice that reads replies, and repair bad values', () => {
		expect(normalizeDevicePrefs(null).voice).toEqual({
			voiceId: '',
			model: 'eleven_flash_v2_5',
			speakReplies: true,
			language: ''
		});
		expect(
			normalizeDevicePrefs({
				voice: { voiceId: 'abc', model: 'nope', speakReplies: false, language: 'english' }
			}).voice
		).toEqual({ voiceId: 'abc', model: 'eleven_flash_v2_5', speakReplies: false, language: '' });
	});
});
