/**
 * The desktop bridge to the Tauri shell (src-tauri). Each method is a command in
 * src-tauri/src/commands.rs; events are emitted to this window by the Rust side.
 */
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
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

/**
 * Window behaviour the frameless main window needs from the page: dragging by
 * the title bar (`.desk-titlebar`, except its controls), double-click to
 * maximize, and the dev-tools and reload keys. Zoom keys are the webview's own
 * (`zoom_hotkeys_enabled`).
 */
function installWindowChrome(): void {
	const inTitleBar = (target: EventTarget | null) =>
		target instanceof Element &&
		!!target.closest('.desk-titlebar') &&
		!target.closest('button, a, input, kbd');
	// Dragging starts on the first move, not on mousedown: once the OS has the
	// mouse it swallows the second click of a double-click.
	let pressed = false;
	window.addEventListener('mousedown', (e) => {
		pressed = e.button === 0 && inTitleBar(e.target);
	});
	window.addEventListener('mouseup', () => (pressed = false));
	window.addEventListener('mousemove', (e) => {
		if (!pressed || !(e.buttons & 1)) return;
		pressed = false;
		getCurrentWindow()
			.startDragging()
			.catch(() => {});
	});
	window.addEventListener('dblclick', (e) => {
		if (inTitleBar(e.target)) send('window_toggle_maximize');
	});
	window.addEventListener('keydown', (e) => {
		const ctrl = e.ctrlKey || e.metaKey;
		const key = e.key.toLowerCase();
		if (e.key === 'F12' || (ctrl && e.shiftKey && key === 'i')) send('devtools_toggle');
		else if (ctrl && !e.shiftKey && !e.altKey && key === 'r') location.reload();
		else return;
		e.preventDefault();
	});
}

export function tauriBridge(): DesktopBridge {
	installWindowChrome();
	const platform = window.__daylogPlatform ?? 'unknown';
	return {
		platform,
		// macOS keeps its traffic lights (an overlay title bar); elsewhere there's no native frame.
		captionButtons: platform !== 'darwin',
		isMaximized: () => getCurrentWindow().isMaximized(),
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
		onQuickOpen: (callback) => listen('quick:open', () => callback()),
		notify: (title, body, route) => send('notify_show', { title, body, route }),
		onAssistantTick: (callback) => listen('assistant:tick', () => callback()),
		aiFetch: (request) => invoke('ai_fetch', { request }),
		aiKeys: () => invoke('ai_keys'),
		setAiKey: (provider, key) => invoke('ai_key_set', { provider, key }),
		voiceSpeak: (request) => invoke<ArrayBuffer>('voice_speak', { request }),
		voiceTranscribe: (audio, { mime, model, language }) =>
			invoke<string>('voice_transcribe', audio, {
				headers: {
					'x-mime': mime,
					'x-model': model,
					...(language ? { 'x-language': language } : {})
				}
			})
	};
}
