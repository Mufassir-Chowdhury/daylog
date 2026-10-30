/**
 * Per-device storage for the assistant (keys on the web, model picks, today's
 * token count). localStorage can be missing or throw (private windows, blocked
 * site data), so every access is guarded and falls back to memory.
 */

export type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function memoryStorage(): KV {
	const map = new Map<string, string>();
	return {
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v),
		removeItem: (k) => void map.delete(k)
	};
}

let fallback: KV | null = null;

/** localStorage when it works, otherwise an in-memory stand-in for this session. */
export function deviceStorage(): KV {
	try {
		const probe = '__daylog_probe__';
		localStorage.setItem(probe, '1');
		localStorage.removeItem(probe);
		return localStorage;
	} catch {
		return (fallback ??= memoryStorage());
	}
}

export function readJson<T>(storage: KV, key: string): T | null {
	try {
		const raw = storage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

export function writeJson(storage: KV, key: string, value: unknown): void {
	try {
		storage.setItem(key, JSON.stringify(value));
	} catch {
		// Full or blocked — the setting just won't stick.
	}
}
