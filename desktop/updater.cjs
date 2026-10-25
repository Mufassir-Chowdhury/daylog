/**
 * Auto-update for the packaged app. CI publishes each build to the repository's
 * latest GitHub release along with `latest.yml` (version + checksum); this checks
 * that feed shortly after launch and every few hours, downloads a newer installer
 * in the background, and installs it on the next quit — or straight away when
 * the user picks "Restart to update" from the tray, the notification or Settings.
 *
 * Dev runs and unpackaged builds never update (there's no installer to replace).
 */
const { app } = require('electron');

const FIRST_CHECK_DELAY = 15_000;
const CHECK_EVERY = 4 * 3600 * 1000;

/**
 * @typedef {'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'unsupported'} UpdateState
 * @typedef {{
 *   state: UpdateState,
 *   current: string,
 *   version: string,
 *   percent: number,
 *   error: string,
 *   checkedAt: number
 * }} UpdateStatus
 */

/**
 * @param {{ enabled: boolean, onChange: (status: UpdateStatus) => void, onReady: (version: string) => void }} options
 */
function createUpdater({ enabled, onChange, onReady }) {
	/** @type {UpdateStatus} */
	let status = {
		state: enabled ? 'idle' : 'unsupported',
		current: app.getVersion(),
		version: '',
		percent: 0,
		error: '',
		checkedAt: 0
	};
	const set = (patch) => {
		status = { ...status, ...patch };
		onChange(status);
	};

	if (!enabled) {
		return {
			status: () => status,
			check: async () => status,
			install: () => {},
			shutdown: () => {}
		};
	}

	const { autoUpdater } = require('electron-updater');
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	// The feed is GitHub's "latest release" URL, which can't serve the previous
	// build's blockmap, so always fetch the whole installer.
	autoUpdater.disableDifferentialDownload = true;
	autoUpdater.logger = null;

	autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: '' }));
	autoUpdater.on('update-not-available', () => set({ state: 'idle', checkedAt: Date.now() }));
	autoUpdater.on('update-available', (info) =>
		set({ state: 'downloading', version: info.version, percent: 0, checkedAt: Date.now() })
	);
	autoUpdater.on('download-progress', (p) => set({ percent: Math.round(p.percent) }));
	autoUpdater.on('update-downloaded', (info) => {
		const announce = status.state !== 'ready' || status.version !== info.version;
		set({ state: 'ready', version: info.version, percent: 100 });
		if (announce) onReady(info.version);
	});
	autoUpdater.on('error', (err) => {
		// A failed download leaves nothing to install; a ready update stays ready.
		if (status.state === 'ready') return;
		set({ state: 'error', error: String(err?.message || err).split('\n')[0] });
	});

	async function check() {
		if (status.state === 'checking' || status.state === 'downloading' || status.state === 'ready') {
			return status;
		}
		try {
			await autoUpdater.checkForUpdates();
		} catch {
			/* reported through the 'error' event */
		}
		return status;
	}

	const first = setTimeout(check, FIRST_CHECK_DELAY);
	const timer = setInterval(check, CHECK_EVERY);

	return {
		status: () => status,
		check,
		/** Quits, installs silently and relaunches. */
		install: () => {
			if (status.state === 'ready') autoUpdater.quitAndInstall(true, true);
		},
		shutdown: () => {
			clearTimeout(first);
			clearInterval(timer);
		}
	};
}

module.exports = { createUpdater };
