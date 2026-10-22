/**
 * daylog desktop — an Electron shell around the same SvelteKit app the web
 * build serves. It stays running in the tray, answers two global hotkeys
 * (summon the window, open the quick bar from any app), fires reminders for
 * timed lines, tracks which apps you use (opt-in, see activity.cjs), and
 * remembers its window size.
 *
 * The built SPA (desktop/app, from `npm run desktop:build`) is served on a fixed
 * localhost port: Firebase already trusts `localhost` for Google sign-in, and a
 * fixed origin keeps the IndexedDB cache and login across launches.
 */
const {
	app,
	BrowserWindow,
	Menu,
	Notification,
	Tray,
	globalShortcut,
	ipcMain,
	nativeImage,
	screen,
	shell
} = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createActivityTracker } = require('./activity.cjs');

const DEV = process.argv.includes('--dev');
const DEV_URL = process.env.DAYLOG_DEV_URL || 'http://localhost:5173';
const START_HIDDEN = process.argv.includes('--hidden');
const APP_DIR = path.join(__dirname, 'app');
const ICONS = path.join(__dirname, 'icons');
const PORTS = [47615, 47616, 47617];
const TITLEBAR_HEIGHT = 40;

app.setAppUserModelId('app.daylog.desktop');

if (!app.requestSingleInstanceLock()) {
	app.quit();
	process.exit(0);
}

// ——— Preferences (desktop-only, kept in the user-data folder) ———

const PREFS_PATH = path.join(app.getPath('userData'), 'desktop-prefs.json');
const DEFAULT_PREFS = {
	summonKey: 'Control+Alt+D',
	quickKey: 'Control+Alt+Space',
	bounds: null,
	maximized: false,
	trayHintShown: false
};

function loadPrefs() {
	try {
		return { ...DEFAULT_PREFS, ...JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8')) };
	} catch {
		return { ...DEFAULT_PREFS };
	}
}

let prefs = loadPrefs();
let prefsTimer;
function savePrefs() {
	clearTimeout(prefsTimer);
	prefsTimer = setTimeout(() => {
		try {
			fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, '\t'));
		} catch {
			/* read-only profile — prefs just won't stick */
		}
	}, 300);
}

// ——— Local static server for the built SPA ———

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.woff2': 'font/woff2',
	'.txt': 'text/plain; charset=utf-8',
	'.pdf': 'application/pdf'
};

function serve(req, res) {
	const url = new URL(req.url, 'http://localhost');
	if (url.pathname === '/__desktop-auth') {
		receiveGoogleCredential(req, res);
		return;
	}
	if (!fs.existsSync(path.join(APP_DIR, '200.html'))) {
		res.writeHead(404).end(); // dev: the app itself comes from Vite
		return;
	}
	const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
	let file = path.join(APP_DIR, rel);
	if (!file.startsWith(APP_DIR)) {
		res.writeHead(403).end();
		return;
	}
	if (!rel || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
		file = path.join(APP_DIR, '200.html'); // SPA fallback: the client router takes over
	}
	const immutable = rel.startsWith('_app/immutable/');
	res.writeHead(200, {
		'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
		'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
	});
	fs.createReadStream(file).pipe(res);
}

/** Starts the local server on the first free port and resolves with that port. */
function startServer(ports) {
	return new Promise((resolve, reject) => {
		const [port, ...rest] = ports;
		if (port === undefined) return reject(new Error('No free port for the local server'));
		const server = http.createServer(serve);
		server.once('error', () => startServer(rest).then(resolve, reject));
		server.listen(port, '127.0.0.1', () => resolve(port));
	});
}

// ——— Google sign-in through the system browser ———
// Google refuses to sign in inside embedded browsers (Electron included), so the
// app opens /desktop-auth in the user's real browser. That page signs in with
// Google and posts the resulting Google tokens back here, tagged with a one-time
// state value; the main window then signs in to Firebase with them.

