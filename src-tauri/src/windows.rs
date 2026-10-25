//! The two windows: the main app, and the quick bar that floats over whatever
//! you're doing. Both load the app from the local server (server.rs).

use crate::{notify, prefs, AppState};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Monitor, PhysicalPosition,
    PhysicalSize, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

pub const MAIN: &str = "main";
pub const QUICK: &str = "quick";
const QUICK_WIDTH: f64 = 700.0;
const QUICK_HEIGHT: f64 = 480.0;

/// Links leaving the app open in the default browser instead.
fn open_external(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

fn builder<'a>(
    app: &'a AppHandle,
    label: &'a str,
    path: &str,
) -> WebviewWindowBuilder<'a, tauri::Wry, AppHandle> {
    let origin = app.state::<AppState>().origin.clone();
    let url: Url = format!("{origin}{path}").parse().expect("valid app URL");
    let nav_app = app.clone();
    let popup_app = app.clone();
    WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .on_navigation(move |url| {
            let inside = url.as_str().starts_with(&origin);
            if !inside {
                open_external(&nav_app, url);
            }
            inside
        })
        .on_new_window(move |url, _features| {
            open_external(&popup_app, &url);
            NewWindowResponse::Deny
        })
        .zoom_hotkeys_enabled(true)
        .initialization_script(format!("window.__daylogPlatform = {:?};", node_platform()))
}

/// The platform name the app expects (`process.platform` in Electron).
fn node_platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    }
}

/// Keeps the restored window on a display that still exists.
fn visible_bounds(app: &AppHandle, bounds: Option<prefs::Bounds>) -> Option<prefs::Bounds> {
    let b = bounds?;
    let monitors = app.available_monitors().ok()?;
    let overlaps = monitors.iter().any(|m| {
        let scale = m.scale_factor();
        let area = m.work_area();
        let (ax, ay) = (
            area.position.x as f64 / scale,
            area.position.y as f64 / scale,
        );
        let (aw, ah) = (
            area.size.width as f64 / scale,
            area.size.height as f64 / scale,
        );
        b.x < ax + aw && b.x + b.width > ax && b.y < ay + ah && b.y + b.height > ay
    });
    overlaps.then_some(b)
}

pub fn create_main(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let saved = prefs::store().get();
    let bounds = visible_bounds(app, saved.bounds);
    let start_hidden = state.start_hidden;
    let mut b = builder(app, MAIN, "/")
        .title("daylog")
        .inner_size(
            bounds.map_or(1280.0, |b| b.width),
            bounds.map_or(820.0, |b| b.height),
        )
        .min_inner_size(760.0, 520.0)
        .visible(false)
        .shadow(true)
        .background_color(tauri::window::Color(7, 11, 20, 255))
        .on_page_load(move |window, payload| {
            // Show once the first page has loaded, like Electron's ready-to-show.
            if payload.event() == PageLoadEvent::Finished
                && !start_hidden
                && !window
                    .app_handle()
                    .state::<AppState>()
                    .main_shown
                    .swap(true, Ordering::SeqCst)
            {
                let _ = window.show();
                let _ = window.set_focus();
            }
        });
    // The app draws its own title bar (DesktopShell.svelte) and, except on macOS,
    // its own caption buttons (CaptionButtons.svelte).
    #[cfg(target_os = "macos")]
    {
        b = b
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }
    #[cfg(not(target_os = "macos"))]
    {
        b = b.decorations(false);
    }
    if let Some(b2) = bounds {
        b = b.position(b2.x, b2.y);
    } else {
        b = b.center();
    }
    let win = b.build()?;
    if saved.maximized {
        let _ = win.maximize();
    }

    let handle = app.clone();
    win.on_window_event(move |event| match event {
        WindowEvent::Resized(_) | WindowEvent::Moved(_) => remember_bounds(&handle),
        WindowEvent::CloseRequested { api, .. } => {
            // Closing hides to the tray; Quit (tray menu) really exits.
            if handle.state::<AppState>().quitting.load(Ordering::SeqCst) {
                return;
            }
            api.prevent_close();
            if let Some(main) = handle.get_webview_window(MAIN) {
                let _ = main.hide();
            }
            tray_hint(&handle);
        }
        _ => {}
    });
    Ok(())
}

