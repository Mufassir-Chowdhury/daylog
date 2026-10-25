//! Activity tracking — which app (and window) is in front, sampled every few
//! seconds, stored as time spans in one JSON file per day under the user-data
//! folder. The app reads the files over IPC, syncs them to the user's account
//! (src/lib/activity-sync.ts) and does all the analysis (src/lib/activity.ts).
//!
//! A web page can't see other apps, which is why this lives in the desktop shell.
//! Windows reads the foreground window straight from Win32; macOS and Linux shell
//! out once per sample (sampler.rs). Same files, settings and behaviour as the
//! Electron tracker it replaces (desktop/activity.cjs).
//!
//! No keyboard or mouse input normally means the user stepped away, but not
//! while a video or call is playing: Windows and macOS report when some app is
//! keeping the display awake, which players and browsers do during playback.

mod sampler;

use crate::{prefs, tray};
use chrono::{Local, LocalResult, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::menu::{IsMenuItem, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

pub use sampler::Sample;

const SAMPLE_SECONDS: u64 = 5;
/// A gap longer than this between samples (sleep, a stalled sampler) ends the span.
const MAX_GAP: i64 = SAMPLE_SECONDS as i64 * 3 * 1000;
const FLUSH_EVERY: Duration = Duration::from_secs(60);
/// Even a playing video stops counting after this long without input (fell asleep watching).
const MEDIA_MAX_IDLE: i64 = 3 * 3600 * 1000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub enabled: bool,
    /// Record window titles (needed for browser sites and per-document breakdowns).
    pub titles: bool,
    /// Minutes without keyboard or mouse input before time stops counting.
    pub idle_minutes: f64,
    /// App or process names never recorded.
    pub exclude: Vec<String>,
    pub retention_days: f64,
    /// Epoch millis tracking resumes at, or 0 when not paused.
    pub paused_until: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: false,
            titles: true,
            idle_minutes: 5.0,
            exclude: Vec::new(),
            retention_days: 90.0,
            paused_until: 0.0,
        }
    }
}

/// One stretch of time with the same window in front. Fields this file doesn't
/// know about are kept as they are.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Span {
    pub s: i64,
    pub e: i64,
    #[serde(default)]
    pub exe: String,
    #[serde(default)]
    pub app: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// Local `YYYY-MM-DD` of an epoch-millis time.
fn day_key(ms: i64) -> String {
    match Local.timestamp_millis_opt(ms) {
        LocalResult::Single(t) | LocalResult::Ambiguous(t, _) => t.format("%Y-%m-%d").to_string(),
        LocalResult::None => String::new(),
    }
}

/// Local midnight after `ms`.
fn next_midnight(ms: i64) -> i64 {
    let Some(t) = Local.timestamp_millis_opt(ms).earliest() else {
        return ms + 86_400_000;
    };
    let tomorrow = t.date_naive().succ_opt().unwrap_or(t.date_naive());
    tomorrow
        .and_time(NaiveTime::MIN)
        .and_local_timezone(Local)
        .earliest()
        .map_or(ms + 86_400_000, |m| m.timestamp_millis())
}

fn is_day_key(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            _ => c.is_ascii_digit(),
        })
}

