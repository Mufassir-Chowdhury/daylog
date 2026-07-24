/** Visual themes — each is a `data-theme` value on <html> that swaps the CSS token set. */
export const THEMES = [
	'light',
	'dark',
	'geo-light',
	'geo-dark',
	'tech-light',
	'tech-dark'
] as const;
export type Theme = (typeof THEMES)[number];

/** User-tunable app options, persisted per user at `users/{uid}/settings/app`. */
export interface AppSettings {
	/** Visual theme applied app-wide. */
	theme: Theme;
	/** Symbol shown before money amounts, e.g. ৳ or $. */
	currency: string;
	/** Digit grouping for money: lakh/crore (1,50,000) or thousands (150,000). */
	grouping: 'lakh' | 'thousand';
	/** Panels shown on day pages. */
	showNotePanel: boolean;
	showLongTermPanel: boolean;
	showFinancePanel: boolean;
	showRoutinePanel: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
	theme: 'light',
	currency: '৳',
	grouping: 'lakh',
	showNotePanel: true,
	showLongTermPanel: true,
	showFinancePanel: true,
	showRoutinePanel: true
};

/** Live settings — readable anywhere; the root layout applies the stored doc on sign-in. */
export const settings: AppSettings = $state({ ...DEFAULT_SETTINGS });

/**
 * Resets to defaults, then overlays whatever the stored doc has — missing or
 * malformed keys keep their default, so old docs and foreign fields are safe.
 */
export function applySettings(stored: Partial<AppSettings>): void {
	const next: AppSettings = { ...DEFAULT_SETTINGS };
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[])
		take(next, key, stored[key]);
	Object.assign(settings, next);
}

function take<K extends keyof AppSettings>(next: AppSettings, key: K, value: unknown): void {
	if (value === undefined || typeof value !== typeof DEFAULT_SETTINGS[key]) return;
	if (key === 'grouping' && value !== 'lakh' && value !== 'thousand') return;
	if (key === 'theme' && !THEMES.includes(value as Theme)) return;
	next[key] = value as AppSettings[K];
}
