/**
 * Assistant settings that belong to one device rather than your account: which
 * provider and models this device uses, and its daily token limits. They sit
 * next to the API key, which is per device too.
 */
import { deviceStorage, readJson, writeJson, type KV } from './storage';
import type { ModelSlot, ProviderId } from './types';

/**
 * Used until you test the connection, which picks from the provider's live list.
 * Gemini ids change often; the live list wins.
 */
export const DEFAULT_MODELS: Record<ProviderId, Record<ModelSlot, string>> = {
	anthropic: { chat: 'claude-opus-5-5', background: 'claude-haiku-5-5' },
	gemini: { chat: 'gemini-3.1-pro-preview', background: 'gemini-3.5-flash' }
};

export interface DevicePrefs {
	provider: ProviderId;
	/** Model per slot, remembered per provider so switching back keeps your picks. */
	models: Record<ProviderId, Record<ModelSlot, string>>;
	/** Tokens a day this device may spend per slot; the assistant stops when it's used up. */
	dailyTokens: Record<ModelSlot, number>;
	/** Notify on this device about check-ins and urgent suggestions (desktop, or a browser that allowed it). */
	notify: boolean;
}

export const DEFAULT_DEVICE_PREFS: DevicePrefs = {
	provider: 'anthropic',
	models: DEFAULT_MODELS,
	dailyTokens: { chat: 1_000_000, background: 300_000 },
	notify: true
};

const KEY = 'daylog.ai.device';

const isProvider = (v: unknown): v is ProviderId => v === 'anthropic' || v === 'gemini';
const text = (v: unknown, fallback: string) =>
	typeof v === 'string' && v.trim() ? v.trim() : fallback;
const count = (v: unknown, fallback: number) =>
	typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : fallback;

/** Stored prefs over the defaults; anything missing or malformed falls back. */
export function normalizeDevicePrefs(raw: unknown): DevicePrefs {
	const r = (raw ?? {}) as Partial<DevicePrefs>;
	const d = DEFAULT_DEVICE_PREFS;
	const models = (p: ProviderId) => ({
		chat: text(r.models?.[p]?.chat, d.models[p].chat),
		background: text(r.models?.[p]?.background, d.models[p].background)
	});
	return {
		provider: isProvider(r.provider) ? r.provider : d.provider,
		models: { anthropic: models('anthropic'), gemini: models('gemini') },
		dailyTokens: {
			chat: count(r.dailyTokens?.chat, d.dailyTokens.chat),
			background: count(r.dailyTokens?.background, d.dailyTokens.background)
		},
		notify: typeof r.notify === 'boolean' ? r.notify : d.notify
	};
}

export function loadDevicePrefs(storage: KV = deviceStorage()): DevicePrefs {
	return normalizeDevicePrefs(readJson(storage, KEY));
}

export function saveDevicePrefs(prefs: DevicePrefs, storage: KV = deviceStorage()): void {
	writeJson(storage, KEY, prefs);
}

// Not `KEY`: that one holds the prefs.
const ID_KEY = 'daylog.ai.deviceId';

/** A random id for this device (browser profile or desktop app), made once. */
export function deviceId(storage: KV = deviceStorage()): string {
	let id = storage.getItem(ID_KEY);
	if (!id) {
		id = Math.random().toString(36).slice(2, 10);
		storage.setItem(ID_KEY, id);
	}
	return id;
}
