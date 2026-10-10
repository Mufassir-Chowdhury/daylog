/** Visual themes — each is a `data-theme` value on <html> that swaps the CSS token set. */
export const THEMES = [
	'light',
	'dark',
	'geo-light',
	'geo-dark',
	'tech-light',
	'tech-dark',
	'jarvis-light',
	'jarvis-dark'
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
	showPlanPanel: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
	theme: 'light',
	currency: '৳',
	grouping: 'lakh',
	showNotePanel: true,
	showLongTermPanel: true,
	showFinancePanel: true,
	showRoutinePanel: true,
	showPlanPanel: true
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

/** The light/dark sibling of a theme (`geo-dark` ↔ `geo-light`). */
export function counterpartTheme(theme: Theme): Theme {
	if (theme === 'light') return 'dark';
	if (theme === 'dark') return 'light';
	return (
		theme.endsWith('-dark') ? theme.replace(/-dark$/, '-light') : theme.replace(/-light$/, '-dark')
	) as Theme;
}

/**
 * Per-device theme override. The desktop app defaults to the Jarvis theme
 * whatever the account theme is, so the web app keeps its own look; 'account'
 * follows the synced setting. Kept in localStorage.
 */
export type DeviceTheme = Theme | 'account';

const DEVICE_THEME_KEY = 'daylog-device-theme';

export const device: { theme: DeviceTheme } = $state({ theme: 'account' });

/** Restores this device's override; `fallback` applies when none was ever chosen. */
export function loadDeviceTheme(fallback: DeviceTheme): void {
	let stored: string | null = null;
	try {
		stored = localStorage.getItem(DEVICE_THEME_KEY);
	} catch {
		/* storage blocked — use the fallback */
	}
	device.theme =
		stored === 'account' || THEMES.includes(stored as Theme) ? (stored as DeviceTheme) : fallback;
}

export function setDeviceTheme(theme: DeviceTheme): void {
	device.theme = theme;
	try {
		localStorage.setItem(DEVICE_THEME_KEY, theme);
	} catch {
		/* storage blocked — applies for this session */
	}
}

/** The theme actually on screen. */
export function effectiveTheme(): Theme {
	return device.theme === 'account' ? settings.theme : device.theme;
}
