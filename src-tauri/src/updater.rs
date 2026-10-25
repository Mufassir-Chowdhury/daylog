//! Auto-update — ported from desktop/updater.cjs in step 4 of the migration
//! (docs/tauri-migration.md). Until then this build reports updates as
//! unsupported.

use serde_json::{json, Value};
use tauri::menu::MenuItem;
use tauri::{AppHandle, Wry};

pub fn status(app: &AppHandle) -> Value {
    json!({
        "state": "unsupported",
        "current": app.package_info().version.to_string(),
        "version": "",
        "percent": 0,
        "error": "",
        "checkedAt": 0
    })
}

pub fn tray_item(app: &AppHandle) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(
        app,
        "update:check",
        "Check for updates",
        false,
        None::<&str>,
    )
}

pub fn on_menu(_app: &AppHandle, _id: &str) {}
