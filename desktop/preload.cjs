/**
 * The only bridge between the app and Electron. The web build never has
 * `window.daylogDesktop`, which is how the app tells it's running as a desktop
 * app (see src/lib/desktop.ts for the typed side).
 */
const { contextBridge, ipcRenderer } = require('electron');

/** Subscribes to a main→renderer channel; returns an unsubscribe function. */
function listen(channel, callback) {
	const handler = (_event, ...args) => callback(...args);
	ipcRenderer.on(channel, handler);
	return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('daylogDesktop', {
	platform: process.platform,
	hide: () => ipcRenderer.send('window:hide'),
	minimize: () => ipcRenderer.send('window:minimize'),
	toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
	setTitleBarColors: (color, symbolColor) =>
		ipcRenderer.send('titlebar:colors', color, symbolColor),
	quickHide: () => ipcRenderer.send('quick:hide'),
	quickNavigate: (route) => ipcRenderer.send('quick:navigate', route),
	quickCapture: (entry) => ipcRenderer.send('quick:capture', entry),
	setReminders: (list) => ipcRenderer.send('reminders:set', list),
	startGoogleSignIn: () => ipcRenderer.send('auth:google-start'),
	onGoogleCredential: (callback) => listen('auth:google', callback),
	getPrefs: () => ipcRenderer.invoke('prefs:get'),
	setPrefs: (patch) => ipcRenderer.invoke('prefs:set', patch),
	activityStatus: () => ipcRenderer.invoke('activity:status'),
	setActivity: (patch) => ipcRenderer.invoke('activity:set', patch),
	activityDays: (from, to) => ipcRenderer.invoke('activity:days', from, to),
	clearActivity: () => ipcRenderer.invoke('activity:clear'),
	updateStatus: () => ipcRenderer.invoke('update:status'),
	checkForUpdates: () => ipcRenderer.invoke('update:check'),
	installUpdate: () => ipcRenderer.send('update:install'),
	onUpdateStatus: (callback) => listen('update:status', callback),
	onNavigate: (callback) => listen('navigate', callback),
	onCapture: (callback) => listen('capture', callback),
	onQuickOpen: (callback) => listen('quick:open', callback)
});
