/**
 * Where provider keys live and how requests leave the app.
 *
 * - Web: the key is kept in this browser's local storage and the request goes
 *   straight from the page to the provider.
 * - Desktop: the key is in the OS credential store and the Rust shell sends the
 *   request (src-tauri/src/ai.rs), adding the key itself — the page never
 *   holds it.
 *
 * Either way the key is never synced to your account.
 */
import { desktop } from '../desktop';
import { deviceStorage, type KV } from './storage';
import { AiError, type ProviderId } from './types';

const KEY_HEADER: Record<ProviderId, string> = {
	anthropic: 'x-api-key',
	gemini: 'x-goog-api-key'
};

const storageKey = (provider: ProviderId) => `daylog.ai.key.${provider}`;

const noKey = () =>
	new AiError('no_key', 'No API key on this device yet — add one in Settings → Assistant.');

/** Which providers have a key on this device. */
export async function keyStatus(
	storage: KV = deviceStorage()
): Promise<Record<ProviderId, boolean>> {
	if (desktop) {
		const keys = await desktop.aiKeys();
		return { anthropic: !!keys.anthropic, gemini: !!keys.gemini };
	}
	return {
		anthropic: !!storage.getItem(storageKey('anthropic')),
		gemini: !!storage.getItem(storageKey('gemini'))
	};
}

/** Saves a key on this device, or removes it with null. Throws when the OS store refuses. */
export async function saveKey(
	provider: ProviderId,
	key: string | null,
	storage: KV = deviceStorage()
): Promise<void> {
	const value = key?.trim() || null;
	if (desktop) {
		const result = await desktop.setAiKey(provider, value);
		if (!result.ok) throw new Error(result.error ?? 'Could not save the key');
		return;
	}
	if (value) storage.setItem(storageKey(provider), value);
	else storage.removeItem(storageKey(provider));
}

/** A `fetch` for one provider's API that adds that provider's key on the way out. */
export function providerFetch(provider: ProviderId, storage: KV = deviceStorage()): typeof fetch {
	if (desktop) return desktopFetch(provider);
	return async (input, init) => {
		const key = storage.getItem(storageKey(provider));
		if (!key) throw noKey();
		const headers = new Headers(init?.headers);
		headers.set(KEY_HEADER[provider], key);
		return fetch(input, { ...init, headers });
	};
}

function desktopFetch(provider: ProviderId): typeof fetch {
	const bridge = desktop!;
	return async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((value, name) => (headers[name] = value));
		const body =
			init?.body == null
				? null
				: typeof init.body === 'string'
					? init.body
					: await new Response(init.body).text();
		let res;
		try {
			res = await bridge.aiFetch({
				provider,
				url,
				method: init?.method ?? 'GET',
				headers,
				body
			});
		} catch (e) {
			const message = String(e);
			throw message.includes('No API key') ? noKey() : new TypeError(message);
		}
		// These statuses can't carry a body in a Response.
		const empty = [101, 204, 205, 304].includes(res.status);
		return new Response(empty ? null : res.body, { status: res.status, headers: res.headers });
	};
}
