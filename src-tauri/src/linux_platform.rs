//! Linux-only desktop integration. Windows implementations remain in lib.rs.
use std::{
    fs,
    io::{Read, Write},
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
};

/// Called from main before GTK/WebKit or any worker starts. Keep this profile
/// local to KPassword; never change the desktop or the user's environment files.
pub fn configure_graphics() {
    if !Path::new("/sys/module/nvidia").exists()
        || std::env::var_os("KPASSWORD_GRAPHICS_PROFILE").as_deref()
            == Some(std::ffi::OsStr::new("native"))
    {
        return;
    }
    // WebKitGTK 2.54 + NVIDIA/KWin fails explicit sync on native Wayland.
    // Disabling DMA-BUF alone opens a slow/broken window. XWayland + the
    // DMA-BUF SHM transport + CPU Skia painting was exercised on the visible
    // form, including native frame capture during scrolling.
    std::env::set_var("GDK_BACKEND", "x11");
    for name in [
        "WEBKIT_DMABUF_RENDERER_FORCE_SHM",
        "WEBKIT_SKIA_ENABLE_CPU_RENDERING",
    ] {
        if std::env::var_os(name).is_none() {
            std::env::set_var(name, "1");
        }
    }
}

pub fn autostart_path() -> Result<PathBuf, String> {
    let root = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|p| Path::new(p).is_absolute())
        .or_else(|| {
            std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".config").into_os_string())
        })
        .ok_or("error.startup.configDir")?;
    Ok(PathBuf::from(root).join("autostart/com.kpassword.app.desktop"))
}

fn desktop_entry(exe: &Path) -> Result<String, String> {
    let raw = exe.to_str().ok_or("error.startup.invalidExecutablePath")?;
    if !exe.is_absolute() || raw.contains(['\n', '\r', '\0']) {
        return Err("error.startup.invalidExecutablePath".into());
    }
    // Desktop Entry Exec quoting is not shell quoting. Escape reserved characters
    // twice where required by the general string unescape and Exec parsing.
    let escaped = raw
        .replace('\\', "\\\\\\\\")
        .replace('"', "\\\\\"")
        .replace('`', "\\\\`")
        .replace('$', "\\\\$")
        .replace('%', "%%");
    Ok(format!("[Desktop Entry]\nType=Application\nName=KPassword\nExec=\"{escaped}\" --startup\nIcon=kpassword\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"))
}

fn read_autostart_entry() -> Option<String> {
    autostart_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .filter(|s| s.contains("Name=KPassword\n") && !s.contains("Hidden=true"))
}

pub fn startup_enabled() -> bool {
    read_autostart_entry().is_some()
}

/// The Exec line the desktop session will actually run at login, which may
/// differ from the running executable (for example a stale dev build path).
pub fn startup_command() -> Option<String> {
    exec_line(&read_autostart_entry()?)
}

fn exec_line(entry: &str) -> Option<String> {
    entry
        .lines()
        .find_map(|line| line.strip_prefix("Exec=").map(str::to_string))
}

/// Rewrites an enabled autostart entry so it points at the running executable.
/// A dev build loads the Vite devUrl, so an entry saved by `tauri dev` opens a
/// "Connection refused" window at login. Only installed builds call this.
pub fn repair_startup() -> Result<bool, String> {
    let Some(current) = read_autostart_entry() else {
        return Ok(false);
    };
    let exe = std::env::current_exe().map_err(|_| "error.startup.executableUnavailable")?;
    if current == desktop_entry(&exe)? {
        return Ok(false);
    }
    set_startup(true).map(|_| true)
}

pub fn set_startup(enabled: bool) -> Result<(), String> {
    let path = autostart_path()?;
    if enabled {
        let entry = desktop_entry(
            &std::env::current_exe().map_err(|_| "error.startup.executableUnavailable")?,
        )?;
        fs::create_dir_all(path.parent().unwrap()).map_err(|_| "error.startup.createDir")?;
        // Never follow an existing symlink when replacing an autostart entry.
        let tmp = path.with_extension(format!("desktop.{}.tmp", std::process::id()));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|_| "error.startup.prepare")?;
        let result = file
            .write_all(entry.as_bytes())
            .and_then(|_| file.sync_all())
            .and_then(|_| fs::rename(&tmp, &path));
        if result.is_err() {
            let _ = fs::remove_file(tmp);
        }
        result.map_err(|_| "error.startup.save".into())
    } else {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("error.startup.disable".into()),
        }
    }
}

pub async fn capture_qr() -> Result<String, String> {
    let request = tokio::time::timeout(
        std::time::Duration::from_secs(90),
        ashpd::desktop::screenshot::Screenshot::request()
            .interactive(true)
            .modal(true)
            .send(),
    )
    .await
    .map_err(|_| "error.capture.timeout")?
    .map_err(|_| "error.capture.portalCancelled")?;
    let response = request.response().map_err(|_| "error.capture.cancelled")?;
    let uri = tauri::Url::parse(response.uri().as_str()).map_err(|_| "error.capture.invalidUri")?;
    let path = uri.to_file_path().map_err(|_| "error.capture.notLocal")?;
    let mut bytes = Vec::new();
    fs::File::open(&path)
        .map_err(|_| "error.capture.unavailable")?
        .take(super::MAX_QR_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "error.capture.unavailable")?;
    if bytes.len() > super::MAX_QR_IMAGE_BYTES {
        return Err("error.qr.imageTooLarge".into());
    }
    let (w, h) = super::read_qr_image_dimensions(&bytes)?;
    super::validate_qr_image_dimensions(w, h)?;
    let image = image::load_from_memory(&bytes).map_err(|_| "error.capture.invalid")?;
    // The portal owns the screenshot file. Do not delete arbitrary returned paths.
    super::encode_qr_capture_as_png_data_url(&image)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn autostart_quotes_exec_without_shell_expansion() {
        let s = desktop_entry(Path::new("/tmp/a b%$`\"\\/kpassword")).unwrap();
        assert!(s.contains("%%"));
        assert!(s.contains("\\\\$"));
        assert!(s.contains(" --startup\n"));
        assert!(!s.contains("sh -c"));
    }
    #[test]
    fn autostart_exec_line_reports_the_registered_binary() {
        let entry = desktop_entry(Path::new(
            "/home/u/KPassword/src-tauri/target/debug/kpassword",
        ))
        .unwrap();
        assert_eq!(
            exec_line(&entry).as_deref(),
            Some("\"/home/u/KPassword/src-tauri/target/debug/kpassword\" --startup")
        );
        assert_ne!(
            entry,
            desktop_entry(Path::new("/usr/bin/kpassword")).unwrap()
        );
    }
    #[test]
    fn autostart_rejects_relative_paths_and_line_injection() {
        assert!(desktop_entry(Path::new("kpassword")).is_err());
        assert!(desktop_entry(Path::new("/tmp/kpassword\nHidden=true")).is_err());
    }
}