let serverPort = 0;
/** @type {{ state: string, expires: number } | null} */
let pendingAuth = null;

function startGoogleSignIn() {
	const state = crypto.randomBytes(24).toString('hex');
	pendingAuth = { state, expires: Date.now() + 10 * 60 * 1000 };
	const params = new URLSearchParams({ state, port: String(serverPort) });
	shell.openExternal(`${origin}/desktop-auth?${params}`);
}

function receiveGoogleCredential(req, res) {
	// The auth page is same-origin in the packaged app; in dev it's served by Vite.
	const from = req.headers.origin;
	const headers = { 'Content-Type': 'application/json' };
	if (from && /^http:\/\/localhost:\d+$/.test(from)) headers['Access-Control-Allow-Origin'] = from;
	const reply = (status, body) => res.writeHead(status, headers).end(JSON.stringify(body));

	if (req.method !== 'POST') return reply(405, { ok: false });
	let body = '';
	req.on('data', (chunk) => {
		body += chunk;
		if (body.length > 64 * 1024) req.destroy();
	});
	req.on('end', () => {
		let data;
		try {
			data = JSON.parse(body);
		} catch {
			return reply(400, { ok: false, error: 'Bad request' });
		}
		const valid =
			pendingAuth &&
			Date.now() < pendingAuth.expires &&
			typeof data?.state === 'string' &&
			data.state.length === pendingAuth.state.length &&
			crypto.timingSafeEqual(Buffer.from(data.state), Buffer.from(pendingAuth.state));
		if (!valid) {
			return reply(403, {
				ok: false,
				error: 'This sign-in link expired — start again from the app.'
			});
		}
		if (typeof data.idToken !== 'string' && typeof data.accessToken !== 'string') {
			return reply(400, { ok: false, error: 'No Google credential received' });
		}
		pendingAuth = null;
		main?.webContents.send('auth:google', {
			idToken: typeof data.idToken === 'string' ? data.idToken : null,
			accessToken: typeof data.accessToken === 'string' ? data.accessToken : null
		});
		showMain();
		reply(200, { ok: true });
	});
}

// ——— Windows ———

/** @type {BrowserWindow | null} */
let main = null;
/** @type {BrowserWindow | null} */
let quick = null;
/** @type {Tray | null} */
let tray = null;
let origin = '';
let quitting = false;

const icon = nativeImage.createFromPath(path.join(ICONS, 'icon.png'));

const webPreferences = {
	preload: path.join(__dirname, 'preload.cjs'),
	contextIsolation: true,
	sandbox: true,
	spellcheck: true
};

function guardNavigation(win) {
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:/.test(url)) shell.openExternal(url);
		return { action: 'deny' };
	});
	win.webContents.on('will-navigate', (e, url) => {
		if (!url.startsWith(origin)) {
			e.preventDefault();
			if (/^https?:/.test(url)) shell.openExternal(url);
		}
	});
	// No app menu, so wire the few shortcuts worth keeping by hand.
	win.webContents.on('before-input-event', (e, input) => {
		if (input.type !== 'keyDown') return;
		const ctrl = input.control || input.meta;
		if (input.key === 'F12' || (ctrl && input.shift && input.key.toLowerCase() === 'i')) {
			win.webContents.toggleDevTools();
		} else if (ctrl && input.key.toLowerCase() === 'r' && !input.shift) {
			win.webContents.reload();
		} else if (ctrl && (input.key === '=' || input.key === '+')) {
			win.webContents.setZoomLevel(Math.min(win.webContents.getZoomLevel() + 0.5, 4));
		} else if (ctrl && input.key === '-') {
			win.webContents.setZoomLevel(Math.max(win.webContents.getZoomLevel() - 0.5, -3));
		} else if (ctrl && input.key === '0') {
			win.webContents.setZoomLevel(0);
		} else return;
		e.preventDefault();
	});
}

