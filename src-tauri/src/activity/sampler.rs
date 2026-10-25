//! Foreground-window samplers. Each sample is `{ exe, app, title, media }`, or
//! nothing when nothing worth recording is in front (the desktop, the lock screen).

/// What's in front right now.
#[derive(Clone, Debug, PartialEq)]
pub struct Sample {
    /// Process name (`Code`, `chrome`) — stable across languages and versions.
    pub exe: String,
    /// Friendly app name (`Visual Studio Code`).
    pub app: String,
    pub title: String,
    /// Whether some app is keeping the display awake (a video or call), where the OS says.
    pub media: Option<bool>,
}

/// `Err(Some(message))` once sampling keeps failing; `Err(None)` for a one-off miss.
pub type SampleResult = Result<Option<Sample>, Option<String>>;

pub struct Sampler {
    failures: u32,
    #[cfg(windows)]
    names: std::collections::HashMap<u32, (String, String)>,
}

impl Sampler {
    pub fn new() -> Self {
        Self {
            failures: 0,
            #[cfg(windows)]
            names: std::collections::HashMap::new(),
        }
    }

    pub fn sample(&mut self) -> SampleResult {
        match self.read() {
            Ok(sample) => {
                self.failures = 0;
                Ok(sample)
            }
            Err(message) => {
                self.failures += 1;
                Err((self.failures >= 3).then_some(message))
            }
        }
    }
}

// ——— Windows: straight from Win32, no helper process. ———

#[cfg(windows)]
mod win {
    use std::ffi::c_void;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HWND};
    use windows::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
    };
    use windows::Win32::System::Power::{CallNtPowerInformation, SystemExecutionState};
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn foreground() -> Option<(u32, String)> {
        unsafe {
            let hwnd: HWND = GetForegroundWindow();
            if hwnd.is_invalid() {
                return None;
            }
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut buf).max(0) as usize;
            let title = String::from_utf16_lossy(&buf[..len]);
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            (pid != 0).then_some((pid, title))
        }
    }

    pub fn image_path(pid: u32) -> Option<String> {
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                process,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut size,
            );
            let _ = CloseHandle(process);
            ok.ok()?;
            Some(String::from_utf16_lossy(&buf[..size as usize]))
        }
    }

    /// The executable's FileDescription, what Task Manager shows as the app's name.
    pub fn description(path: &str) -> Option<String> {
        unsafe {
            let path = wide(path);
            let size = GetFileVersionInfoSizeW(PCWSTR(path.as_ptr()), None);
            if size == 0 {
                return None;
            }
            let mut data = vec![0u8; size as usize];
            GetFileVersionInfoW(
                PCWSTR(path.as_ptr()),
                None,
                size,
                data.as_mut_ptr() as *mut c_void,
            )
            .ok()?;
            let query = |key: &str| -> Option<(*mut c_void, u32)> {
                let key = wide(key);
                let mut ptr: *mut c_void = std::ptr::null_mut();
                let mut len = 0u32;
                VerQueryValueW(
                    data.as_ptr() as *const c_void,
                    PCWSTR(key.as_ptr()),
                    &mut ptr,
                    &mut len,
                )
                .as_bool()
                .then_some((ptr, len))
                .filter(|(p, l)| !p.is_null() && *l > 0)
            };
            let (translations, len) = query("\\VarFileInfo\\Translation")?;
            if len < 4 {
                return None;
            }
            let pair = translations as *const u16;
            let (lang, codepage) = (*pair, *pair.add(1));
            let (text, chars) = query(&format!(
                "\\StringFileInfo\\{lang:04x}{codepage:04x}\\FileDescription"
            ))?;
            let slice = std::slice::from_raw_parts(text as *const u16, chars as usize);
            let end = slice.iter().position(|&c| c == 0).unwrap_or(slice.len());
            Some(String::from_utf16_lossy(&slice[..end]).trim().to_string())
        }
    }

    /// SystemExecutionState: ES_DISPLAY_REQUIRED is set while a video or call keeps the screen on.
    pub fn display_kept_awake() -> Option<bool> {
        unsafe {
            let mut state = 0u32;
            let status = CallNtPowerInformation(
                SystemExecutionState,
                None,
                0,
                Some(&mut state as *mut u32 as *mut c_void),
                4,
            );
            status.is_ok().then_some(state & 2 != 0)
        }
    }

    pub fn idle_ms() -> i64 {
        unsafe {
            let mut info = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };
            if !GetLastInputInfo(&mut info).as_bool() {
                return 0;
            }
            GetTickCount().wrapping_sub(info.dwTime) as i64
        }
    }
}

#[cfg(windows)]
impl Sampler {
    fn read(&mut self) -> Result<Option<Sample>, String> {
        let Some((pid, title)) = win::foreground() else {
            return Ok(None);
        };
        if self.names.len() > 500 {
            self.names.clear();
        }
        let (exe, app) = self
            .names
            .entry(pid)
            .or_insert_with(|| {
                let path = win::image_path(pid).unwrap_or_default();
                let exe = std::path::Path::new(&path)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                let app = win::description(&path).unwrap_or_default();
                (exe, app)
            })
            .clone();
        Ok(normalize_windows(
            exe,
            app,
            title,
            win::display_kept_awake(),
        ))
    }
}

/// Seconds since the last keyboard or mouse input, in millis.
#[cfg(windows)]
pub fn idle_ms() -> i64 {
    win::idle_ms()
}

