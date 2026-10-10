/**
 * Typed access to the Electron bridge (desktop/preload.cjs). In the web build
 * `desktop` is null, so every caller degrades to plain web behaviour.
 */

/** A line to append to a day, sent from the quick bar to the main window. */
export interface CaptureEntry {
	date: string;
	line: string;
}

/** A reminder handed to the main process, which owns the timers. */
export interface Reminder {
	/** Epoch millis. */
	at: number;
	title: string;
	body: string;
	/** Route to open when the notification is clicked. */
	route: string;
}

export interface DesktopPrefs {
	summonKey: string;
	quickKey: string;
	launchAtLogin: boolean;
	canLaunchAtLogin: boolean;
	/** Hotkeys the OS refused to register (taken by another app). */
	failed: string[];
}

/** Google tokens from the system-browser sign-in (see src/routes/desktop-auth). */
export interface GoogleTokens {
	idToken: string | null;
	accessToken: string | null;
}

export interface DesktopBridge {
	platform: string;
	hide(): void;
	minimize(): void;
	toggleMaximize(): void;
	setTitleBarColors(color: string, symbolColor: string): void;
	quickHide(): void;
	quickNavigate(route: string): void;
	quickCapture(entry: CaptureEntry): void;
	setReminders(list: Reminder[]): void;
	/** Opens Google sign-in in the default browser; tokens arrive via onGoogleCredential. */
	startGoogleSignIn(): void;
	getPrefs(): Promise<DesktopPrefs>;
	setPrefs(
		patch: Partial<Pick<DesktopPrefs, 'summonKey' | 'quickKey' | 'launchAtLogin'>>
	): Promise<{ ok: boolean; error?: string }>;
	onNavigate(callback: (route: string) => void): () => void;
	onCapture(callback: (entry: CaptureEntry) => void): () => void;
	onQuickOpen(callback: () => void): () => void;
	onGoogleCredential(callback: (tokens: GoogleTokens) => void): () => void;
}

declare global {
	interface Window {
		daylogDesktop?: DesktopBridge;
	}
}

export const desktop: DesktopBridge | null =
	typeof window !== 'undefined' ? (window.daylogDesktop ?? null) : null;

/** `Control+Alt+Space` → `Ctrl + Alt + Space`, for display. */
export function prettyAccelerator(accel: string): string {
	return accel.replace(/Control|CommandOrControl/g, 'Ctrl').replace(/\+/g, ' + ');
}

/**
 * Turns a keydown into an Electron accelerator string, or null while only
 * modifiers are held. Requires at least one modifier — a bare global hotkey
 * would swallow that key in every other app.
 */
export function acceleratorFromEvent(e: KeyboardEvent): string | null {
	if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
	const mods = [
		e.ctrlKey && 'Control',
		e.altKey && 'Alt',
		e.shiftKey && 'Shift',
		e.metaKey && 'Super'
	].filter(Boolean) as string[];
	if (mods.length === 0) return null;
	const named: Record<string, string> = {
		' ': 'Space',
		ArrowUp: 'Up',
		ArrowDown: 'Down',
		ArrowLeft: 'Left',
		ArrowRight: 'Right',
		Escape: 'Esc',
		Enter: 'Return'
	};
	let key = named[e.key] ?? e.key;
	if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
	else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
	else if (key.length === 1) key = key.toUpperCase();
	return [...mods, key].join('+');
}