/** Keeps the restored window on a display that still exists. */
function visibleBounds(bounds) {
	if (!bounds) return null;
	const area = screen.getDisplayMatching(bounds).workArea;
	const overlaps =
		bounds.x < area.x + area.width &&
		bounds.x + bounds.width > area.x &&
		bounds.y < area.y + area.height &&
		bounds.y + bounds.height > area.y;
	return overlaps ? bounds : null;
}

function createMain() {
	const bounds = visibleBounds(prefs.bounds);
	main = new BrowserWindow({
		width: bounds?.width ?? 1280,
		height: bounds?.height ?? 820,
		x: bounds?.x,
		y: bounds?.y,
		minWidth: 760,
		minHeight: 520,
		show: false,
		title: 'daylog',
		icon,
		backgroundColor: '#070b14',
		titleBarStyle: 'hidden',
		// Native caption buttons keep Windows 11 snap layouts on the maximize button.
		titleBarOverlay: { color: '#0a1120', symbolColor: '#c9d8f5', height: TITLEBAR_HEIGHT },
		webPreferences
	});
	if (prefs.maximized) main.maximize();
	guardNavigation(main);
	main.loadURL(origin);

	main.once('ready-to-show', () => {
		if (!START_HIDDEN) main.show();
	});

	const remember = () => {
		if (!main || main.isMinimized()) return;
		prefs.maximized = main.isMaximized();
		if (!prefs.maximized) prefs.bounds = main.getBounds();
		savePrefs();
	};
	main.on('resize', remember);
	main.on('move', remember);

	// Closing hides to the tray; Quit (tray menu) really exits.
	main.on('close', (e) => {
		if (quitting) return;
		e.preventDefault();
		main.hide();
		if (!prefs.trayHintShown && Notification.isSupported()) {
			prefs.trayHintShown = true;
			savePrefs();
			new Notification({
				title: 'daylog is still running',
				body: `It lives in the tray. ${pretty(prefs.summonKey)} brings it back; ${pretty(prefs.quickKey)} opens the quick bar from anywhere.`,
				icon
			}).show();
		}
	});
}

function showMain(route) {
	if (!main) return;
	if (main.isMinimized()) main.restore();
	main.show();
	main.focus();
	if (route) main.webContents.send('navigate', route);
}

function toggleMain() {
	if (!main) return;
	if (main.isVisible() && main.isFocused()) main.hide();
	else showMain();
}

const QUICK_WIDTH = 700;
const QUICK_HEIGHT = 480;

function createQuick() {
	quick = new BrowserWindow({
		width: QUICK_WIDTH,
		height: QUICK_HEIGHT,
		show: false,
		frame: false,
		transparent: true,
		resizable: false,
		movable: false,
		minimizable: false,
		maximizable: false,
		fullscreenable: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		hasShadow: false,
		backgroundColor: '#00000000',
		webPreferences
	});
	quick.setAlwaysOnTop(true, 'pop-up-menu');
	guardNavigation(quick);
	quick.loadURL(`${origin}/quick`);
	quick.on('blur', () => {
		if (!quick.webContents.isDevToolsOpened()) quick.hide();
	});
}

function toggleQuick() {
	if (!quick) return;
	if (quick.isVisible()) {
		quick.hide();
		return;
	}
	// Open on whichever screen the mouse is on, a little above centre.
	const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
	quick.setBounds({
		x: Math.round(area.x + (area.width - QUICK_WIDTH) / 2),
		y: Math.round(area.y + area.height * 0.18),
		width: QUICK_WIDTH,
		height: QUICK_HEIGHT
	});
	quick.show();
	quick.focus();
	quick.webContents.send('quick:open');
}

// ——— Global hotkeys ———

const pretty = (accel) => accel.replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ');

/** Registers both hotkeys; returns the ones the OS refused (taken by another app). */
function registerHotkeys() {
	globalShortcut.unregisterAll();
	const failed = [];
	const bind = (accel, fn) => {
		try {
			if (!accel || !globalShortcut.register(accel, fn)) failed.push(accel);
		} catch {
			failed.push(accel);
		}
	};
	bind(prefs.summonKey, toggleMain);
	bind(prefs.quickKey, toggleQuick);
	return failed;
}

