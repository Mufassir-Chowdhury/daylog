//! The tray icon and its menu: open the app or the quick bar, jump to a page,
//! launch at login, quit.

use crate::{prefs, windows, AppState};
use std::sync::atomic::Ordering;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

const TRAY_ID: &str = "main";

pub fn create(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let icon = Image::from_bytes(include_bytes!("../../desktop/icons/tray@2x.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("daylog")
        .menu(&build_menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                windows::toggle_main(tray.app_handle());
            }
        })
        .build(app)
}

/// Rebuilds the menu (labels and checkmarks follow the current state).
pub fn refresh(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), build_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let p = prefs::store().get();
    // A hotkey the menu can't display is just left off.
    let item = |id: &str, label: &str, accelerator: Option<&str>| {
        MenuItem::with_id(app, id, label, true, accelerator)
            .or_else(|_| MenuItem::with_id(app, id, label, true, None::<&str>))
    };
    let sep = || PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(
        app,
        &[
            &item("open", "Open daylog", Some(&p.summon_key))?,
            &item("quick", "Quick bar", Some(&p.quick_key))?,
            &sep()?,
            &item("nav:/", "Today", None)?,
            &item("nav:/schedule", "Schedule", None)?,
            &item("nav:/finance", "Finance", None)?,
            &item("nav:/activity", "Activity", None)?,
        ],
    )?;
    for extra in crate::activity::tray_items(app)? {
        menu.append(&*extra)?;
    }
    menu.append(&sep()?)?;
    menu.append(&crate::updater::tray_item(app)?)?;
    let can_autostart = !tauri::is_dev();
    let autostart = can_autostart && app.autolaunch().is_enabled().unwrap_or(false);
    menu.append(&CheckMenuItem::with_id(
        app,
        "autostart",
        launch_label(),
        can_autostart,
        autostart,
        None::<&str>,
    )?)?;
    menu.append(&sep()?)?;
    menu.append(&item("quit", "Quit daylog", None)?)?;
    Ok(menu)
}

pub fn launch_label() -> &'static str {
    if cfg!(target_os = "macos") {
        "Open at login"
    } else if cfg!(windows) {
        "Start with Windows"
    } else {
        "Start at login"
    }
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "open" => windows::show_main(app, None),
        "quick" => windows::toggle_quick(app),
        "autostart" => {
            let on = !app.autolaunch().is_enabled().unwrap_or(false);
            set_launch_at_login(app, on);
        }
        "quit" => quit(app),
        _ => {
            if let Some(route) = id.strip_prefix("nav:") {
                windows::show_main(app, Some(route));
            } else if !crate::activity::on_menu(app, id) {
                crate::updater::on_menu(app, id);
            }
        }
    }
}

pub fn set_launch_at_login(app: &AppHandle, on: bool) {
    if tauri::is_dev() {
        return;
    }
    let launcher = app.autolaunch();
    let _ = if on {
        launcher.enable()
    } else {
        launcher.disable()
    };
    refresh(app);
}

pub fn launch_at_login(app: &AppHandle) -> bool {
    !tauri::is_dev() && app.autolaunch().is_enabled().unwrap_or(false)
}

pub fn quit(app: &AppHandle) {
    app.state::<AppState>()
        .quitting
        .store(true, Ordering::SeqCst);
    app.exit(0);
}