fn remember_bounds(app: &AppHandle) {
    let Some(win) = app.get_webview_window(MAIN) else {
        return;
    };
    if win.is_minimized().unwrap_or(false) || !win.is_visible().unwrap_or(false) {
        return;
    }
    let maximized = win.is_maximized().unwrap_or(false);
    let scale = win.scale_factor().unwrap_or(1.0);
    let bounds = match (win.outer_position(), win.inner_size()) {
        (Ok(pos), Ok(size)) => {
            let pos: LogicalPosition<f64> = pos.to_logical(scale);
            let size: LogicalSize<f64> = size.to_logical(scale);
            Some(prefs::Bounds {
                x: pos.x.round(),
                y: pos.y.round(),
                width: size.width.round(),
                height: size.height.round(),
            })
        }
        _ => None,
    };
    prefs::store().update(|p| {
        p.maximized = maximized;
        if !maximized && bounds.is_some() {
            p.bounds = bounds;
        }
    });
}

fn tray_hint(app: &AppHandle) {
    let shown = prefs::store().update(|p| std::mem::replace(&mut p.tray_hint_shown, true));
    if shown {
        return;
    }
    let p = prefs::store().get();
    notify::show(
        app,
        "daylog is still running",
        &format!(
            "It lives in the tray. {} brings it back; {} opens the quick bar from anywhere.",
            crate::hotkeys::pretty(&p.summon_key),
            crate::hotkeys::pretty(&p.quick_key)
        ),
        None,
    );
}

pub fn create_quick(app: &AppHandle) -> tauri::Result<()> {
    let win = builder(app, QUICK, "/quick")
        .title("daylog quick bar")
        .inner_size(QUICK_WIDTH, QUICK_HEIGHT)
        .visible(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .build()?;
    let handle = app.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            if let Some(quick) = handle.get_webview_window(QUICK) {
                if !quick.is_devtools_open() {
                    let _ = quick.hide();
                }
            }
        }
    });
    Ok(())
}

pub fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(MAIN)
}

pub fn show_main(app: &AppHandle, route: Option<&str>) {
    let Some(win) = main_window(app) else {
        return;
    };
    app.state::<AppState>()
        .main_shown
        .store(true, Ordering::SeqCst);
    if win.is_minimized().unwrap_or(false) {
        let _ = win.unminimize();
    }
    let _ = win.show();
    let _ = win.set_focus();
    if let Some(route) = route {
        let _ = win.emit_to(MAIN, "navigate", route);
    }
}

pub fn toggle_main(app: &AppHandle) {
    let Some(win) = main_window(app) else {
        return;
    };
    if win.is_visible().unwrap_or(false) && win.is_focused().unwrap_or(false) {
        let _ = win.hide();
    } else {
        show_main(app, None);
    }
}

pub fn emit_main<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    let _ = app.emit_to(MAIN, event, payload);
}

pub fn hide_quick(app: &AppHandle) {
    if let Some(quick) = app.get_webview_window(QUICK) {
        let _ = quick.hide();
    }
}

fn monitor_under_cursor(app: &AppHandle) -> Option<Monitor> {
    let cursor = app.cursor_position().ok()?;
    app.monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten())
}

pub fn toggle_quick(app: &AppHandle) {
    let Some(quick) = app.get_webview_window(QUICK) else {
        return;
    };
    if quick.is_visible().unwrap_or(false) {
        let _ = quick.hide();
        return;
    }
    // Open on whichever screen the mouse is on, a little above centre.
    if let Some(monitor) = monitor_under_cursor(app) {
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let (w, h) = (QUICK_WIDTH * scale, QUICK_HEIGHT * scale);
        let x = area.position.x as f64 + (area.size.width as f64 - w) / 2.0;
        let y = area.position.y as f64 + area.size.height as f64 * 0.18;
        let _ = quick.set_size(PhysicalSize::new(w.round() as u32, h.round() as u32));
        let _ = quick.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    }
    let _ = quick.show();
    let _ = quick.set_focus();
    let _ = quick.emit_to(QUICK, "quick:open", ());
}
