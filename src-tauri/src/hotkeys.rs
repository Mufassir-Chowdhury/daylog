//! The two global hotkeys: summon the main window, and open the quick bar from
//! any app. Accelerators are stored in Electron's format (`Control+Alt+Space`).

use crate::{prefs, windows};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// `Control+Alt+Space` → `Ctrl + Alt + Space`, for display.
pub fn pretty(accel: &str) -> String {
    accel.replace("Control", "Ctrl").replace('+', " + ")
}

/// Electron accelerator names the shortcut parser spells differently.
fn normalize(accel: &str) -> String {
    accel
        .split('+')
        .map(|part| match part {
            "Return" => "Enter",
            "Plus" => "Equal",
            other => other,
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// Registers both hotkeys; returns the ones the OS refused (taken by another app).
pub fn register(app: &AppHandle) -> Vec<String> {
    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();
    let p = prefs::store().get();
    let mut failed = Vec::new();
    let mut bind = |accel: &str, action: fn(&AppHandle)| {
        let ok = !accel.is_empty()
            && shortcuts
                .on_shortcut(normalize(accel).as_str(), move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        action(app);
                    }
                })
                .is_ok();
        if !ok {
            failed.push(accel.to_string());
        }
    };
    bind(&p.summon_key, windows::toggle_main);
    bind(&p.quick_key, windows::toggle_quick);
    failed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn electron_accelerators_parse() {
        for accel in [
            "Control+Alt+D",
            "Control+Alt+Space",
            "Control+Shift+Return",
            "Super+Up",
        ] {
            let parsed: Result<tauri_plugin_global_shortcut::Shortcut, _> =
                normalize(accel).parse();
            assert!(parsed.is_ok(), "{accel}");
        }
    }
}
