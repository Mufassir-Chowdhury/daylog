//! Auto-update for the installed app. CI publishes each build to the repository's
//! latest GitHub release with a manifest (version, size, sha512, in the
//! `latest.yml` format electron-updater used); this checks it shortly after
//! launch and every few hours, downloads a newer installer in the background,
//! checks its hash, and installs it on the next quit — or straight away when the
//! user picks "Restart to update" from the tray, the notification or Settings.
//!
//! Dev runs and non-Windows builds never update (there's no installer to run).

use crate::{notify, tray, windows};
use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha512};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::menu::MenuItem;
use tauri::{AppHandle, Wry};

/// Where releases are published; `latest/download/` always points at the newest.
const FEED: &str =
    "https://github.com/Mufassir-Chowdhury/daylog/releases/latest/download/latest.yml";

/// The manifest URL; `DAYLOG_UPDATE_FEED` points it elsewhere for testing.
fn feed() -> String {
    std::env::var("DAYLOG_UPDATE_FEED").unwrap_or_else(|_| FEED.to_string())
}
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(15);
const CHECK_EVERY: Duration = Duration::from_secs(4 * 3600);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// idle | checking | downloading | ready | error | unsupported
    state: &'static str,
    current: String,
    version: String,
    percent: u32,
    error: String,
    checked_at: u64,
}

struct Updater {
    status: Status,
    /// The verified installer, once downloaded.
    installer: Option<PathBuf>,
    menu_key: String,
}

static UPDATER: OnceLock<Mutex<Updater>> = OnceLock::new();
static APP: OnceLock<AppHandle> = OnceLock::new();

fn enabled() -> bool {
    cfg!(windows) && !tauri::is_dev()
}