// ——— Reminders ———
// The renderer sends today's upcoming timed lines; timers live here because
// the main process isn't throttled while the window is hidden.

let reminderTimers = [];
function setReminders(list) {
	reminderTimers.forEach(clearTimeout);
	reminderTimers = [];
	const now = Date.now();
	for (const r of Array.isArray(list) ? list : []) {
		const delay = Number(r.at) - now;
		if (!(delay > 0) || delay > 36 * 3600 * 1000) continue;
		reminderTimers.push(
			setTimeout(() => {
				if (!Notification.isSupported()) return;
				const n = new Notification({
					title: String(r.title || 'daylog'),
					body: String(r.body || ''),
					icon
				});
				n.on('click', () => showMain(r.route || '/'));
				n.show();
			}, delay)
		);
	}
}

// ——— Tray ———

function createTray() {
	tray = new Tray(nativeImage.createFromPath(path.join(ICONS, 'tray.png')));
	tray.setToolTip('daylog');
	tray.on('click', toggleMain);
	refreshTrayMenu();
}

function refreshTrayMenu() {
	if (!tray) return;
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: 'Open daylog', accelerator: prefs.summonKey, click: () => showMain() },
			{ label: 'Quick bar', accelerator: prefs.quickKey, click: toggleQuick },
			{ type: 'separator' },
			{ label: 'Today', click: () => showMain('/') },
			{ label: 'Schedule', click: () => showMain('/schedule') },
			{ label: 'Finance', click: () => showMain('/finance') },
			{ label: 'Activity', click: () => showMain('/activity') },
			...activityMenu(),
			{ type: 'separator' },
			{
				label: 'Start with Windows',
				type: 'checkbox',
				enabled: !DEV,
				checked: launchAtLogin(),
				click: (item) => setLaunchAtLogin(item.checked)
			},
			{ type: 'separator' },
			{ label: 'Quit daylog', click: () => app.quit() }
		])
	);
}

function activityMenu() {
	const status = activity?.status();
	if (!status?.enabled) return [];
	if (status.pausedUntil) {
		return [
			{ type: 'separator' },
			{ label: 'Resume activity tracking', click: () => activity.set({ pausedUntil: 0 }) }
		];
	}
	return [
		{ type: 'separator' },
		{
			label: 'Pause activity tracking',
			submenu: [
				{ label: 'For 30 minutes', click: () => pauseActivity(30 * 60_000) },
				{ label: 'For an hour', click: () => pauseActivity(60 * 60_000) },
				{
					label: 'Until tomorrow',
					click: () => {
						const d = new Date();
						d.setHours(24, 0, 0, 0);
						activity.set({ pausedUntil: d.getTime() });
					}
				}
			]
		}
	];
}

const pauseActivity = (ms) => activity.set({ pausedUntil: Date.now() + ms });

const launchAtLogin = () => !DEV && app.getLoginItemSettings().openAtLogin;
function setLaunchAtLogin(on) {
	if (DEV) return;
	app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] });
	refreshTrayMenu();
}

// ——— Activity tracking ———

/** @type {ReturnType<typeof createActivityTracker> | null} */
let activity = null;
let activityMenuKey = '';
let resumeTimer;

/** Rebuilds the tray menu when tracking turns on/off or a pause starts/ends. */
function onActivityChange() {
	const status = activity?.status();
	const key = `${status?.enabled}:${status?.pausedUntil}`;
	if (key === activityMenuKey) return;
	activityMenuKey = key;
	clearTimeout(resumeTimer);
	if (status?.pausedUntil) {
		// Flip the menu back to "Pause" when the pause runs out.
		const wait = Math.min(status.pausedUntil - Date.now() + 500, 2 ** 31 - 1);
		resumeTimer = setTimeout(onActivityChange, wait);
	}
	refreshTrayMenu();
}

