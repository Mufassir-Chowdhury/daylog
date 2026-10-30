/**
 * Assistant settings that follow your account across devices: its name and
 * manner, the scheduled check-ins, quiet hours and what it may look at.
 * Defaults come from docs/assistant/decisions.md.
 */

export type CheckinKind = 'warmup' | 'brief' | 'wrapup';

export const CHECKIN_KINDS: { id: CheckinKind; label: string; hint: string }[] = [
	{ id: 'warmup', label: 'Warm-up', hint: "what's up for the day" },
	{ id: 'brief', label: 'Brief', hint: "what's left today and what's next" },
	{ id: 'wrapup', label: 'Wrap-up', hint: 'how the day went and what moves to tomorrow' }
];

export interface Checkin {
	id: string;
	label: string;
	/** `HH:MM`, 24-hour, local time. */
	time: string;
	kind: CheckinKind;
	enabled: boolean;
}

export const DATA_AREAS = [
	{ id: 'days', label: 'Day pages' },
	{ id: 'people', label: 'People' },
	{ id: 'notes', label: 'Notes' },
	{ id: 'longterm', label: 'Long-term tasks' },
	{ id: 'routines', label: 'Routines' },
	{ id: 'schedule', label: 'Schedule, tasks and deadlines' },
	{ id: 'finance', label: 'Finance' },
	{ id: 'activity', label: 'Activity (including window titles)' }
] as const;

export type DataArea = (typeof DATA_AREAS)[number]['id'];

export interface AssistantConfig {
	/** What the assistant is called, everywhere it speaks. */
	name: string;
	/** How it addresses you; empty means your first name. */
	addressAs: string;
	checkins: Checkin[];
	/** No notifications between these times (the Inbox still fills). */
	quietHours: { start: string; end: string };
	/** Unprompted cards a day, outside the scheduled check-ins. */
	maxCardsPerDay: number;
	/** Which parts of the app it may read and send to the provider. */
	areas: Record<DataArea, boolean>;
	/**
	 * Per write tool: `auto` applies at once (with an Undo bubble), `ask` makes a card.
	 * Tools not listed follow their default — small additions auto, the rest ask.
	 */
	permissions: Record<string, Permission>;
}

export type Permission = 'auto' | 'ask';

export const DEFAULT_CHECKINS: Checkin[] = [
	{ id: 'warmup', label: 'Morning warm-up', time: '08:00', kind: 'warmup', enabled: true },
	{ id: 'evening', label: 'Evening brief', time: '17:00', kind: 'brief', enabled: true },
	{ id: 'night', label: 'Night brief', time: '23:15', kind: 'wrapup', enabled: true }
];

export const DEFAULT_CONFIG: AssistantConfig = {
	name: 'Jarvis',
	addressAs: '',
	checkins: DEFAULT_CHECKINS,
	quietHours: { start: '00:00', end: '07:30' },
	maxCardsPerDay: 5,
	areas: Object.fromEntries(DATA_AREAS.map((a) => [a.id, true])) as Record<DataArea, boolean>,
	permissions: {}
};

export const isTime = (v: unknown): v is string =>
	typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

const text = (v: unknown, fallback: string, max = 40) =>
	typeof v === 'string' ? v.trim().slice(0, max) || fallback : fallback;

function normalizeCheckin(raw: unknown, i: number): Checkin | null {
	const r = (raw ?? {}) as Partial<Checkin>;
	if (!isTime(r.time)) return null;
	return {
		id: text(r.id, `checkin-${i}`),
		label: text(r.label, 'Check-in'),
		time: r.time,
		kind: CHECKIN_KINDS.some((k) => k.id === r.kind) ? r.kind! : 'brief',
		enabled: r.enabled !== false
	};
}

/** Stored config over the defaults; anything missing or malformed falls back. */
export function normalizeConfig(raw: unknown): AssistantConfig {
	const r = (raw ?? {}) as Partial<AssistantConfig>;
	const d = DEFAULT_CONFIG;
	const checkins = Array.isArray(r.checkins)
		? r.checkins.map(normalizeCheckin).filter((c): c is Checkin => c !== null)
		: d.checkins;
	const max = Number(r.maxCardsPerDay);
	return {
		name: text(r.name, d.name, 24),
		addressAs: typeof r.addressAs === 'string' ? r.addressAs.trim().slice(0, 40) : '',
		checkins: sortCheckins(checkins),
		quietHours: {
			start: isTime(r.quietHours?.start) ? r.quietHours.start : d.quietHours.start,
			end: isTime(r.quietHours?.end) ? r.quietHours.end : d.quietHours.end
		},
		maxCardsPerDay:
			Number.isFinite(max) && max >= 0 ? Math.min(Math.round(max), 50) : d.maxCardsPerDay,
		areas: Object.fromEntries(DATA_AREAS.map((a) => [a.id, r.areas?.[a.id] !== false])) as Record<
			DataArea,
			boolean
		>,
		permissions: Object.fromEntries(
			Object.entries(r.permissions ?? {}).filter(
				([name, p]) => /^[a-z_]{1,40}$/.test(name) && (p === 'auto' || p === 'ask')
			)
		) as Record<string, Permission>
	};
}

export function sortCheckins(checkins: Checkin[]): Checkin[] {
	return checkins.slice().sort((a, b) => a.time.localeCompare(b.time));
}

/** How the assistant addresses you: your choice, else your first name. */
export function addressName(
	config: AssistantConfig,
	displayName: string | null | undefined
): string {
	return config.addressAs || displayName?.trim().split(/\s+/)[0] || '';
}

/** Whether `time` (`HH:MM`) falls in quiet hours; the range may cross midnight. */
export function inQuietHours(config: AssistantConfig, time: string): boolean {
	const { start, end } = config.quietHours;
	if (start === end) return false;
	return start < end ? time >= start && time < end : time >= start || time < end;
}

/** Whether a write tool's changes apply at once or wait on a card. */
export function permissionFor(config: AssistantConfig, tool: string, small: boolean): Permission {
	return config.permissions[tool] ?? (small ? 'auto' : 'ask');
}
