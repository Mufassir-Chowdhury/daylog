//! The assistant's clock. The main window's webview is throttled while hidden
//! in the tray, so its own timers can't be trusted to run a check-in on time
//! or to keep the check-in lease renewed. This thread tells the window
//! `assistant:tick` at the start of every minute; the app renews the lease
//! and runs whatever check-in is due (check-in times are whole minutes).

use crate::windows;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

/// A little past the minute, so the app's clock has turned over too.
const PAST_THE_MINUTE_MS: u64 = 1_000;

/// How long to sleep from `now_ms` until just past the next minute.
fn until_next_minute(now_ms: u64) -> Duration {
    let into = now_ms % 60_000;
    let wait = 60_000 - into + PAST_THE_MINUTE_MS;
    // Already just past the minute: wait for the next one, not a second.
    Duration::from_millis(if wait > 60_000 { wait - 60_000 } else { wait }.max(1))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        // Re-reading the clock each time keeps it right after the computer sleeps.
        std::thread::sleep(until_next_minute(now_ms()));
        windows::emit_main(&app, "assistant:tick", now_ms());
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wakes_just_past_each_minute() {
        // 08:59:30 → wait until 09:00:01.
        assert_eq!(
            until_next_minute(59 * 60_000 + 30_000),
            Duration::from_millis(31_000)
        );
        // Right on the minute → 1 s later.
        assert_eq!(until_next_minute(60_000), Duration::from_millis(1_000));
        // Half a second past → half a second more.
        assert_eq!(until_next_minute(60_500), Duration::from_millis(500));
        // Just after the tick → the next minute.
        assert_eq!(until_next_minute(61_000), Duration::from_millis(60_000));
    }
}
