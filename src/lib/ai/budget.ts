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
