//! Reminders for timed lines. The app sends today's upcoming ones about once a
//! minute; one scheduler thread fires them, since the webview is throttled while
//! the window is hidden.

use crate::notify;
use serde::Deserialize;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

#[derive(Clone, Debug, Deserialize)]
pub struct Reminder {
    /// Epoch millis.
    #[serde(default)]
    pub at: f64,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub route: String,
}

static QUEUE: Mutex<Vec<Reminder>> = Mutex::new(Vec::new());
static WAKE: Condvar = Condvar::new();

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_millis() as f64)
}

/// Replaces the pending reminders.
pub fn set(list: Vec<Reminder>) {
    let now = now_ms();
    let horizon = now + 36.0 * 3600.0 * 1000.0;
    *QUEUE.lock().unwrap() = list
        .into_iter()
        .filter(|r| r.at > now && r.at <= horizon)
        .collect();
    WAKE.notify_all();
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut queue = QUEUE.lock().unwrap();
        loop {
            let now = now_ms();
            let (due, later): (Vec<_>, Vec<_>) = queue.drain(..).partition(|r| r.at <= now);
            *queue = later;
            if !due.is_empty() {
                drop(queue);
                for r in due {
                    let title = if r.title.is_empty() {
                        "daylog"
                    } else {
                        &r.title
                    };
                    let route = if r.route.is_empty() {
                        "/".into()
                    } else {
                        r.route.clone()
                    };
                    notify::show(&app, title, &r.body, Some(route));
                }
                queue = QUEUE.lock().unwrap();
                continue;
            }
            let next = queue.iter().map(|r| r.at).fold(f64::INFINITY, f64::min);
            // Wake at least every minute: sleep doesn't count down while the computer is asleep.
            let wait = if next.is_finite() {
                (next - now).min(60_000.0)
            } else {
                60_000.0
            };
            queue = WAKE
                .wait_timeout(queue, Duration::from_millis(wait.max(1.0) as u64))
                .unwrap()
                .0;
        }
    });
}
