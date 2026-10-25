//! Google sign-in through the system browser. Google refuses to sign in inside
//! embedded browsers, so the app opens /desktop-auth in the user's real browser.
//! That page signs in with Google and posts the resulting Google tokens back to
//! the local server (server.rs), tagged with a one-time state value; the main
//! window then signs in to Firebase with them.

use crate::AppState;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

static PENDING: Mutex<Option<(String, Instant)>> = Mutex::new(None);

pub fn start(app: &AppHandle) {
    let mut bytes = [0u8; 24];
    if getrandom::fill(&mut bytes).is_err() {
        return;
    }
    let state: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    *PENDING.lock().unwrap() = Some((state.clone(), Instant::now() + Duration::from_secs(600)));
    let app_state = app.state::<AppState>();
    let url = format!(
        "{}/desktop-auth?state={state}&port={}",
        app_state.origin, app_state.port
    );
    let _ = app.opener().open_url(url, None::<&str>);
}

/// True (once) when `state` is the pending sign-in's and it hasn't expired.
pub fn take_if_valid(state: &str) -> bool {
    let mut pending = PENDING.lock().unwrap();
    let valid = pending.as_ref().is_some_and(|(expected, expires)| {
        Instant::now() < *expires && constant_time_eq(expected.as_bytes(), state.as_bytes())
    });
    if valid {
        *pending = None;
    }
    valid
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
