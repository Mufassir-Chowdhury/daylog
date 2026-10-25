# Electron → Tauri migration

Living log of the port of the desktop app from Electron (`desktop/`) to Tauri 2
(`src-tauri/`). Updated in every PR of the migration, so anyone can pick it up
from where it stopped. **Read "Status" and "Next up" first.**

Goals: a much smaller installer, lower idle memory, faster start, and a lighter
activity tracker — with the same features and no change to the web app.

## Status

| Step | What                                                                                                                                                                                        | PR        | State     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------- |
| 1    | Tauri shell: local server, main + quick windows, tray, hotkeys, reminders, prefs, launch at login, single instance, Google sign-in, bridge in `src/lib/desktop.ts`, preview installer in CI | (this PR) | in review |
| 2    | Activity tracker in Rust (Win32 on Windows, `osascript`/`xdotool` elsewhere) + tray pause menu                                                                                              | —         | todo      |
| 3    | Custom title bar + caption buttons, zoom/devtools/reload keys, polish                                                                                                                       | —         | todo      |
| 4    | Auto-updater (same `latest.yml` feed as electron-updater) + Settings → Desktop app                                                                                                          | —         | todo      |
| 5    | Switch-over: CI ships the Tauri installer as `daylog-setup.exe`, existing Electron installs update into it, Electron removed                                                                | —         | todo      |

## Next up

Step 2: port `desktop/activity.cjs` to `src-tauri/src/activity.rs` (today a stub
returning `null`, so the Activity page says tracking isn't available), wire the
four `activity_*` commands in `commands.rs`, and add the pause items to the tray
(`activity::tray_items` / `activity::on_menu` are already called by `tray.rs`).

Known gaps in the preview until later steps:

- no activity tracking (step 2);
- the native title bar sits above the app's own one, which still leaves room on
  the right for Electron's caption buttons (step 3);
- no auto-update (step 4) — install new previews by hand.

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
| `activity.cjs`                               | `activity/` (step 2)                          |
| `updater.cjs` (electron-updater)             | `updater.rs` (step 4)                         |

## Working on it

```sh
npm run tauri:dev        # Tauri against `npm run dev` (start that first)
npm run tauri:build      # desktop:build + Tauri installer (src-tauri/target/release/bundle)
```

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
