//! daylog desktop — a Tauri shell around the same SvelteKit app the web build
//! serves. It stays running in the tray, answers two global hotkeys (summon the
//! window, open the quick bar from any app), fires reminders for timed lines,
//! signs in with Google through the system browser, keeps the assistant's
//! check-ins on time while hidden (assistant.rs), tracks which apps you use
//! (opt-in, see activity/), keeps itself up to date (updater.rs), and
//! remembers its window size, and lets Claude Desktop / Claude Code use
//! daylog's tools (mcp.rs). docs/tauri-migration.md tells how it replaced the
//! Electron app.

mod activity;
mod ai;
mod assistant;
mod auth;
mod commands;
mod hotkeys;
mod mcp;
mod migrate;
mod notify;
mod prefs;
mod reminders;
mod server;
mod tray;
mod updater;
mod voice;
mod windows;

use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::{Manager, RunEvent};
use tauri_plugin_autostart::MacosLauncher;

pub struct AppState {
    /// Where the windows load the app from: the local server, or Vite in dev.
    pub origin: String,
    /// The local server's port (it also receives Google sign-ins in dev).
    pub port: u16,
    pub start_hidden: bool,
    pub main_shown: AtomicBool,
    pub quitting: AtomicBool,
    /// Hotkeys the OS refused at the last registration, shown in Settings.
    pub hotkey_failures: Mutex<Vec<String>>,
}

/// `daylog --mcp`: the stdio bridge Claude Desktop / Claude Code start (mcp.rs).
pub fn mcp_bridge() -> i32 {
    mcp::bridge()
}

pub fn run() {
    let start_hidden = std::env::args().any(|a| a == "--hidden");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::show_main(app, None);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::window_hide,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::devtools_toggle,
            commands::titlebar_colors,
            commands::quick_hide,
            commands::quick_navigate,
            commands::quick_capture,
            commands::reminders_set,
            commands::notify_show,
            commands::auth_google_start,
            commands::prefs_get,
            commands::prefs_set,
            commands::activity_status,
            commands::activity_set,
            commands::activity_days,
            commands::activity_clear,
            commands::update_status,
            commands::update_check,
            commands::update_install,
            commands::ai_fetch,
            commands::ai_keys,
            commands::ai_key_set,
            commands::voice_speak,
            commands::voice_transcribe,
            commands::mcp_status,
            commands::mcp_set,
            commands::mcp_ready,
            commands::mcp_reply,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let port = server::start(&handle).ok_or("No free port for the local server")?;
            let origin = if tauri::is_dev() {
                std::env::var("DAYLOG_DEV_URL").unwrap_or_else(|_| "http://localhost:5173".into())
            } else {
                format!("http://localhost:{port}")
            };
            app.manage(AppState {
                origin,
                port,
                start_hidden,
                main_shown: AtomicBool::new(false),
                quitting: AtomicBool::new(false),
                hotkey_failures: Mutex::new(Vec::new()),
            });
            windows::create_main(&handle)?;
            windows::create_quick(&handle)?;
            updater::start(&handle);
            tray::create(&handle)?;
            reminders::start(handle.clone());
            assistant::start(handle.clone());
            activity::start(handle.clone());
            migrate::run(&handle);
            if !tauri::is_dev() && !prefs::store().get().launch_at_login_defaulted {
                tray::set_launch_at_login(&handle, true);
                prefs::store().update(|p| p.launch_at_login_defaulted = true);
            }
            let failed = hotkeys::register(&handle);
            *app.state::<AppState>().hotkey_failures.lock().unwrap() = failed;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building daylog");

    app.run(|_app, event| match event {
        // Keep running in the tray when every window is closed or hidden.
        RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        RunEvent::Exit => {
            activity::shutdown();
            prefs::store().save_now();
            updater::install_on_quit();
        }
        _ => {}
    });
}
