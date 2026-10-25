const COMMANDS: &[&str] = &[
    "window_hide",
    "window_minimize",
    "window_toggle_maximize",
    "titlebar_colors",
    "quick_hide",
    "quick_navigate",
    "quick_capture",
    "reminders_set",
    "auth_google_start",
    "prefs_get",
    "prefs_set",
    "activity_status",
    "activity_set",
    "activity_days",
    "activity_clear",
    "update_status",
    "update_check",
    "update_install",
];

fn main() {
    // The app's pages load from the local server, a remote origin to Tauri, so
    // every command needs a permission (granted in capabilities/default.json).
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