/// Truncates to at most `max` characters (JS `slice` counts UTF-16 units; close enough).
fn clip(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Players and call apps: being in front of one without typing is still watching or listening.
const MEDIA_APPS: &[&str] = &[
    "vlc",
    "mpc-hc",
    "mpc-hc64",
    "mpc-be64",
    "mpv",
    "potplayer",
    "potplayermini64",
    "wmplayer",
    "video.ui",
    "microsoft.media.player",
    "kodi",
    "plex",
    "netflix",
    "iina",
    "quicktime player",
    "tv",
    "zoom",
    "teams",
    "ms-teams",
    "webex",
    "skype",
];
/// Only used where the OS can't say whether the display is being kept awake (Linux).
const MEDIA_TITLES: &[&str] = &[
    "youtube",
    "netflix",
    "prime video",
    "twitch",
    "disney+",
    "hulu",
    "vimeo",
    "google meet",
    "coursera",
    "udemy",
];

/// `needle` (lowercase) appears in `haystack` as a whole word.
fn contains_word(haystack: &str, needle: &str) -> bool {
    let hay = haystack.to_lowercase();
    let is_word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
    hay.match_indices(needle).any(|(i, _)| {
        let before = hay[..i].chars().next_back();
        let after = hay[i + needle.len()..].chars().next();
        let ends_in_word = needle
            .chars()
            .next_back()
            .is_some_and(|c| c.is_alphanumeric());
        !is_word(before) && (!ends_in_word || !is_word(after))
    })
}

/// True while the sample looks like watching a video or sitting in a call.
fn watching_media(sample: &Sample) -> bool {
    let media_app = [&sample.exe, &sample.app]
        .iter()
        .any(|n| MEDIA_APPS.contains(&n.to_lowercase().as_str()));
    if media_app {
        return true;
    }
    if let Some(media) = sample.media {
        return media;
    }
    MEDIA_TITLES.iter().any(|t| contains_word(&sample.title, t))
}

struct Tracker {
    dir: PathBuf,
    days: HashMap<String, Vec<Span>>,
    dirty: HashSet<String>,
    /// The span being extended by each sample: its day and index in that day.
    open: Option<(String, usize)>,
    last_sample_at: i64,
    error: String,
    last_flush: Instant,
}

impl Tracker {
    fn file(&self, key: &str) -> PathBuf {
        self.dir.join(format!("{key}.json"))
    }

    fn load(&mut self, key: &str) -> &mut Vec<Span> {
        if !self.days.contains_key(key) {
            let spans = std::fs::read_to_string(self.file(key))
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            self.days.insert(key.to_string(), spans);
        }
        self.days.get_mut(key).unwrap()
    }

    fn open_span(&mut self) -> Option<&mut Span> {
        let (key, i) = self.open.clone()?;
        self.days.get_mut(&key)?.get_mut(i)
    }

    fn flush(&mut self) {
        self.last_flush = Instant::now();
        if self.dirty.is_empty() {
            return;
        }
        if std::fs::create_dir_all(&self.dir).is_err() {
            return;
        }
        for key in &self.dirty {
            let spans = self.days.get(key).map_or(&[][..], |v| &v[..]);
            let Ok(json) = serde_json::to_string(spans) else {
                continue;
            };
            if std::fs::write(self.file(key), json).is_err() {
                // Disk full or read-only — keep the data in memory and retry next flush.
                return;
            }
        }
        self.dirty.clear();
        // Only today (and an open span's day) need to stay in memory.
        let today = day_key(now_ms());
        let open_day = self.open.as_ref().map(|(k, _)| k.clone());
        self.days
            .retain(|k, _| *k == today || Some(k) == open_day.as_ref());
    }

    fn prune(&self, settings: &Settings) {
        let cutoff = day_key(now_ms() - (settings.retention_days * 86_400_000.0) as i64);
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return; // no folder yet
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if let Some(key) = name.strip_suffix(".json") {
                if is_day_key(key) && key < cutoff.as_str() {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }

    /// Ends the open span at `at` (never before it started).
    fn close(&mut self, at: i64) {
        let Some((key, i)) = self.open.take() else {
            return;
        };
        let Some(spans) = self.days.get_mut(&key) else {
            return;
        };
        let Some(span) = spans.get_mut(i) else {
            return;
        };
        span.e = span.s.max(at.min(span.e + MAX_GAP));
        if span.e - span.s < 1000 && i + 1 == spans.len() {
            // A blink — drop it rather than litter the day with zero-length spans.
            spans.pop();
        }
        self.dirty.insert(key);
    }

    /// Cuts today's spans back to `at` — the user left when input stopped, not when we noticed.
    fn trim_after(&mut self, at: i64) {
        let key = day_key(now_ms());
        let mut changed = false;
        let spans = self.load(&key);
        while let Some(last) = spans.last_mut() {
            if last.e <= at {
                break;
            }
            last.e = last.s.max(at);
            changed = true;
            if last.e - last.s >= 1000 {
                break;
            }
            spans.pop();
        }
        if changed {
            self.dirty.insert(key);
        }
    }

    fn begin(&mut self, at: i64, sample: &Sample, settings: &Settings) {
        let key = day_key(at);
        let title = span_title(sample, settings);
        let spans = self.load(&key);
        spans.push(Span {
            s: at,
            e: at,
            exe: sample.exe.clone(),
            app: sample.app.clone(),
            title,
            extra: Map::new(),
        });
        let i = spans.len() - 1;
        self.dirty.insert(key.clone());
        self.open = Some((key, i));
    }

    fn on_sample(&mut self, sample: Option<Sample>, idle_ms: i64, settings: &Settings) {
        let now = now_ms();
        let gap = now - self.last_sample_at;
        self.last_sample_at = now;
        self.error.clear();
        let watching = sample
            .as_ref()
            .is_some_and(|s| idle_ms < MEDIA_MAX_IDLE && watching_media(s));
        let is_idle = idle_ms as f64 >= settings.idle_minutes * 60_000.0 && !watching;
        let excluded = sample.as_ref().is_some_and(|s| excluded(s, settings));
        let sample = match sample {
            Some(s) if active(settings) && !is_idle && !excluded => s,
            _ => {
                self.close(now);
                if is_idle {
                    self.trim_after(now - idle_ms);
                }
                return;
            }
        };
        let title = span_title(&sample, settings);
        let same = self
            .open_span()
            .is_some_and(|o| o.exe == sample.exe && o.app == sample.app && o.title == title);
        let open_s = self.open_span().map(|o| (o.s, o.e));
        if let Some((s, e)) = open_s {
            if gap > MAX_GAP {
                self.close(e);
            } else if day_key(s) != day_key(now) {
                // Crossing midnight: finish yesterday's span and carry on in today's file.
                let midnight = next_midnight(s);
                if let Some(o) = self.open_span() {
                    o.e = midnight;
                }
                if let Some((key, _)) = self.open.take() {
                    self.dirty.insert(key);
                }
                if same {
                    self.begin(midnight, &sample, settings);
                }
            }
        }
        if self.open.is_some() && same {
            if let Some(o) = self.open_span() {
                o.e = now;
            }
            let key = self.open.as_ref().unwrap().0.clone();
            self.dirty.insert(key);
        } else {
            self.close(now);
            self.begin(now, &sample, settings);
        }
    }

    /// Spans for every day from `from` to `to` (inclusive day keys) that has any.
    fn days(&mut self, from: &str, to: &str) -> Value {
        let mut out = Map::new();
        if !is_day_key(from) || !is_day_key(to) {
            return Value::Object(out);
        }
        let mut keys: HashSet<String> = self.days.keys().cloned().collect();
        if let Ok(entries) = std::fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if let Some(key) = name.strip_suffix(".json") {
                    keys.insert(key.to_string());
                }
            }
        }
        for key in keys {
            if key.as_str() < from || key.as_str() > to {
                continue;
            }
            let spans = self.load(&key);
            if !spans.is_empty() {
                out.insert(key, serde_json::to_value(&*spans).unwrap_or(Value::Null));
            }
        }
        Value::Object(out)
    }
}

/// The title a span records for `sample`: none when titles are off or empty.
fn span_title(sample: &Sample, settings: &Settings) -> Option<String> {
    (settings.titles && !sample.title.is_empty()).then(|| clip(&sample.title, 300))
}

fn excluded(sample: &Sample, settings: &Settings) -> bool {
    let names = [sample.exe.to_lowercase(), sample.app.to_lowercase()];
    settings
        .exclude
        .iter()
        .any(|x| names.contains(&x.to_lowercase()))
}

fn active(settings: &Settings) -> bool {
    settings.enabled && (now_ms() as f64) >= settings.paused_until
}

fn settings() -> Settings {
    prefs::store().get().activity.unwrap_or_default()
}

static TRACKER: OnceLock<Mutex<Tracker>> = OnceLock::new();

fn tracker() -> &'static Mutex<Tracker> {
    TRACKER.get_or_init(|| {
        Mutex::new(Tracker {
            dir: prefs::data_dir().join("activity"),
            days: HashMap::new(),
            dirty: HashSet::new(),
            open: None,
            last_sample_at: now_ms(),
            error: String::new(),
            last_flush: Instant::now(),
        })
    })
}

