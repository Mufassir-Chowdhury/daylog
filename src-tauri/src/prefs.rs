//! Desktop-only preferences, in the same file and format the Electron app used
//! (`desktop-prefs.json` in the user-data folder), so switching keeps them.
//! Keys this module doesn't know are kept as they are.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    pub summon_key: String,
    pub quick_key: String,
    pub bounds: Option<Bounds>,
    pub maximized: bool,
    pub tray_hint_shown: bool,
    /// Set once "Start with Windows" has been switched on by default, so turning it off sticks.
    pub launch_at_login_defaulted: bool,
    /// The activity tracker's settings (activity/mod.rs).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity: Option<crate::activity::Settings>,
    /// Names this computer's synced activity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            summon_key: "Control+Alt+D".into(),
            quick_key: "Control+Alt+Space".into(),
            bounds: None,
            maximized: false,
            tray_hint_shown: false,
            launch_at_login_defaulted: false,
            activity: None,
            device_id: None,
            extra: Map::new(),
        }
    }
}

/// The folder Electron called `userData`: `%APPDATA%\daylog`, `~/.config/daylog`,
/// `~/Library/Application Support/daylog`.
pub fn data_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("daylog")
}

static STORE: OnceLock<Store> = OnceLock::new();

/// The app-wide prefs, loaded on first use.
pub fn store() -> &'static Store {
    STORE.get_or_init(Store::load)
}

pub struct Store {
    path: PathBuf,
    pub prefs: Mutex<Prefs>,
    generation: AtomicU64,
}

impl Store {
    fn load() -> Self {
        let path = data_dir().join("desktop-prefs.json");
        let prefs = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            path,
            prefs: Mutex::new(prefs),
            generation: AtomicU64::new(0),
        }
    }

    pub fn get(&self) -> Prefs {
        self.prefs.lock().unwrap().clone()
    }

    pub fn update<T>(&'static self, f: impl FnOnce(&mut Prefs) -> T) -> T {
        let out = f(&mut self.prefs.lock().unwrap());
        self.save_soon();
        out
    }

    /// Writes the prefs after a short pause, so a burst of window moves is one write.
    pub fn save_soon(&'static self) {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            if self.generation.load(Ordering::SeqCst) == generation {
                self.save_now();
            }
        });
    }

    pub fn save_now(&self) {
        let mut out = Vec::new();
        let formatter = serde_json::ser::PrettyFormatter::with_indent(b"\t");
        let mut ser = serde_json::Serializer::with_formatter(&mut out, formatter);
        if self.prefs.lock().unwrap().serialize(&mut ser).is_ok() {
            let _ = std::fs::create_dir_all(self.path.parent().unwrap());
            // Read-only profile — prefs just won't stick.
            let _ = std::fs::write(&self.path, out);
        }
    }
}
