# Electron → Tauri migration

Living log of the port of the desktop app from Electron (`desktop/`) to Tauri 2
(`src-tauri/`). Updated in every PR of the migration, so anyone can pick it up
from where it stopped. **Read "Status" and "Next up" first.**

Goals: a much smaller installer, lower idle memory, faster start, and a lighter
activity tracker — with the same features and no change to the web app.

## Status

| Step | What                                                                                                                                                                                        | PR                                                          | State  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------ |
| 1    | Tauri shell: local server, main + quick windows, tray, hotkeys, reminders, prefs, launch at login, single instance, Google sign-in, bridge in `src/lib/desktop.ts`, preview installer in CI | [#7](https://github.com/Mufassir-Chowdhury/daylog/pull/7)   | merged |
| 2    | Activity tracker in Rust (Win32 on Windows, `osascript`/`xdotool` elsewhere) + tray pause menu                                                                                              | [#8](https://github.com/Mufassir-Chowdhury/daylog/pull/8)   | merged |
| 3    | Custom title bar + caption buttons, zoom/devtools/reload keys, polish                                                                                                                       | [#9](https://github.com/Mufassir-Chowdhury/daylog/pull/9)   | merged |
| 4    | Auto-updater (same `latest.yml` feed as electron-updater) + Settings → Desktop app                                                                                                          | [#10](https://github.com/Mufassir-Chowdhury/daylog/pull/10) | merged |
| 5    | Switch-over: CI ships the Tauri installer as `daylog-setup.exe`, existing Electron installs update into it, Electron removed                                                                | [#11](https://github.com/Mufassir-Chowdhury/daylog/pull/11) | merged |

## Next up

**The migration is done** (step 5 merged on 2026-10-25). What's left is
watching it in the wild:

- An Electron install picks the update up within ~4 hours of launch (or from
  tray → Check for updates), installs it on quit or on "Restart to update",
  and the Tauri app starts. Afterwards `%LOCALAPPDATA%\Programs\todo` is
  gone, the app lives in `%LOCALAPPDATA%\daylog`, and the user signs in once.
  CI's migration test (`desktop/test-migration.ps1`) runs exactly this path on a
  Windows runner for every desktop PR.
- If something goes wrong for someone: downloading `daylog-setup.exe` from the
  latest release and running it does the same migration by hand.
- `latest-tauri.yml` (for the step 1–4 previews) was published with 0.1.18
  only; releases since carry just `daylog-setup.exe` and `latest.yml`.

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
- **Same bridge API.** The Tauri bridge (`src/lib/desktop-tauri.ts`) kept the
  `DesktopBridge` shape the Electron preload had, so no page or component
  changed. Tauri is detected by `window.__TAURI_INTERNALS__`.
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

## Releases

- Steps 1–4: every push to `main` released the **Electron** installer as
  `daylog-setup.exe` + `latest.yml`, plus the **Tauri preview** as
  `daylog-tauri-setup.exe` + `latest-tauri.yml`.
- From step 5: only the Tauri installer, as `daylog-setup.exe`, with
  `latest.yml` (read by the Tauri app and by the last Electron versions).
  0.1.18 also carried a copy as `latest-tauri.yml` so the previews could
  update; it was dropped after that release.
- PRs touching the desktop app build the installer, run the Rust tests and the
  Electron → Tauri migration test, without publishing anything.

## How an Electron install becomes a Tauri one

1. electron-updater (already in the user's app) reads `latest.yml`, downloads
   the Tauri `daylog-setup.exe`, checks its sha512, and runs it with
   `--updated /S` (plus `--force-run` from "Restart to update").
2. `src-tauri/windows/hooks.nsh`, before installing: closes `daylog.exe`, runs
   Electron's own uninstaller silently in place (`/S /currentuser
_?=<dir>`; it removes its files, shortcuts and uninstall entry but keeps
   `%APPDATA%\daylog` and the Run entry), then deletes the folder.
3. Tauri's NSIS installs per user into `%LOCALAPPDATA%\daylog`; after
   installing, the hook starts the app if `--force-run` was passed.
4. First run (`migrate.rs`, once, `prefs.electronMigrated`): Run entries
   pointing at `\Programs\todo\daylog.exe` are deleted (with their
   Task Manager flags) and, if there were any, "Start with Windows" is turned
   on for the Tauri app; Chromium caches in `%APPDATA%\daylog` are deleted.
   Prefs and activity files are already in the shared format and place.

## Electron → Tauri map (Electron files removed in step 5)

| Electron (`desktop/`)                        | Tauri (`src-tauri/src/`)                       |
| -------------------------------------------- | ---------------------------------------------- |
| `main.cjs` static server + `/__desktop-auth` | `server.rs` (tiny_http, embedded assets)       |
| `BrowserWindow` main / quick                 | `windows.rs`                                   |
| `Tray`, `Menu`                               | `tray.rs`                                      |
| `globalShortcut`                             | `tauri-plugin-global-shortcut` (`hotkeys.rs`)  |
| `Notification` + reminder timers             | `notify.rs`, `reminders.rs`                    |
| `setLoginItemSettings`                       | `tauri-plugin-autostart`                       |
| `requestSingleInstanceLock`                  | `tauri-plugin-single-instance`                 |
| prefs JSON                                   | `prefs.rs`                                     |
| `ipcMain` handlers / `preload.cjs`           | `commands.rs` / `src/lib/desktop.ts`           |
| `activity.cjs`                               | `activity/mod.rs`, `activity/sampler.rs`       |
| `updater.cjs` (electron-updater)             | `updater.rs`                                   |
| electron-builder NSIS installer              | Tauri NSIS + `windows/hooks.nsh`, `migrate.rs` |

## Working on it

```sh
npm run desktop:dev      # Tauri with hot reload (starts `npm run dev` itself)
npm run desktop          # build without an installer (src-tauri/target/release/daylog)
npm run desktop:dist     # build the installer (src-tauri/target/release/bundle/nsis)
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
- Step 4 follow-up: Windows refused to start the Rust test binary
  (`STATUS_ENTRYPOINT_NOT_FOUND`) once the updater tests linked more of Tauri;
  CI now embeds a Common Controls v6 manifest (`src-tauri/windows/test.manifest`)
  into test binaries, as tauri-build does for the app.
- Step 5: switch-over. Electron code, packages and electron-builder config
  removed; CI builds only Tauri; the updater reads `latest.yml`; installer
  hooks and `migrate.rs` move Electron installs over (see "How an Electron
  install becomes a Tauri one"). `desktop/test-migration.ps1` checks it on a
  Windows runner against the real 0.1.7 Electron release: Electron removed,
  Tauri installed and relaunched, prefs kept, autostart moved, app served on
  :47615, and a Tauri self-update (`/S /UPDATE /R`) restarts the app.
  `desktop/refresh-update-info.mjs` now rewrites every `latest*.yml` after
  signing. The icons in `src-tauri/icons` come from `desktop/icons/icon.png`
  via `npx tauri icon desktop/icons/icon.png -o src-tauri/icons` (delete the
  android/ios/Square* extras it adds).
- Step 5 CI caught that electron-builder installs per-user apps into
  `Programs\<npm package name>` — `Programs\todo`, since package.json is still
  named `todo` — not `Programs\daylog`; hooks, `migrate.rs` and the test use
  that folder.
- Step 5 CI hang: `Start-Process -Wait` waited for the app the installer had
  relaunched, so the job sat for two hours; the test now waits on the
  installer process alone with a 3-minute limit, and the step and job have
  timeouts. Then the whole migration test passed on Windows (13/13) and step 5
  was merged. Note: on the elevated CI runner the autostart entry lands in
  HKLM; for normal (non-admin) users it goes to HKCU.
