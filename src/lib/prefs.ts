import type { TransactionKind } from './db';

/**
 * Per-device conveniences kept in localStorage — the last transaction kind and
 * accounts used, and recently typed categories and groups. Losing these is harmless, so
 * every access is guarded (private mode, blocked storage).
 */
export interface TxnPrefs {
	kind: TransactionKind;
	from: string;
	to: string;
	/** Most recent first, per kind. */
	recent: Partial<Record<TransactionKind, string[]>>;
	/** Recently used group labels, most recent first. */
	groups: string[];
}

const KEY = 'daylog-txn-prefs';
const DEFAULTS: TxnPrefs = { kind: 'expense', from: '', to: '', recent: {}, groups: [] };

export function loadTxnPrefs(): TxnPrefs {
	try {
		const raw = localStorage.getItem(KEY);
		return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<TxnPrefs>) } : { ...DEFAULTS };
	} catch {
		return { ...DEFAULTS };
	}
}

export function saveTxnPrefs(prefs: TxnPrefs): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(prefs));
	} catch {
		/* storage unavailable — defaults next time */
	}
}

/** Moves `category` to the front of the kind's recent list (max 12). */
export function rememberCategory(prefs: TxnPrefs, kind: TransactionKind, category: string): void {
	const list = (prefs.recent[kind] ?? []).filter((c) => c !== category);
	prefs.recent[kind] = [category, ...list].slice(0, 12);
}

/** Moves `group` to the front of the recent groups (max 12). */
export function rememberGroup(prefs: TxnPrefs, group: string): void {
	prefs.groups = [group, ...prefs.groups.filter((g) => g !== group)].slice(0, 12);
}