/// Names this computer's synced activity, so several computers don't overwrite each other.
fn device_id() -> String {
    let store = prefs::store();
    if let Some(id) = store.get().device_id {
        return id;
    }
    let mut bytes = [0u8; 16];
    let _ = getrandom::fill(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let id = format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    );
    store.update(|p| p.device_id = Some(id.clone()));
    id
}

/// Starts the sampling loop. It runs for the app's lifetime and only samples
/// while tracking is on.
pub fn start(app: AppHandle) {
    device_id();
    tracker().lock().unwrap().prune(&settings());
    std::thread::spawn(move || {
        let mut sampler = sampler::Sampler::new();
        let mut menu_key = String::new();
        let mut was_enabled = false;
        loop {
            let s = settings();
            if s.enabled {
                if !was_enabled {
                    tracker().lock().unwrap().last_sample_at = now_ms();
                }
                let result = sampler.sample();
                let idle = sampler::idle_ms();
                let mut t = tracker().lock().unwrap();
                match result {
                    Ok(sample) => t.on_sample(sample, idle, &s),
                    Err(Some(message)) => t.error = message,
                    Err(None) => {}
                }
                if t.last_flush.elapsed() >= FLUSH_EVERY {
                    t.flush();
                }
            } else if was_enabled {
                let mut t = tracker().lock().unwrap();
                t.close(now_ms());
                t.flush();
            }
            was_enabled = s.enabled;
            // Rebuild the tray menu when tracking turns on/off or a pause starts/ends.
            let key = format!("{}:{}", s.enabled, paused_until(&s));
            if key != menu_key {
                menu_key = key;
                tray::refresh(&app);
            }
            std::thread::sleep(Duration::from_secs(SAMPLE_SECONDS));
        }
    });
}

