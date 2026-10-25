//! Desktop notifications. Clicking one with a route opens the main window there.

use crate::{updater, windows};
use tauri::AppHandle;

/// A "route" that installs the downloaded update instead of opening a page.
pub const INSTALL_UPDATE: &str = "app:install-update";

fn on_click(app: &AppHandle, route: Option<&str>) {
    if route == Some(INSTALL_UPDATE) {
        updater::install(app);
    } else {
        windows::show_main(app, route);
    }
}

#[cfg(windows)]
pub fn show(app: &AppHandle, title: &str, body: &str, route: Option<String>) {
    use tauri_winrt_notification::Toast;
    // Installed builds have a Start-menu shortcut carrying the app's id, which names
    // the toast and gives it the icon; dev runs borrow PowerShell's.
    let app_id = if tauri::is_dev() {
        Toast::POWERSHELL_APP_ID.to_string()
    } else {
        app.config().identifier.clone()
    };
    let handle = app.clone();
    let _ = Toast::new(&app_id)
        .title(title)
        .text1(body)
        .on_activated(move |_| {
            on_click(&handle, route.as_deref());
            Ok(())
        })
        .show();
}

#[cfg(not(windows))]
pub fn show(app: &AppHandle, title: &str, body: &str, route: Option<String>) {
    let mut n = notify_rust::Notification::new();
    n.summary(title).body(body).appname("daylog");
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        n.action("default", "Open");
        if let Ok(handle) = n.show() {
            let app = app.clone();
            std::thread::spawn(move || {
                handle.wait_for_action(|action| {
                    if action == "default" {
                        on_click(&app, route.as_deref());
                    }
                });
            });
        }
    }
    #[cfg(target_os = "macos")]
    {
        let _ = (app, route);
        let _ = n.show();
    }
}