fn updater() -> &'static Mutex<Updater> {
    UPDATER.get_or_init(|| {
        let current = APP
            .get()
            .map(|a| a.package_info().version.to_string())
            .unwrap_or_default();
        Mutex::new(Updater {
            status: Status {
                state: if enabled() { "idle" } else { "unsupported" },
                current,
                version: String::new(),
                percent: 0,
                error: String::new(),
                checked_at: 0,
            },
            installer: None,
            menu_key: String::new(),
        })
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// Applies `patch` to the status, tells the main window, and redraws the tray
/// menu when something it shows changed (download progress only every 10%).
fn set(patch: impl FnOnce(&mut Status)) {
    let (status, redraw) = {
        let mut u = updater().lock().unwrap();
        patch(&mut u.status);
        let s = &u.status;
        let key = format!("{}:{}:{}", s.state, s.version, s.percent / 10);
        let redraw = key != u.menu_key;
        u.menu_key = key;
        (u.status.clone(), redraw)
    };
    if let Some(app) = APP.get() {
        windows::emit_main(app, "update:status", status);
        if redraw {
            tray::refresh(app);
        }
    }
}

pub fn status(_app: &AppHandle) -> Status {
    updater().lock().unwrap().status.clone()
}

/// Starts the background checks.
pub fn start(app: &AppHandle) {
    let _ = APP.set(app.clone());
    updater();
    if !enabled() {
        return;
    }
    std::thread::spawn(|| {
        std::thread::sleep(FIRST_CHECK_DELAY);
        loop {
            run_check();
            std::thread::sleep(CHECK_EVERY);
        }
    });
}

/// Checks now (in the background) unless a check, download or install is under way.
pub fn check() -> Status {
    let busy = {
        let u = updater().lock().unwrap();
        !enabled() || matches!(u.status.state, "checking" | "downloading" | "ready")
    };
    if !busy {
        set(|s| {
            s.state = "checking";
            s.error.clear();
        });
        std::thread::spawn(run_check);
    }
    updater().lock().unwrap().status.clone()
}

/// What the manifest promises: `latest.yml` in electron-builder's format.
#[derive(Debug, PartialEq)]
struct Manifest {
    version: String,
    path: String,
    sha512: String,
    size: Option<u64>,
}

fn parse_manifest(yml: &str) -> Option<Manifest> {
    let field = |name: &str| {
        yml.lines().find_map(|line| {
            let value = line.strip_prefix(name)?.strip_prefix(':')?;
            Some(value.trim().trim_matches(['\'', '"']).to_string())
        })
    };
    let size = yml.lines().find_map(|line| {
        let line = line.trim_start().trim_start_matches("- ");
        line.strip_prefix("size:")?.trim().parse().ok()
    });
    Some(Manifest {
        version: field("version")?,
        path: field("path")?,
        sha512: field("sha512")?,
        size,
    })
}

/// `0.1.12` > `0.1.9`; anything unparsable counts as older.
fn newer(candidate: &str, current: &str) -> bool {
    let parts = |v: &str| -> Vec<u64> {
        v.split(['.', '-', '+'])
            .take(3)
            .map(|p| p.parse().unwrap_or(0))
            .collect()
    };
    parts(candidate) > parts(current)
}

fn agent() -> ureq::Agent {
    // The OS's TLS and certificate store, like the browser — it also trusts a
    // company proxy's certificate where one is installed.
    let tls = ureq::tls::TlsConfig::builder()
        .provider(ureq::tls::TlsProvider::NativeTls)
        .root_certs(ureq::tls::RootCerts::PlatformVerifier)
        .build();
    ureq::Agent::config_builder()
        .tls_config(tls)
        .timeout_connect(Some(Duration::from_secs(20)))
        .user_agent("daylog-updater")
        .max_redirects(0)
        .build()
        .into()
}

/// GET that follows redirects itself: GitHub answers release downloads with
/// chunked 302s, whose bodies ureq's own redirect handling chokes on behind
/// some proxies.
fn get(agent: &ureq::Agent, url: &str) -> Result<ureq::http::Response<ureq::Body>, ureq::Error> {
    let mut url = url.to_string();
    for _ in 0..10 {
        let response = agent.get(&url).call()?;
        if !response.status().is_redirection() {
            return Ok(response);
        }
        let location = response
            .headers()
            .get("location")
            .and_then(|l| l.to_str().ok())
            .ok_or(ureq::Error::RedirectFailed)?;
        url = if location.starts_with("http") {
            location.to_string()
        } else {
            let origin = url.splitn(4, '/').take(3).collect::<Vec<_>>().join("/");
            format!("{origin}{location}")
        };
    }
    Err(ureq::Error::TooManyRedirects)
}

fn run_check() {
    set(|s| {
        s.state = "checking";
        s.error.clear();
    });
    if let Err(error) = check_and_download() {
        // A failed download leaves nothing to install; a ready update stays ready.
        let ready = updater().lock().unwrap().status.state == "ready";
        if !ready {
            set(|s| {
                s.state = "error";
                s.error = error;
            });
        }
    }
}

fn check_and_download() -> Result<(), String> {
    let agent = agent();
    let yml = get(&agent, &feed())
        .and_then(|mut r| r.body_mut().with_config().limit(64 * 1024).read_to_string())
        .map_err(|e| format!("Couldn't check for updates: {e}"))?;
    let manifest = parse_manifest(&yml).ok_or("The update feed is unreadable")?;
    let current = updater().lock().unwrap().status.current.clone();
    if !newer(&manifest.version, &current) {
        set(|s| {
            s.state = "idle";
            s.checked_at = now_ms();
        });
        return Ok(());
    }
    // Already downloaded this one.
    if updater().lock().unwrap().status.version == manifest.version
        && updater().lock().unwrap().installer.is_some()
    {
        set(|s| s.state = "ready");
        return Ok(());
    }
    set(|s| {
        s.state = "downloading";
        s.version = manifest.version.clone();
        s.percent = 0;
        s.checked_at = now_ms();
    });

    let feed = feed();
    let url = format!("{}/{}", feed.rsplit_once('/').unwrap().0, manifest.path);
    let mut response =
        get(&agent, &url).map_err(|e| format!("Couldn't download the update: {e}"))?;
    let total = manifest
        .size
        .or_else(|| response.body().content_length())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join("daylog-update");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file_path = dir.join(format!("daylog-setup-{}.exe", manifest.version));
    let mut file = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
    let mut reader = response.body_mut().with_config().limit(500 << 20).reader();
    let mut hasher = Sha512::new();
    let mut buf = vec![0u8; 64 * 1024];
    let mut done = 0u64;
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("The download broke off: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if total > 0 {
            let percent = (done * 100 / total).min(100) as u32;
            if percent != updater().lock().unwrap().status.percent {
                set(|s| s.percent = percent);
            }
        }
    }
    drop(file);
    let hash = base64::engine::general_purpose::STANDARD.encode(hasher.finalize());
    if hash != manifest.sha512 || manifest.size.is_some_and(|size| size != done) {
        let _ = std::fs::remove_file(&file_path);
        return Err("The download didn't match its checksum".into());
    }

    let announce = {
        let mut u = updater().lock().unwrap();
        let announce = u.status.state != "ready";
        u.installer = Some(file_path);
        announce
    };
    set(|s| {
        s.state = "ready";
        s.percent = 100;
    });
    if announce {
        if let Some(app) = APP.get() {
            notify::show(
                app,
                &format!("daylog {} is ready", manifest.version),
                "Click to restart and update now, or it installs the next time daylog quits.",
                Some(notify::INSTALL_UPDATE.to_string()),
            );
        }
    }
    Ok(())
}

/// Runs the downloaded installer silently. With `relaunch`, it starts daylog again
/// afterwards. The installer closes this app itself if it's still running.
fn run_installer(relaunch: bool) -> bool {
    let Some(path) = updater().lock().unwrap().installer.take() else {
        return false;
    };
    let mut args = vec!["/S", "/UPDATE"];
    if relaunch {
        args.push("/R");
    }
    std::process::Command::new(path).args(args).spawn().is_ok()
}

/// Quits, installs silently and relaunches.
pub fn install(app: &AppHandle) {
    if updater().lock().unwrap().status.state == "ready" && run_installer(true) {
        tray::quit(app);
    }
}

/// On the way out: a downloaded update installs now, without relaunching.
pub fn install_on_quit() {
    if updater().lock().unwrap().status.state == "ready" {
        run_installer(false);
    }
}

pub fn tray_item(app: &AppHandle) -> tauri::Result<MenuItem<Wry>> {
    let s = updater().lock().unwrap().status.clone();
    let (id, label, enabled) = match s.state {
        "ready" => (
            "update:install",
            format!("Restart to update (v{})", s.version),
            true,
        ),
        "downloading" => (
            "update:none",
            format!("Downloading update… {}%", s.percent),
            false,
        ),
        "checking" => ("update:none", "Checking for updates…".into(), false),
        state => (
            "update:check",
            "Check for updates".into(),
            state == "idle" || state == "error",
        ),
    };
    MenuItem::with_id(app, id, label, enabled, None::<&str>)
}

pub fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "update:install" => install(app),
        "update:check" => {
            check();
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_electron_builder_manifests() {
        let yml = "version: 0.1.12\nfiles:\n  - url: daylog-setup.exe\n    sha512: abc+/==\n    size: 2176588\npath: daylog-setup.exe\nsha512: abc+/==\nreleaseDate: '2026-10-25T16:49:33.000Z'\n";
        assert_eq!(
            parse_manifest(yml),
            Some(Manifest {
                version: "0.1.12".into(),
                path: "daylog-setup.exe".into(),
                sha512: "abc+/==".into(),
                size: Some(2176588),
            })
        );
        assert_eq!(parse_manifest("nonsense"), None);
    }

    /// Serves a manifest and an installer from a local server, then checks.
    #[test]
    fn downloads_and_verifies_an_update() {
        let installer = b"pretend installer".repeat(1000);
        let hash = base64::engine::general_purpose::STANDARD.encode(Sha512::digest(&installer));
        let good = format!(
            "version: 9.9.9\nfiles:\n  - url: setup.exe\n    sha512: {hash}\n    size: {}\npath: setup.exe\nsha512: {hash}\n",
            installer.len()
        );
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        std::thread::spawn(move || {
            for (i, request) in server.incoming_requests().enumerate() {
                let body = match (i, request.url()) {
                    (_, "/latest.yml") => good.clone().into_bytes(),
                    // The second download comes back corrupted.
                    (3, _) => b"tampered".to_vec(),
                    _ => installer.clone(),
                };
                let _ = request.respond(tiny_http::Response::from_data(body));
            }
        });
        std::env::set_var(
            "DAYLOG_UPDATE_FEED",
            format!("http://127.0.0.1:{port}/latest.yml"),
        );

        check_and_download().unwrap();
        let (state, path) = {
            let u = updater().lock().unwrap();
            (u.status.state, u.installer.clone().unwrap())
        };
        assert_eq!(state, "ready");
        assert_eq!(std::fs::read(&path).unwrap().len(), 17_000);

        // Pretend nothing was downloaded yet and try again: the bad copy is refused.
        {
            let mut u = updater().lock().unwrap();
            u.installer = None;
            u.status.state = "idle";
        }
        assert!(check_and_download().unwrap_err().contains("checksum"));
        assert!(!path.exists());
    }

    #[test]
    fn compares_versions_numerically() {
        assert!(newer("0.1.12", "0.1.9"));
        assert!(!newer("0.1.9", "0.1.9"));
        assert!(!newer("0.1.8", "0.1.9"));
        assert!(newer("1.0.0", "0.9.99"));
    }
}
