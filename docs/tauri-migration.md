# Electron → Tauri migration

Living log of the port of the desktop app from Electron (`desktop/`) to Tauri 2
(`src-tauri/`). Updated in every PR of the migration, so anyone can pick it up
from where it stopped. **Read "Status" and "Next up" first.**

Goals: a much smaller installer, lower idle memory, faster start, and a lighter
activity tracker — with the same features and no change to the web app.

## Status

| Step | What                                                                                                                                                                                        | PR                                                        | State     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------- |
| 1    | Tauri shell: local server, main + quick windows, tray, hotkeys, reminders, prefs, launch at login, single instance, Google sign-in, bridge in `src/lib/desktop.ts`, preview installer in CI | [#7](https://github.com/Mufassir-Chowdhury/daylog/pull/7) | merged    |
| 2    | Activity tracker in Rust (Win32 on Windows, `osascript`/`xdotool` elsewhere) + tray pause menu                                                                                              | [#8](https://github.com/Mufassir-Chowdhury/daylog/pull/8) | merged    |
| 3    | Custom title bar + caption buttons, zoom/devtools/reload keys, polish                                                                                                                       | [#9](https://github.com/Mufassir-Chowdhury/daylog/pull/9) | merged    |
| 4    | Auto-updater (same `latest.yml` feed as electron-updater) + Settings → Desktop app                                                                                                          | (this PR)                                                 | in review |
| 5    | Switch-over: CI ships the Tauri installer as `daylog-setup.exe`, existing Electron installs update into it, Electron removed                                                                | —                                                         | todo      |

## Next up

Step 5, the switch-over:

- CI builds only the Tauri installer and publishes it as `daylog-setup.exe`
  with `latest.yml` (and the same manifest as `latest-tauri.yml` for previews).
  The Tauri updater switches its feed to `latest.yml`.
- Installed Electron copies then download it through electron-updater, which
  runs it as `--updated /S --force-run`. NSIS hooks
  (`src-tauri/windows/hooks.nsh`) remove the Electron install
  (`%LOCALAPPDATA%\Programs\daylog`, via its own uninstaller, keeping
  `%APPDATA%\daylog`) and relaunch on `--force-run`.
- On first run the app moves "Start with Windows" over from Electron's Run
  entry and deletes Chromium caches (`migrate.rs`).
- Remove `desktop/*.cjs`, the electron packages and the `build` config.
- Test the whole path on a Windows runner: install the last Electron release,
  run the new installer like electron-updater, check the result.

## Design decisions (and why)

- **Same frontend, unchanged.** `vite build --mode desktop` still emits the static
  SPA into `desktop/app`. Tauri embeds that folder in the binary
  (`build.frontendDist`).
- **Same origin: `http://localhost:47615`** (falls back to 47616/47617), served by
  a tiny HTTP server inside the Rust app (`src-tauri/src/server.rs`), exactly like
  Electron did. Reasons: Firebase already authorizes `localhost` for Google
  sign-in, the server must also receive the Google tokens posted by
  `/desktop-auth` in the system browser, and a fixed origin keeps IndexedDB and
  the login across launches. Tauri IPC is allowed for that origin through the
  capability's `remote.urls`.
- **Same bridge API.** `window.daylogDesktop` (Electron preload) and the Tauri
  implementation both satisfy `DesktopBridge` in `src/lib/desktop.ts`, so no
  page or component changes. Tauri is detected by `window.__TAURI_INTERNALS__`.
- **Same data folder.** Prefs (`desktop-prefs.json`) and activity
  (`activity/YYYY-MM-DD.json`) live in the same folder Electron used
  (`%APPDATA%\daylog`, `~/.config/daylog`, `~/Library/Application Support/daylog`)
  in the same formats, so switching keeps hotkeys, window size, activity
  settings, the device id and all recorded activity. The webview's own storage
  (IndexedDB cache, localStorage, Firebase session) can't be carried over:
  users sign in once more after switching; Firestore data is in the cloud.
- **Notifications:** Windows uses `tauri-winrt-notification` directly (click →
  open the route); other platforms use `notify-rust`.
- **Updater (step 4):** a small Rust updater that reads the same `latest.yml`
  electron-updater reads (version, size, sha512) instead of Tauri's updater
  plugin. That lets one feed serve both the old Electron installs (which update
  _into_ Tauri) and the new ones, keeps SignPath signing as is (sign, then
  `desktop/refresh-update-info.mjs` rewrites the hash), and needs no new
  signing-key secret.
- **Versions** stay `0.1.<workflow run number>`, one GitHub release per build.

## Release plan during the migration

- Until step 5, every push to `main` still releases the **Electron** installer as
  `daylog-setup.exe` + `latest.yml` (what installed apps update from), and also
  attaches the **Tauri preview** installer as `daylog-tauri-setup.exe`.
- PRs touching the desktop app build the Tauri installer as a workflow artifact,
  without publishing, so a broken Windows build never reaches `main`.
- Step 5 flips `daylog-setup.exe` and `latest.yml` to the Tauri build.

Trying the preview: quit the Electron app first (tray → Quit daylog). Both use
the same hotkeys and ports; the preview installs side by side
(`%LOCALAPPDATA%\daylog` vs Electron's `%LOCALAPPDATA%\Programs\daylog`).

## Electron → Tauri map

| Electron (`desktop/`)                        | Tauri (`src-tauri/src/`)                      |
| -------------------------------------------- | --------------------------------------------- |
| `main.cjs` static server + `/__desktop-auth` | `server.rs` (tiny_http, embedded assets)      |
| `BrowserWindow` main / quick                 | `windows.rs`                                  |
| `Tray`, `Menu`                               | `tray.rs`                                     |
| `globalShortcut`                             | `tauri-plugin-global-shortcut` (`hotkeys.rs`) |
| `Notification` + reminder timers             | `notify.rs`, `reminders.rs`                   |
| `setLoginItemSettings`                       | `tauri-plugin-autostart`                      |
| `requestSingleInstanceLock`                  | `tauri-plugin-single-instance`                |
| prefs JSON                                   | `prefs.rs`                                    |
| `ipcMain` handlers / `preload.cjs`           | `commands.rs` / `src/lib/desktop.ts`          |
| `activity.cjs`                               | `activity/mod.rs`, `activity/sampler.rs`      |
| `updater.cjs` (electron-updater)             | `updater.rs` (step 4)                         |

## Working on it

```sh
npm run tauri:dev        # Tauri against `npm run dev` (start that first)
npm run tauri:build      # desktop:build + Tauri installer (src-tauri/target/release/bundle)
```

Checking a change end to end without Windows: build with
`npx tauri build --debug --no-bundle` and run
`xvfb-run -a dbus-run-session -- sh -c 'openbox & sleep 1; ./src-tauri/target/debug/daylog'`
(install `xvfb openbox xdotool` too). A throwaway hook in `setup` that calls
`window.eval(...)` on the main window, invoking commands via
`window.__TAURI_INTERNALS__.invoke` and `fetch`-ing the result to a path the
server prints, is how steps 1–2 were checked; don't commit it.

Linux needs `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev
librsvg2-dev libxdo-dev libssl-dev` to build. Windows builds happen in CI
(`.github/workflows/desktop.yml`).

## Log

- Plan written; step 1 started.
- Step 1: `src-tauri/` added. Checked on Linux by running the built app under
  Xvfb: the page loads from `http://localhost:47615`, IPC works from that origin
  (the capability's `remote.urls`, plus an app manifest in `build.rs` — Tauri
  requires per-command permissions for remote origins), prefs are written in
  Electron's format, the server's 403/405/SPA fallback match Electron's.
  `cargo check --target x86_64-pc-windows-msvc` passes locally; the Windows
  installer is built by CI.
- Step 2: activity tracker ported. Windows reads the foreground window, process
  name, FileDescription, display-required state and idle time straight from
  Win32 (no PowerShell process any more); macOS and Linux run the same
  commands as before (`osascript`/`pmset`/`ioreg`, `xdotool`/`xprintidle`).
  Same day files, settings (`prefs.activity`) and device id (`prefs.deviceId`);
  unknown span fields are preserved. Differences from Electron: a window with
  an empty title no longer splits into 5-second spans; lock/suspend aren't
  separate events (the lock screen is a skipped window and a long gap between
  samples closes the span, as before). Live-checked on Linux (Xvfb + openbox
  - xdotool): enabling tracking records the window in front and the status
    and days commands return the same shapes as Electron's.
- Step 3: the main window is frameless (`decorations(false)`; macOS keeps its
  traffic lights via an overlay title bar). `CaptionButtons.svelte` draws
  minimize / maximize-restore / close in Windows 11's style and colours from
  `--t-chrome`, shown when the bridge says `captionButtons` (Tauri only).
  `desktop-tauri.ts` does what Electron's `-webkit-app-region: drag` did:
  pressing on `.desk-titlebar` (not on its buttons/links/inputs) and moving
  drags the window; double-click maximizes. Dragging starts on the first
  move rather than on mousedown so double-clicks still arrive. F12 /
  Ctrl+Shift+I toggle dev tools (`devtools_toggle`), Ctrl+R reloads, zoom
  keys are WebView2's own (`zoom_hotkeys_enabled`). Checked on Linux with
  xdotool: drag moves the window, maximize/restore and double-click work,
  close hides to the tray. Windows 11 snap layouts on hovering maximize are
  not available without a native caption (Win+Z and edge snapping still work).
- Step 4: `updater.rs` — reads the manifest with `ureq` (native TLS with the
  OS certificate store; redirects followed by hand, since ureq's own
  redirect handling broke on GitHub's chunked 302s behind a proxy), compares
  versions numerically, downloads to `%TEMP%\daylog-update` reporting
  progress, checks size + sha512, notifies, and runs the installer with
  `/S /UPDATE /R` on "Restart to update" (`/S /UPDATE` on quit). CI now
  writes `latest-tauri.yml` for the preview (`desktop/write-update-info.mjs`).
  A unit test serves a manifest and installer from a local server and checks
  both a good download and a tampered one; fetching the real `latest.yml`
  from GitHub was checked by hand. `DAYLOG_UPDATE_FEED` overrides the feed URL
  for testing.
