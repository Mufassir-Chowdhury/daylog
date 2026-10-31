//! What the app can ask of the desktop shell — the Tauri side of `DesktopBridge`
//! in src/lib/desktop.ts. Every argument comes from a web page, so each is
//! checked before use.

use crate::{
    activity, ai, auth, hotkeys, notify, prefs, reminders, tray, updater, windows, AppState,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewWindow};

#[tauri::command]
pub fn window_hide(window: WebviewWindow) {
    let _ = window.hide();
}

#[tauri::command]
pub fn window_minimize(window: WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
pub fn window_toggle_maximize(window: WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
pub fn devtools_toggle(window: WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

/// `#rrggbb` → a colour.
fn parse_hex(color: &str) -> Option<tauri::window::Color> {
    let hex = color.trim().strip_prefix('#')?;
    if hex.len() != 6 {
        return None;
    }
    let channel = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some(tauri::window::Color(
        channel(0)?,
        channel(2)?,
        channel(4)?,
        255,
    ))
}

#[tauri::command]
pub fn titlebar_colors(window: WebviewWindow, color: String, symbol_color: String) {
    if window.label() != windows::MAIN {
        return;
    }
    let _ = symbol_color;
    if let Some(color) = parse_hex(&color) {
        let _ = window.set_background_color(Some(color));
    }
}

#[tauri::command]
pub fn quick_hide(app: AppHandle) {
    windows::hide_quick(&app);
}

#[tauri::command]
pub fn quick_navigate(app: AppHandle, route: String) {
    windows::hide_quick(&app);
    if route.starts_with('/') {
        windows::show_main(&app, Some(&route));
    }
}

#[tauri::command]
pub fn quick_capture(app: AppHandle, entry: Value) {
    windows::emit_main(&app, "capture", entry);
}

#[tauri::command]
pub fn reminders_set(list: Vec<reminders::Reminder>) {
    reminders::set(list);
}

/// A notification now (the assistant's check-ins); clicking it opens `route`.
#[tauri::command]
pub fn notify_show(app: AppHandle, title: String, body: String, route: String) {
    let route = if route.is_empty() { "/".into() } else { route };
    notify::show(&app, &title, &body, Some(route));
}

#[tauri::command]
pub fn auth_google_start(app: AppHandle) {
    auth::start(&app);
}

#[tauri::command]
pub fn prefs_get(app: AppHandle) -> Value {
    let p = prefs::store().get();
    let failed = app
        .state::<AppState>()
        .hotkey_failures
        .lock()
        .unwrap()
        .clone();
    json!({
        "summonKey": p.summon_key,
        "quickKey": p.quick_key,
        "launchAtLogin": tray::launch_at_login(&app),
        "canLaunchAtLogin": !tauri::is_dev(),
        "failed": failed
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefsPatch {
    summon_key: Option<String>,
    quick_key: Option<String>,
    launch_at_login: Option<bool>,
}

#[tauri::command]
pub fn prefs_set(app: AppHandle, patch: PrefsPatch) -> Value {
    let store = prefs::store();
    let before = store.get();
    store.update(|p| {
        if let Some(key) = patch.summon_key {
            p.summon_key = key;
        }
        if let Some(key) = patch.quick_key {
            p.quick_key = key;
        }
    });
    if let Some(on) = patch.launch_at_login {
        tray::set_launch_at_login(&app, on);
    }
    let state = app.state::<AppState>();
    let failed = hotkeys::register(&app);
    if !failed.is_empty() {
        // Roll back to the keys that worked rather than leave a hotkey dead.
        store.update(|p| {
            p.summon_key = before.summon_key;
            p.quick_key = before.quick_key;
        });
        *state.hotkey_failures.lock().unwrap() = hotkeys::register(&app);
        let names: Vec<String> = failed.iter().map(|k| hotkeys::pretty(k)).collect();
        return json!({ "ok": false, "error": format!("{} is taken or invalid", names.join(", ")) });
    }
    state.hotkey_failures.lock().unwrap().clear();
    tray::refresh(&app);
    json!({ "ok": true })
}

#[tauri::command]
pub fn activity_status() -> Value {
    activity::status()
}

#[tauri::command]
pub fn activity_set(app: AppHandle, patch: Value) -> Value {
    activity::set(&app, &patch);
    activity::status()
}

#[tauri::command]
pub fn activity_days(from: String, to: String) -> Value {
    activity::days(&from, &to)
}

#[tauri::command]
pub fn activity_clear() {
    activity::clear();
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> updater::Status {
    updater::status(&app)
}

#[tauri::command]
pub fn update_check() -> updater::Status {
    updater::check()
}

#[tauri::command]
pub fn update_install(app: AppHandle) {
    updater::install(&app);
}

#[tauri::command]
pub async fn ai_fetch(request: ai::HttpRequest) -> Result<ai::HttpResponse, String> {
    tauri::async_runtime::spawn_blocking(move || ai::fetch(request))
        .await
        .map_err(|e| e.to_string())?
}

/// Which providers have a key on this computer — never the keys themselves.
#[tauri::command]
pub async fn ai_keys() -> Value {
    tauri::async_runtime::spawn_blocking(|| {
        let mut out = serde_json::Map::new();
        for provider in ai::Provider::ALL {
            out.insert(provider.id().into(), ai::has_key(provider).into());
        }
        Value::Object(out)
    })
    .await
    .unwrap_or_else(|_| json!({}))
}

/// Saves a provider's key, or forgets it with `null`.
#[tauri::command]
pub async fn ai_key_set(provider: ai::Provider, key: Option<String>) -> Value {
    let result =
        tauri::async_runtime::spawn_blocking(move || ai::set_key(provider, key.as_deref())).await;
    match result {
        Ok(Ok(())) => json!({ "ok": true }),
        Ok(Err(error)) => json!({ "ok": false, "error": error }),
        Err(error) => json!({ "ok": false, "error": error.to_string() }),
    }
}
