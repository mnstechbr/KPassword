//! Linux-only desktop integration. Windows implementations remain in lib.rs.
use std::{fs, path::{Path, PathBuf}, io::{Read, Write}, os::unix::fs::OpenOptionsExt};
use tauri::AppHandle;

pub fn autostart_path() -> Result<PathBuf, String> {
    let root = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|p| Path::new(p).is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".config").into_os_string()))
        .ok_or("Não foi possível localizar a configuração XDG.")?;
    Ok(PathBuf::from(root).join("autostart/com.kpassword.app.desktop"))
}

fn desktop_entry(exe: &Path) -> Result<String, String> {
    let raw = exe.to_str().ok_or("Caminho de executável inválido.")?;
    if !exe.is_absolute() || raw.contains(['\n', '\r', '\0']) {
        return Err("Caminho de executável inválido.".into());
    }
    // Desktop Entry Exec quoting is not shell quoting. Escape reserved characters
    // twice where required by the general string unescape and Exec parsing.
    let escaped = raw.replace('\\', "\\\\\\\\").replace('"', "\\\\\"")
        .replace('`', "\\\\`").replace('$', "\\\\$").replace('%', "%%");
    Ok(format!("[Desktop Entry]\nType=Application\nName=KPassword\nExec=\"{escaped}\" --startup\nIcon=kpassword\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"))
}

pub fn startup_enabled() -> bool {
    autostart_path().ok().and_then(|p| fs::read_to_string(p).ok())
        .map(|s| s.contains("Name=KPassword\n") && !s.contains("Hidden=true"))
        .unwrap_or(false)
}

pub fn set_startup(enabled: bool) -> Result<(), String> {
    let path = autostart_path()?;
    if enabled {
        let entry = desktop_entry(&std::env::current_exe().map_err(|_| "Executável indisponível.")?)?;
        fs::create_dir_all(path.parent().unwrap()).map_err(|_| "Não foi possível criar autostart XDG.")?;
        // Never follow an existing symlink when replacing an autostart entry.
        let tmp = path.with_extension(format!("desktop.{}.tmp", std::process::id()));
        let mut file = fs::OpenOptions::new().write(true).create_new(true).mode(0o600)
            .open(&tmp).map_err(|_| "Não foi possível preparar autostart XDG.")?;
        let result = file.write_all(entry.as_bytes()).and_then(|_| file.sync_all())
            .and_then(|_| fs::rename(&tmp, &path));
        if result.is_err() { let _ = fs::remove_file(tmp); }
        result.map_err(|_| "Não foi possível salvar autostart XDG.".into())
    } else {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("Não foi possível desativar autostart XDG.".into()),
        }
    }
}

pub async fn clipboard(app: AppHandle, value: Option<String>) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let result = match gtk::gdk::Display::default() {
            None => Err("Clipboard indisponível.".to_string()),
            Some(display) => {
                match gtk::Clipboard::default(&display) {
                    None => Err("Clipboard indisponível.".to_string()),
                    Some(clipboard) => if let Some(value) = value {
                        clipboard.set_text(&value);
                        Ok(String::new())
                    } else {
                        clipboard.wait_for_text().map(|s| s.to_string())
                            .ok_or_else(|| "Clipboard não contém texto.".to_string())
                    }
                }
            }
        };
        let _ = tx.send(result);
    }).map_err(|_| "Clipboard indisponível.")?;
    tokio::time::timeout(std::time::Duration::from_secs(5), rx).await
        .map_err(|_| "Tempo de clipboard esgotado.")?
        .map_err(|_| "Clipboard indisponível.".to_string())?
}

pub async fn capture_qr() -> Result<String, String> {
    let request = tokio::time::timeout(std::time::Duration::from_secs(90),
        ashpd::desktop::screenshot::Screenshot::request().interactive(true).modal(true).send())
        .await.map_err(|_| "Tempo de captura esgotado.")?
        .map_err(|_| "Captura indisponível ou cancelada no portal do desktop.")?;
    let response = request.response().map_err(|_| "Captura cancelada.")?;
    let uri = tauri::Url::parse(response.uri().as_str()).map_err(|_| "URI de captura inválida.")?;
    let path = uri.to_file_path().map_err(|_| "Captura deve ser um arquivo local.")?;
    let mut bytes = Vec::new();
    fs::File::open(&path).map_err(|_| "Captura indisponível.")?
        .take(super::MAX_QR_IMAGE_BYTES as u64 + 1).read_to_end(&mut bytes)
        .map_err(|_| "Captura indisponível.")?;
    if bytes.len() > super::MAX_QR_IMAGE_BYTES { return Err("Captura excede o limite de imagem.".into()); }
    let (w, h) = super::read_qr_image_dimensions(&bytes)?;
    super::validate_qr_image_dimensions(w, h)?;
    let image = image::load_from_memory(&bytes).map_err(|_| "Captura inválida.")?;
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
    fn autostart_rejects_relative_paths_and_line_injection() {
        assert!(desktop_entry(Path::new("kpassword")).is_err());
        assert!(desktop_entry(Path::new("/tmp/kpassword\nHidden=true")).is_err());
    }
}
