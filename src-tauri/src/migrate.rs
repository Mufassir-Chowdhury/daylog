//! One-time clean-up after replacing the Electron app (see windows/hooks.nsh for
//! the installer's part). The prefs and activity files are already shared; what
//! remains is Electron's "Start with Windows" entry, which points at an exe that
//! no longer exists, and Chromium's caches in the data folder.

use crate::{prefs, tray};
use tauri::AppHandle;

pub fn run(app: &AppHandle) {
    if tauri::is_dev() || prefs::store().get().electron_migrated {
        return;
    }
    if remove_electron_autostart() {
        tray::set_launch_at_login(app, true);
    }
    remove_electron_caches();
    prefs::store().update(|p| p.electron_migrated = true);
}

/// Chromium's caches, which only Electron used. Its localStorage and IndexedDB
/// stay in case anyone wants to dig something out of them.
fn remove_electron_caches() {
    let dir = prefs::data_dir();
    for name in [
        "Cache",
        "Code Cache",
        "GPUCache",
        "DawnCache",
        "DawnGraphiteCache",
        "DawnWebGPUCache",
        "GraphiteDawnCache",
        "GrShaderCache",
        "ShaderCache",
        "Crashpad",
        "blob_storage",
        "Shared Dictionary",
    ] {
        let _ = std::fs::remove_dir_all(dir.join(name));
    }
    let _ = std::fs::remove_file(dir.join("activity-sampler.ps1"));
}

/// Deletes the Run entries that start the Electron exe; true if there were any.
#[cfg(windows)]
fn remove_electron_autostart() -> bool {
    use windows::core::{w, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{ERROR_MORE_DATA, ERROR_SUCCESS};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegDeleteKeyValueW, RegDeleteValueW, RegEnumValueW, RegOpenKeyExW, HKEY,
        HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_SZ,
    };

    let run_key = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    let mut found = Vec::new();
    unsafe {
        let mut key = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            run_key,
            None,
            KEY_READ | KEY_SET_VALUE,
            &mut key,
        ) != ERROR_SUCCESS
        {
            return false;
        }
        let mut index = 0;
        loop {
            let mut name = [0u16; 512];
            let mut name_len = name.len() as u32;
            let mut kind = 0u32;
            let mut data = [0u8; 4096];
            let mut data_len = data.len() as u32;
            let status = RegEnumValueW(
                key,
                index,
                Some(PWSTR(name.as_mut_ptr())),
                &mut name_len,
                None,
                Some(&mut kind as *mut u32),
                Some(data.as_mut_ptr()),
                Some(&mut data_len as *mut u32),
            );
            index += 1;
            if status == ERROR_MORE_DATA {
                continue; // too long to be ours
            }
            if status != ERROR_SUCCESS {
                break;
            }
            if kind != REG_SZ.0 {
                continue;
            }
            let wide: Vec<u16> = data[..data_len as usize]
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            let command = String::from_utf16_lossy(&wide).to_lowercase();
            if command.contains("\\programs\\todo\\daylog.exe") {
                found.push(name[..name_len as usize].to_vec());
            }
        }
        for name in &found {
            let mut name = name.clone();
            name.push(0);
            let _ = RegDeleteValueW(key, PCWSTR(name.as_ptr()));
            // Task Manager's enabled/disabled flag for the same entry.
            let _ = RegDeleteKeyValueW(
                HKEY_CURRENT_USER,
                w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run"),
                PCWSTR(name.as_ptr()),
            );
        }
        let _ = RegCloseKey(key);
    }
    !found.is_empty()
}

#[cfg(not(windows))]
fn remove_electron_autostart() -> bool {
    false
}
