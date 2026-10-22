/**
 * Activity tracking — which app (and window) is in front, sampled every few
 * seconds, stored as time spans in one JSON file per day under the user-data
 * folder. The app reads the files over IPC, syncs them to the user's account
 * (src/lib/activity-sync.ts) and does all the analysis (src/lib/activity.ts).
 *
 * A web page can't see other apps, which is why this lives in the desktop shell.
 * Windows reads the foreground window through a long-running PowerShell loop
 * (no native modules to build); macOS and Linux shell out once per sample.
 *
 * No keyboard or mouse input normally means the user stepped away, but not
 * while a video or call is playing: Windows and macOS report when some app is
 * keeping the display awake, which players and browsers do during playback.
 */
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { powerMonitor } = require('electron');

const SAMPLE_SECONDS = 5;
/** A gap longer than this between samples (sleep, a stalled sampler) ends the span. */
const MAX_GAP = SAMPLE_SECONDS * 3 * 1000;
const FLUSH_MS = 60_000;
/** Even a playing video stops counting after this long without input (fell asleep watching). */
const MEDIA_MAX_IDLE = 3 * 3600 * 1000;

const DEFAULTS = {
	enabled: false,
	titles: true,
	idleMinutes: 5,
	exclude: [],
	retentionDays: 90,
	pausedUntil: 0
};

/** Players and call apps: being in front of one without typing is still watching or listening. */
const MEDIA_APPS =
	/^(vlc|mpc-hc|mpc-hc64|mpc-be64|mpv|potplayer|potplayermini64|wmplayer|video\.ui|microsoft\.media\.player|kodi|plex|netflix|iina|quicktime player|tv|zoom|teams|ms-teams|webex|skype)$/i;
/** Only used where the OS can't say whether the display is being kept awake (Linux). */
const MEDIA_TITLES =
	/\b(YouTube|Netflix|Prime Video|Twitch|Disney\+|Hulu|Vimeo|Google Meet|Coursera|Udemy)\b/i;

/** True while the sample looks like watching a video or sitting in a call. */
function watchingMedia(sample) {
	if ([sample.exe, sample.app].some((n) => MEDIA_APPS.test(n))) return true;
	if (typeof sample.media === 'boolean') return sample.media;
	return MEDIA_TITLES.test(sample.title);
}