fn paused_until(s: &Settings) -> f64 {
    if s.paused_until > now_ms() as f64 {
        s.paused_until
    } else {
        0.0
    }
}

fn node_platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    }
}

pub fn status() -> Value {
    let s = settings();
    let t = tracker().lock().unwrap();
    let current = if active(&s) {
        t.open.as_ref().and_then(|(k, i)| t.days.get(k)?.get(*i)).map(|o| {
            json!({ "app": o.app, "exe": o.exe, "title": o.title.clone().unwrap_or_default(), "since": o.s })
        })
    } else {
        None
    };
    json!({
        "enabled": s.enabled,
        "titles": s.titles,
        "idleMinutes": s.idle_minutes,
        "exclude": s.exclude,
        "retentionDays": s.retention_days,
        "pausedUntil": paused_until(&s),
        "device": { "id": device_id(), "name": gethostname::gethostname().to_string_lossy() },
        "platform": node_platform(),
        "error": t.error,
        "current": current,
    })
}

/// Applies a settings patch from the app, checking every field.
pub fn set(app: &AppHandle, patch: &Value) {
    let now = now_ms();
    let mut close = false;
    let mut prune = false;
    let s = prefs::store().update(|p| {
        let s = p.activity.get_or_insert_with(Settings::default);
        if let Some(on) = patch.get("enabled").and_then(Value::as_bool) {
            s.enabled = on;
        }
        if let Some(on) = patch.get("titles").and_then(Value::as_bool) {
            s.titles = on;
            close = true;
        }
        let number = |k: &str| {
            patch
                .get(k)
                .and_then(Value::as_f64)
                .filter(|n| n.is_finite())
        };
        if let Some(n) = number("idleMinutes") {
            s.idle_minutes = n.round().clamp(1.0, 60.0);
        }
        if let Some(n) = number("retentionDays") {
            s.retention_days = n.round().clamp(7.0, 3650.0);
            prune = true;
        }
        if let Some(n) = number("pausedUntil") {
            s.paused_until = n.max(0.0);
            if s.paused_until > now as f64 {
                close = true;
            }
        }
        if let Some(list) = patch.get("exclude").and_then(Value::as_array) {
            s.exclude = list
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|x| !x.is_empty())
                .map(|x| clip(x, 100))
                .take(100)
                .collect();
        }
        s.clone()
    });
    let mut t = tracker().lock().unwrap();
    if close || !s.enabled {
        t.close(now);
    }
    if !s.enabled {
        t.flush();
    }
    if prune {
        t.prune(&s);
    }
    drop(t);
    tray::refresh(app);
}

pub fn days(from: &str, to: &str) -> Value {
    tracker().lock().unwrap().days(from, to)
}

/// Deletes everything recorded so far.
pub fn clear() {
    let mut t = tracker().lock().unwrap();
    t.open = None;
    t.days.clear();
    t.dirty.clear();
    let _ = std::fs::remove_dir_all(&t.dir);
}

/// Writes pending spans to disk — call before quitting.
pub fn shutdown() {
    if let Some(t) = TRACKER.get() {
        let mut t = t.lock().unwrap();
        t.close(now_ms());
        t.flush();
    }
}

pub fn tray_items(app: &AppHandle) -> tauri::Result<Vec<Box<dyn IsMenuItem<Wry>>>> {
    let s = settings();
    if !s.enabled {
        return Ok(Vec::new());
    }
    let sep: Box<dyn IsMenuItem<Wry>> = Box::new(PredefinedMenuItem::separator(app)?);
    if paused_until(&s) > 0.0 {
        let resume = MenuItem::with_id(
            app,
            "activity:resume",
            "Resume activity tracking",
            true,
            None::<&str>,
        )?;
        return Ok(vec![sep, Box::new(resume)]);
    }
    let pause = Submenu::with_items(
        app,
        "Pause activity tracking",
        true,
        &[
            &MenuItem::with_id(
                app,
                "activity:pause:30",
                "For 30 minutes",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, "activity:pause:60", "For an hour", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "activity:pause:tomorrow",
                "Until tomorrow",
                true,
                None::<&str>,
            )?,
        ],
    )?;
    Ok(vec![sep, Box::new(pause)])
}

