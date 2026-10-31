/**
 * Today's token spend on this device, per slot, against the limits in the
 * device prefs. Cache reads are cheap (about a tenth of normal input), so
 * they count a tenth.
 */
import { dateKey } from '../date';
import type { DevicePrefs } from './device';
import { deviceStorage, readJson, writeJson, type KV } from './storage';
import type { ModelSlot, Usage } from './types';

interface Spend {
	date: string;
	tokens: Record<ModelSlot, number>;
}

const KEY = 'daylog.ai.spend';

export const usageTokens = (u: Usage) => u.input + u.output + Math.round(u.cacheRead / 10);

export function spentToday(
	storage: KV = deviceStorage(),
	today: string = dateKey()
): Record<ModelSlot, number> {
	const spend = readJson<Spend>(storage, KEY);
	if (!spend || spend.date !== today) return { chat: 0, background: 0 };
	return { chat: spend.tokens?.chat ?? 0, background: spend.tokens?.background ?? 0 };
}

export function recordUsage(
	slot: ModelSlot,
	usage: Usage,
	storage: KV = deviceStorage(),
	today: string = dateKey()
): void {
	const tokens = spentToday(storage, today);
	tokens[slot] += usageTokens(usage);
	writeJson(storage, KEY, { date: today, tokens } satisfies Spend);
}

export function withinBudget(
	slot: ModelSlot,
	prefs: DevicePrefs,
	storage: KV = deviceStorage(),
	today: string = dateKey()
): boolean {
	return spentToday(storage, today)[slot] < prefs.dailyTokens[slot];
}

// ——— The usage log: what each kind of run cost on this device, per day, for Settings.

export type RunKind = 'chat' | 'checkin' | 'signal' | 'capture' | 'prep' | 'followup';

export const RUN_KINDS: { id: RunKind; label: string }[] = [
	{ id: 'chat', label: 'Chat' },
	{ id: 'checkin', label: 'Check-ins' },
	{ id: 'followup', label: 'Follow-ups' },
	{ id: 'signal', label: 'Suggestions' },
	{ id: 'capture', label: 'From what you typed' },
	{ id: 'prep', label: 'Prep notes' }
];

export interface KindUse {
	tokens: number;
	/** Model calls (one run can make several). */
	calls: number;
}

export interface DayUse {
	date: string;
	total: number;
	byKind: Partial<Record<RunKind, KindUse>>;
}

const LOG_KEY = 'daylog.ai.usage';
/** Days kept in the log. */
const LOG_DAYS = 30;

type Log = Record<string, Partial<Record<RunKind, KindUse>>>;

/** Adds one model call of `kind` to today's line of the log. */
export function logUsage(
	kind: RunKind,
	usage: Usage,
	storage: KV = deviceStorage(),
	today: string = dateKey()
): void {
	const log = readJson<Log>(storage, LOG_KEY) ?? {};
	const day = (log[today] ??= {});
	const use = (day[kind] ??= { tokens: 0, calls: 0 });
	use.tokens += usageTokens(usage);
	use.calls += 1;
	const keep = Object.keys(log).sort().slice(-LOG_DAYS);
	writeJson(storage, LOG_KEY, Object.fromEntries(keep.map((d) => [d, log[d]])));
}

/** The log, newest day first. */
export function usageLog(storage: KV = deviceStorage()): DayUse[] {
	const log = readJson<Log>(storage, LOG_KEY) ?? {};
	return Object.keys(log)
		.sort()
		.reverse()
		.map((date) => ({
			date,
			byKind: log[date],
			total: Object.values(log[date]).reduce((sum, u) => sum + (u?.tokens ?? 0), 0)
		}));
}
