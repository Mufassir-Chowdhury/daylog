//! Activity tracking — ported from desktop/activity.cjs in step 2 of the
//! migration (docs/tauri-migration.md). Until then the Activity page shows
//! tracking as unavailable on this build.

use tauri::menu::IsMenuItem;
use tauri::{AppHandle, Wry};

pub fn tray_items(_app: &AppHandle) -> tauri::Result<Vec<Box<dyn IsMenuItem<Wry>>>> {
    Ok(Vec::new())
}

/// Handles an activity tray item; false when `id` isn't one.
pub fn on_menu(_app: &AppHandle, _id: &str) -> bool {
    false
}