/// Handles an activity tray item; false when `id` isn't one.
pub fn on_menu(app: &AppHandle, id: &str) -> bool {
    let now = now_ms();
    let until = match id {
        "activity:resume" => 0,
        "activity:pause:30" => now + 30 * 60_000,
        "activity:pause:60" => now + 60 * 60_000,
        "activity:pause:tomorrow" => next_midnight(now),
        _ => return false,
    };
    set(app, &json!({ "pausedUntil": until }));
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(exe: &str, title: &str, media: Option<bool>) -> Sample {
        Sample {
            exe: exe.into(),
            app: exe.into(),
            title: title.into(),
            media,
        }
    }

    #[test]
    fn media_detection() {
        assert!(watching_media(&sample("VLC", "", Some(false))));
        assert!(watching_media(&sample("chrome", "x", Some(true))));
        assert!(!watching_media(&sample("chrome", "YouTube", Some(false))));
        assert!(watching_media(&sample(
            "firefox",
            "Cats - YouTube — Mozilla Firefox",
            None
        )));
        assert!(!watching_media(&sample("firefox", "MyYouTubeClone", None)));
        assert!(watching_media(&sample("firefox", "Disney+ Hotstar", None)));
    }

    #[test]
    fn day_keys() {
        assert!(is_day_key("2026-10-25"));
        assert!(!is_day_key("2026-10-2"));
        assert!(!is_day_key("../../etc"));
        let now = now_ms();
        assert_ne!(day_key(next_midnight(now)), day_key(now));
        assert_eq!(day_key(next_midnight(now) - 1), day_key(now));
        assert!(next_midnight(now) > now && next_midnight(now) - now <= 25 * 3_600_000);
    }

    fn tracker_in(dir: &std::path::Path) -> Tracker {
        Tracker {
            dir: dir.to_path_buf(),
            days: HashMap::new(),
            dirty: HashSet::new(),
            open: None,
            last_sample_at: now_ms(),
            error: String::new(),
            last_flush: Instant::now(),
        }
    }

    #[test]
    fn samples_extend_and_split_spans() {
        let dir = std::env::temp_dir().join(format!("daylog-activity-test-{}", now_ms()));
        let mut t = tracker_in(&dir);
        let s = Settings {
            enabled: true,
            ..Settings::default()
        };
        let code = sample("Code", "main.rs", Some(false));
        t.on_sample(Some(code.clone()), 0, &s);
        // Back-date the span so the next sample extends it past the blink threshold.
        t.open_span().unwrap().s -= 20 * 60_000;
        t.on_sample(Some(code), 0, &s);
        t.on_sample(Some(sample("chrome", "News", Some(false))), 0, &s);
        let today = day_key(now_ms());
        let spans = t.days.get(&today).unwrap();
        assert_eq!(spans.len(), 2);
        assert_eq!(spans[0].exe, "Code");
        assert!(spans[0].e - spans[0].s >= 10_000);
        assert_eq!(spans[1].exe, "chrome");
        // Idle for 10 minutes: those minutes are cut off and nothing new starts.
        t.on_sample(Some(sample("chrome", "News", Some(false))), 10 * 60_000, &s);
        assert!(t.open.is_none());
        t.flush();
        let written: Vec<Span> = serde_json::from_str(
            &std::fs::read_to_string(dir.join(format!("{today}.json"))).unwrap(),
        )
        .unwrap();
        assert_eq!(
            written.len(),
            1,
            "the chrome span fell inside the idle time"
        );
        assert_eq!(written[0].title.as_deref(), Some("main.rs"));
        let kept = written[0].e - written[0].s;
        assert!((9 * 60_000..=11 * 60_000).contains(&kept), "{kept}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_span_fields_survive() {
        let json = r#"[{"s":1,"e":2,"exe":"a","app":"b","manual":true,"id":"x"}]"#;
        let spans: Vec<Span> = serde_json::from_str(json).unwrap();
        let back = serde_json::to_string(&spans).unwrap();
        assert!(back.contains("\"manual\":true") && back.contains("\"id\":\"x\""));
        assert!(!back.contains("title"));
    }
}