/// Store apps and shell surfaces, as the Electron sampler treated them.
#[cfg_attr(not(windows), allow(dead_code))]
fn normalize_windows(
    exe: String,
    app: String,
    title: String,
    media: Option<bool>,
) -> Option<Sample> {
    let (exe, title) = (exe.trim().to_string(), title.trim().to_string());
    if exe.is_empty() {
        return None;
    }
    let is = |name: &str| exe.eq_ignore_ascii_case(name);
    // Store apps (Calculator, Photos…) all run inside ApplicationFrameHost; the title names the app.
    if is("ApplicationFrameHost") {
        return (!title.is_empty()).then(|| Sample {
            exe: title.clone(),
            app: title.clone(),
            title,
            media,
        });
    }
    // The desktop, taskbar and Alt+Tab switcher aren't really "using" anything.
    if is("explorer") && title.is_empty() {
        return None;
    }
    if [
        "LockApp",
        "ShellExperienceHost",
        "SearchHost",
        "StartMenuExperienceHost",
    ]
    .iter()
    .any(|n| is(n))
    {
        return None;
    }
    let app = app.trim();
    Some(Sample {
        app: if app.is_empty() {
            exe.clone()
        } else {
            app.to_string()
        },
        exe,
        title,
        media,
    })
}

// ——— macOS and Linux: a small command per sample. ———

/// Runs a command, giving up after a few seconds.
#[cfg(not(windows))]
fn run(program: &str, args: &[&str]) -> Option<String> {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                use std::io::Read;
                child.stdout.take()?.read_to_string(&mut out).ok()?;
                return status.success().then_some(out);
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

#[cfg(target_os = "macos")]
const MAC_SCRIPT: &[&str] = &[
    "tell application \"System Events\"",
    "set p to first application process whose frontmost is true",
    "set n to name of p",
    "set t to \"\"",
    "try",
    "set t to name of front window of p",
    "end try",
    "end tell",
    "return n & linefeed & t",
];

#[cfg(target_os = "macos")]
impl Sampler {
    fn read(&mut self) -> Result<Option<Sample>, String> {
        let args: Vec<&str> = MAC_SCRIPT.iter().flat_map(|l| ["-e", *l]).collect();
        let out = run("osascript", &args)
            .ok_or("macOS refused — allow daylog under Privacy → Automation")?;
        let out = out.strip_suffix('\n').unwrap_or(&out);
        let mut lines = out.split('\n');
        let app = lines.next().unwrap_or("").to_string();
        if app.is_empty() {
            return Ok(None);
        }
        let title = lines.collect::<Vec<_>>().join(" ").trim().to_string();
        // Players and browsers hold a display-sleep assertion while a video plays.
        let media = run("pmset", &["-g", "assertions"]).map(|a| {
            a.lines().any(|l| {
                let mut parts = l.split_whitespace();
                parts.next() == Some("PreventUserIdleDisplaySleep") && parts.next() == Some("1")
            })
        });
        Ok(Some(Sample {
            exe: app.clone(),
            app,
            title,
            media,
        }))
    }
}

/// HIDIdleTime is in nanoseconds.
#[cfg(target_os = "macos")]
pub fn idle_ms() -> i64 {
    run("ioreg", &["-c", "IOHIDSystem", "-d", "4"])
        .and_then(|out| {
            out.lines()
                .find(|l| l.contains("\"HIDIdleTime\""))
                .and_then(|l| l.rsplit('=').next())
                .and_then(|n| n.trim().parse::<i64>().ok())
        })
        .map_or(0, |ns| ns / 1_000_000)
}

#[cfg(all(unix, not(target_os = "macos")))]
impl Sampler {
    fn read(&mut self) -> Result<Option<Sample>, String> {
        let out = run(
            "xdotool",
            &["getactivewindow", "getwindowpid", "getwindowname"],
        )
        .ok_or("Needs xdotool on an X11 session")?;
        let out = out.strip_suffix('\n').unwrap_or(&out);
        let mut lines = out.split('\n');
        let pid: u32 = lines.next().unwrap_or("").trim().parse().unwrap_or(0);
        let title = lines.collect::<Vec<_>>().join(" ").trim().to_string();
        // The window may have closed between the two reads.
        let exe = std::fs::read_to_string(format!("/proc/{pid}/comm"))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        Ok((!exe.is_empty()).then(|| Sample {
            exe: exe.clone(),
            app: exe,
            title,
            media: None,
        }))
    }
}

/// Best effort: `xprintidle` when it's installed, otherwise input is never idle.
#[cfg(all(unix, not(target_os = "macos")))]
pub fn idle_ms() -> i64 {
    run("xprintidle", &[])
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_shell_surfaces_are_skipped() {
        let n =
            |exe: &str, title: &str| normalize_windows(exe.into(), "".into(), title.into(), None);
        assert_eq!(n("explorer", ""), None);
        assert_eq!(n("LockApp", "Lock"), None);
        assert_eq!(
            n("ApplicationFrameHost", "Calculator").unwrap().exe,
            "Calculator"
        );
        let code = normalize_windows(
            "Code".into(),
            "Visual Studio Code".into(),
            "a.rs".into(),
            Some(true),
        )
        .unwrap();
        assert_eq!(
            (code.exe.as_str(), code.app.as_str()),
            ("Code", "Visual Studio Code")
        );
        assert_eq!(n("notepad", "x").unwrap().app, "notepad");
    }
}
