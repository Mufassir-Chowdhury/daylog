/**
 * The desktop bridge for the Tauri shell (src-tauri), with the same shape as the
 * Electron preload (desktop/preload.cjs) so the app can't tell them apart. Each
 * method is a command in src-tauri/src/commands.rs; events are emitted to this
 * window by the Rust side.
 */
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { DesktopBridge } from './desktop';

declare global {
	interface Window {
		__TAURI_INTERNALS__?: unknown;
		/** Set by the Rust side before the page loads (`process.platform` names). */
		__daylogPlatform?: string;
	}
}

/** Fire-and-forget commands still report failures somewhere useful. */
function send(cmd: string, args?: Record<string, unknown>): void {
	invoke(cmd, args).catch((e) => console.error(`desktop: ${cmd} failed`, e));
}

/** Subscribes to an event sent to this window; returns an unsubscribe function. */
function listen<T>(event: string, callback: (payload: T) => void): () => void {
	let stopped = false;
	let unlisten: (() => void) | null = null;
	getCurrentWebviewWindow()
		.listen<T>(event, (e) => callback(e.payload))
		.then((off) => {
			if (stopped) off();
			else unlisten = off;
		})
		.catch((e) => console.error(`desktop: listening for ${event} failed`, e));
	return () => {
		stopped = true;
		unlisten?.();
	};
}

export function tauriBridge(): DesktopBridge {
	return {
		platform: window.__daylogPlatform ?? 'unknown',
		hide: () => send('window_hide'),
		minimize: () => send('window_minimize'),
		toggleMaximize: () => send('window_toggle_maximize'),
		setTitleBarColors: (color, symbolColor) => send('titlebar_colors', { color, symbolColor }),
		quickHide: () => send('quick_hide'),
		quickNavigate: (route) => send('quick_navigate', { route }),
		quickCapture: (entry) => send('quick_capture', { entry }),
		setReminders: (list) => send('reminders_set', { list }),
		startGoogleSignIn: () => send('auth_google_start'),
		onGoogleCredential: (callback) => listen('auth:google', callback),
		getPrefs: () => invoke('prefs_get'),
		setPrefs: (patch) => invoke('prefs_set', { patch }),
		activityStatus: () => invoke('activity_status'),
		setActivity: (patch) => invoke('activity_set', { patch }),
		activityDays: (from, to) => invoke('activity_days', { from, to }),
		clearActivity: () => invoke('activity_clear'),
		updateStatus: () => invoke('update_status'),
		checkForUpdates: () => invoke('update_check'),
		installUpdate: () => send('update_install'),
		onUpdateStatus: (callback) => listen('update:status', callback),
		onNavigate: (callback) => listen('navigate', callback),
		onCapture: (callback) => listen('capture', callback),
		onQuickOpen: (callback) => listen('quick:open', () => callback())
	};
}