// ——— IPC ———

/** Hotkeys the OS refused at the last registration, shown in Settings. */
let registeredFailures = [];

const senderWindow = (e) => BrowserWindow.fromWebContents(e.sender);

ipcMain.on('window:hide', (e) => senderWindow(e)?.hide());
ipcMain.on('window:minimize', (e) => senderWindow(e)?.minimize());
ipcMain.on('window:toggle-maximize', (e) => {
	const win = senderWindow(e);
	if (!win) return;
	if (win.isMaximized()) win.unmaximize();
	else win.maximize();
});
ipcMain.on('titlebar:colors', (e, color, symbolColor) => {
	const win = senderWindow(e);
	if (win === main && typeof color === 'string' && typeof symbolColor === 'string') {
		main.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
		main.setBackgroundColor(color);
	}
});
ipcMain.on('quick:hide', () => quick?.hide());
ipcMain.on('quick:navigate', (_e, route) => {
	quick?.hide();
	if (typeof route === 'string' && route.startsWith('/')) showMain(route);
});
ipcMain.on('quick:capture', (_e, entry) => {
	main?.webContents.send('capture', entry);
});
ipcMain.on('reminders:set', (_e, list) => setReminders(list));
ipcMain.on('auth:google-start', startGoogleSignIn);
ipcMain.handle('activity:status', () => activity?.status() ?? null);
ipcMain.handle('activity:set', (_e, patch) => {
	activity?.set(patch);
	return activity?.status() ?? null;
});
ipcMain.handle('activity:days', (_e, from, to) =>
	typeof from === 'string' && typeof to === 'string' ? (activity?.days(from, to) ?? {}) : {}
);
ipcMain.handle('activity:clear', () => activity?.clear());
ipcMain.handle('prefs:get', () => ({
	summonKey: prefs.summonKey,
	quickKey: prefs.quickKey,
	launchAtLogin: launchAtLogin(),
	canLaunchAtLogin: !DEV,
	failed: registeredFailures
}));
ipcMain.handle('prefs:set', (_e, patch) => {
	const before = { summonKey: prefs.summonKey, quickKey: prefs.quickKey };
	if (typeof patch?.summonKey === 'string') prefs.summonKey = patch.summonKey;
	if (typeof patch?.quickKey === 'string') prefs.quickKey = patch.quickKey;
	if (typeof patch?.launchAtLogin === 'boolean') setLaunchAtLogin(patch.launchAtLogin);
	const failed = registerHotkeys();
	if (failed.length) {
		// Roll back to the keys that worked rather than leave a hotkey dead.
		Object.assign(prefs, before);
		registeredFailures = registerHotkeys();
		return { ok: false, error: `${failed.map(pretty).join(', ')} is taken or invalid` };
	}
	registeredFailures = [];
	savePrefs();
	refreshTrayMenu();
	return { ok: true };
});

// ——— Lifecycle ———

app.on('second-instance', () => showMain());
app.on('before-quit', () => {
	quitting = true;
});
app.on('will-quit', () => {
	globalShortcut.unregisterAll();
	activity?.shutdown();
});
// Keep running in the tray when every window is closed/hidden.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
	Menu.setApplicationMenu(null);
	if (!DEV && !fs.existsSync(path.join(APP_DIR, '200.html'))) {
		console.error('desktop/app is missing — run `npm run desktop:build` first.');
		app.quit();
		return;
	}
	// In dev the app comes from Vite, but the server still receives Google sign-ins.
	serverPort = await startServer(PORTS);
	origin = DEV ? DEV_URL : `http://localhost:${serverPort}`;
	createMain();
	createQuick();
	activity = createActivityTracker({
		dir: path.join(app.getPath('userData'), 'activity'),
		prefs,
		save: savePrefs,
		onChange: onActivityChange
	});
	createTray();
	registeredFailures = registerHotkeys();
});