function dayKey(ms) {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight after `ms`. */
function nextMidnight(ms) {
	const d = new Date(ms);
	d.setHours(24, 0, 0, 0);
	return d.getTime();
}

// ——— Foreground-window samplers. Each yields { exe, app, title } or null. ———

const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DaylogForeground {
	[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
	[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
	[DllImport("powrprof.dll")] public static extern uint CallNtPowerInformation(int level, IntPtr inBuf, uint inLen, out uint state, uint outLen);
}
"@
$names = @{}
while ($true) {
	$h = [DaylogForeground]::GetForegroundWindow()
	$sb = New-Object System.Text.StringBuilder 512
	[void][DaylogForeground]::GetWindowText($h, $sb, 512)
	[uint32]$procId = 0
	[void][DaylogForeground]::GetWindowThreadProcessId($h, [ref]$procId)
	if ($names.Count -gt 500) { $names = @{} }
	if ($procId -and -not $names.ContainsKey($procId)) {
		$p = Get-Process -Id $procId
		$names[$procId] = @($p.ProcessName, $p.Description)
	}
	$n = $names[$procId]
	# SystemExecutionState (16): ES_DISPLAY_REQUIRED (2) is set while a video or call keeps the screen on.
	[uint32]$state = 0
	$media = $null
	if ([DaylogForeground]::CallNtPowerInformation(16, [IntPtr]::Zero, 0, [ref]$state, 4) -eq 0) {
		$media = (($state -band 2) -ne 0)
	}
	$line = @{ exe = [string]$n[0]; app = [string]$n[1]; title = $sb.ToString(); media = $media } | ConvertTo-Json -Compress
	[Console]::Out.WriteLine($line)
	[Console]::Out.Flush()
	Start-Sleep -Seconds ${SAMPLE_SECONDS}
}
`;

/** Windows: one PowerShell process for the whole session, printing a JSON line per sample. */
function windowsSampler(onSample, onError, scriptPath) {
	let child = null;
	let stopped = false;
	let restarts = 0;
	const start = () => {
		// A plain script file rather than -EncodedCommand, which antivirus tools rightly distrust.
		try {
			fs.writeFileSync(scriptPath, WINDOWS_SCRIPT);
		} catch {
			return onError('Could not write the activity sampler script');
		}
		child = spawn(
			'powershell.exe',
			['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
			{ windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
		);
		let buffer = '';
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			buffer += chunk;
			let nl;
			while ((nl = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				if (!line.startsWith('{')) continue;
				try {
					restarts = 0;
					onSample(normalizeWindows(JSON.parse(line)));
				} catch {
					/* a garbled line — the next sample comes in a few seconds */
				}
			}
		});
		child.on('error', () => onError('PowerShell could not be started'));
		child.on('exit', () => {
			child = null;
			if (stopped) return;
			// Crashed or killed: back off, give up after a few tries in a row.
			if (++restarts > 5) return onError('The activity sampler keeps stopping');
			setTimeout(() => !stopped && start(), 2000 * restarts);
		});
	};
	start();
	return () => {
		stopped = true;
		child?.kill();
	};
}

function normalizeWindows({ exe, app, title, media }) {
	exe = String(exe || '').trim();
	title = String(title || '').trim();
	if (!exe) return null;
	// Store apps (Calculator, Photos…) all run inside ApplicationFrameHost; the title names the app.
	media = typeof media === 'boolean' ? media : null;
	if (/^ApplicationFrameHost$/i.test(exe)) {
		return title ? { exe: title, app: title, title, media } : null;
	}
	// The desktop, taskbar and Alt+Tab switcher aren't really "using" anything.
	if (/^explorer$/i.test(exe) && !title) return null;
	if (/^(LockApp|ShellExperienceHost|SearchHost|StartMenuExperienceHost)$/i.test(exe)) return null;
	return { exe, app: String(app || '').trim() || exe, title, media };
}

/** macOS / Linux: run a small command per sample. */
function pollingSampler(read, onSample, onError) {
	let stopped = false;
	let timer;
	let failures = 0;
	const tick = () => {
		read((err, sample) => {
			if (stopped) return;
			if (err) {
				if (++failures === 3) onError(err);
			} else {
				failures = 0;
				onSample(sample);
			}
			timer = setTimeout(tick, SAMPLE_SECONDS * 1000);
		});
	};
	tick();
	return () => {
		stopped = true;
		clearTimeout(timer);
	};
}

const MAC_SCRIPT = [
	'tell application "System Events"',
	'set p to first application process whose frontmost is true',
	'set n to name of p',
	'set t to ""',
	'try',
	'set t to name of front window of p',
	'end try',
	'end tell',
	'return n & linefeed & t'
];

function readMac(done) {
	execFile(
		'osascript',
		MAC_SCRIPT.flatMap((l) => ['-e', l]),
		{ timeout: 4000 },
		(err, out) => {
			if (err) return done('macOS refused — allow daylog under Privacy → Automation');
			const [app, ...rest] = out.replace(/\n$/, '').split('\n');
			if (!app) return done(null, null);
			// Players and browsers hold a display-sleep assertion while a video plays.
			execFile('pmset', ['-g', 'assertions'], { timeout: 4000 }, (err2, assertions) => {
				const media = err2 ? null : /PreventUserIdleDisplaySleep\s+1/.test(assertions);
				done(null, { exe: app, app, title: rest.join(' ').trim(), media });
			});
		}
	);
}

function readLinux(done) {
	execFile(
		'xdotool',
		['getactivewindow', 'getwindowpid', 'getwindowname'],
		{ timeout: 4000 },
		(err, out) => {
			if (err) return done('Needs xdotool on an X11 session');
			const [pid, ...rest] = out.replace(/\n$/, '').split('\n');
			let exe = '';
			try {
				exe = fs.readFileSync(`/proc/${Number(pid)}/comm`, 'utf8').trim();
			} catch {
				/* the window closed between the two reads */
			}
			done(null, exe ? { exe, app: exe, title: rest.join(' ').trim(), media: null } : null);
		}
	);
}

function startSampler(onSample, onError, scriptPath) {
	if (process.platform === 'win32') return windowsSampler(onSample, onError, scriptPath);
	if (process.platform === 'darwin') return pollingSampler(readMac, onSample, onError);
	return pollingSampler(readLinux, onSample, onError);
}

// ——— The tracker ———

/**
 * @param {{ dir: string, prefs: object, save: () => void, onChange?: () => void }} options
 *   `prefs` is the shared desktop prefs object; the tracker owns `prefs.activity`.
 */
function createActivityTracker({ dir, prefs, save, onChange }) {
	prefs.activity = { ...DEFAULTS, ...(prefs.activity || {}) };
	// Names this computer's synced activity, so several computers don't overwrite each other.
	if (!prefs.deviceId) {
		prefs.deviceId = crypto.randomUUID();
		save();
	}
	const settings = () => prefs.activity;

	/** @type {Map<string, { s: number, e: number, exe: string, app: string, title?: string }[]>} */
	const days = new Map();
	const dirty = new Set();
	/** The span being extended by each sample, and the sample time it was last seen. */
	let open = null;
	let lastSampleAt = 0;
	let stop = null;
	let error = '';
	let flushTimer = null;

	const file = (key) => path.join(dir, `${key}.json`);

	function load(key) {
		if (days.has(key)) return days.get(key);
		let spans = [];
		try {
			spans = JSON.parse(fs.readFileSync(file(key), 'utf8'));
			if (!Array.isArray(spans)) spans = [];
		} catch {
			/* no file yet */
		}
		days.set(key, spans);
		return spans;
	}

	function flush() {
		if (!dirty.size) return;
		try {
			fs.mkdirSync(dir, { recursive: true });
			for (const key of dirty) fs.writeFileSync(file(key), JSON.stringify(days.get(key) ?? []));
		} catch {
			/* disk full or read-only — keep the data in memory and retry next flush */
			return;
		}
		dirty.clear();
		// Only today (and an open span's day) need to stay in memory.
		const keep = new Set([dayKey(Date.now()), open && dayKey(open.s)]);
		for (const key of days.keys()) if (!keep.has(key)) days.delete(key);
	}

	function prune() {
		const cutoff = dayKey(Date.now() - settings().retentionDays * 86_400_000);
		try {
			for (const name of fs.readdirSync(dir)) {
				const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
				if (m && m[1] < cutoff) fs.unlinkSync(path.join(dir, name));
			}
		} catch {
			/* no folder yet */
		}
	}

	/** Ends the open span at `at` (never before it started). */
	function close(at) {
		if (!open) return;
		open.e = Math.max(open.s, Math.min(at, open.e + MAX_GAP));
		dirty.add(dayKey(open.s));
		if (open.e - open.s < 1000) {
			// A blink — drop it rather than litter the day with zero-length spans.
			const spans = load(dayKey(open.s));
			if (spans[spans.length - 1] === open) spans.pop();
		}
		open = null;
	}

	/** Cuts today's spans back to `at` — the user left when input stopped, not when we noticed. */
	function trimAfter(at) {
		const key = dayKey(Date.now());
		const spans = load(key);
		while (spans.length && spans[spans.length - 1].e > at) {
			const last = spans[spans.length - 1];
			last.e = Math.max(last.s, at);
			dirty.add(key);
			if (last.e - last.s >= 1000) break;
			spans.pop();
		}
	}

	function begin(at, sample) {
		const span = { s: at, e: at, exe: sample.exe, app: sample.app };
		if (settings().titles && sample.title) span.title = sample.title.slice(0, 300);
		load(dayKey(at)).push(span);
		dirty.add(dayKey(at));
		open = span;
	}

	const excluded = (sample) => {
		const names = [sample.exe, sample.app].map((n) => n.toLowerCase());
		return settings().exclude.some((x) => names.includes(String(x).toLowerCase()));
	};

	function onSample(sample) {
		const now = Date.now();
		const gap = now - lastSampleAt;
		lastSampleAt = now;
		error = '';
		const idleMs = powerMonitor.getSystemIdleTime() * 1000;
		const watching = !!sample && idleMs < MEDIA_MAX_IDLE && watchingMedia(sample);
		const isIdle = idleMs >= settings().idleMinutes * 60_000 && !watching;
		if (!active() || !sample || isIdle || excluded(sample)) {
			close(now);
			if (isIdle) trimAfter(now - idleMs);
			onChange?.();
			return;
		}
		const title = settings().titles ? sample.title.slice(0, 300) : undefined;
		const same = open && open.exe === sample.exe && open.app === sample.app && open.title === title;
		if (open && gap > MAX_GAP) close(open.e);
		else if (open && dayKey(open.s) !== dayKey(now)) {
			// Crossing midnight: finish yesterday's span and carry on in today's file.
			const midnight = nextMidnight(open.s);
			open.e = midnight;
			dirty.add(dayKey(open.s));
			open = null;
			if (same) begin(midnight, sample);
		}
		if (open && same) {
			open.e = now;
			dirty.add(dayKey(open.s));
		} else {
			close(now);
			begin(now, sample);
		}
		onChange?.();
	}

	const active = () => settings().enabled && Date.now() >= settings().pausedUntil;

	function sync() {
		const want = settings().enabled;
		if (want && !stop) {
			lastSampleAt = Date.now();
			stop = startSampler(
				onSample,
				(message) => {
					error = message;
					onChange?.();
				},
				path.join(path.dirname(dir), 'activity-sampler.ps1')
			);
			flushTimer = setInterval(flush, FLUSH_MS);
		} else if (!want && stop) {
			stop();
			stop = null;
			clearInterval(flushTimer);
			close(Date.now());
			flush();
		}
	}

	// Locking or sleeping the computer ends whatever was in front.
	for (const event of ['lock-screen', 'suspend']) {
		powerMonitor.on(event, () => {
			close(Date.now());
			flush();
		});
	}

	prune();
	sync();

	return {
		status() {
			const s = settings();
			return {
				enabled: s.enabled,
				titles: s.titles,
				idleMinutes: s.idleMinutes,
				exclude: s.exclude,
				retentionDays: s.retentionDays,
				pausedUntil: s.pausedUntil > Date.now() ? s.pausedUntil : 0,
				device: { id: prefs.deviceId, name: os.hostname() },
				platform: process.platform,
				error,
				current:
					open && active()
						? { app: open.app, exe: open.exe, title: open.title ?? '', since: open.s }
						: null
			};
		},

		/** Applies a validated settings patch from the renderer. */
		set(patch) {
			const s = settings();
			if (typeof patch?.enabled === 'boolean') s.enabled = patch.enabled;
			if (typeof patch?.titles === 'boolean') {
				s.titles = patch.titles;
				close(Date.now());
			}
			if (Number.isFinite(patch?.idleMinutes)) {
				s.idleMinutes = Math.min(60, Math.max(1, Math.round(patch.idleMinutes)));
			}
			if (Number.isFinite(patch?.retentionDays)) {
				s.retentionDays = Math.min(3650, Math.max(7, Math.round(patch.retentionDays)));
				prune();
			}
			if (Number.isFinite(patch?.pausedUntil)) {
				s.pausedUntil = Math.max(0, patch.pausedUntil);
				if (s.pausedUntil > Date.now()) close(Date.now());
			}
			if (Array.isArray(patch?.exclude)) {
				s.exclude = patch.exclude
					.filter((x) => typeof x === 'string' && x.trim())
					.map((x) => x.trim().slice(0, 100))
					.slice(0, 100);
			}
			save();
			sync();
			onChange?.();
		},

		/** Spans for every day from `from` to `to` (inclusive `YYYY-MM-DD` keys) that has any. */
		days(from, to) {
			const out = {};
			if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return out;
			const keys = new Set(days.keys());
			try {
				for (const name of fs.readdirSync(dir)) {
					if (name.endsWith('.json')) keys.add(name.slice(0, -5));
				}
			} catch {
				/* nothing recorded yet */
			}
			for (const key of keys) {
				if (key < from || key > to) continue;
				const spans = days.get(key) ?? load(key);
				if (spans.length) out[key] = spans.map((sp) => ({ ...sp }));
			}
			return out;
		},

		/** Deletes everything recorded so far. */
		clear() {
			open = null;
			days.clear();
			dirty.clear();
			try {
				fs.rmSync(dir, { recursive: true, force: true });
			} catch {
				/* already gone */
			}
			onChange?.();
		},

		/** Writes pending spans to disk — call before quitting. */
		shutdown() {
			stop?.();
			stop = null;
			clearInterval(flushTimer);
			close(Date.now());
			flush();
		}
	};
}

module.exports = { createActivityTracker };
