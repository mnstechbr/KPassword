use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
#[cfg(not(target_os = "linux"))]
use tauri_plugin_notification::NotificationExt;
use zeroize::Zeroize;

mod crypto_vault;
mod qr;
mod secure_clipboard;
mod startup;
mod storage;
mod storage_io;
mod tray;
mod vault_removal;
mod vault_session;
mod windows_capture;
mod windows_hello;
#[allow(unused_imports)]
use {qr::*, startup::*, storage::*, tray::*, windows_capture::*, windows_hello::*};
mod secrets_bridge;
#[cfg(test)]
mod vault_compatibility_tests;
#[cfg(target_os = "linux")]
use secrets_bridge::universal::HttpState as UniversalBridgeState;
// Sem ponte HTTP fora do Linux; o estado existe so para o `manage` comum.
#[cfg(not(target_os = "linux"))]
#[derive(Default)]
struct UniversalBridgeState {
    _unused: (),
}
#[cfg(target_os = "linux")]
pub fn secrets_bridge_child() -> Result<(), String> {
    secrets_bridge::child()
}
#[cfg(target_os = "linux")]
mod linux_platform;
#[cfg(target_os = "linux")]
pub fn configure_linux_graphics() {
    linux_platform::configure_graphics();
}

#[tauri::command]
fn platform_name() -> &'static str {
    std::env::consts::OS
}

#[tauri::command]
async fn linux_capture_qr() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        linux_platform::capture_qr().await
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("error.capture.portalUnavailable".into())
    }
}
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const DEFAULT_BACKUP_INTERVAL_HOURS: u64 = 4;

#[derive(Serialize)]
struct BackupFile {
    filename: String,
    size_bytes: u64,
    modified_epoch_ms: u128,
}

#[derive(Serialize)]
struct VaultFileInfo {
    name: String,
    display_name: String,
    filename: String,
    size_bytes: u64,
    modified_epoch_ms: u128,
    is_default: bool,
}

#[derive(Serialize)]
struct StorageInfo {
    vault_path: String,
    backup_dir: String,
    backups: Vec<BackupFile>,
    vault_name: String,
    /// Cofre salvo, mas algo secundario (ex.: backup pedido) falhou.
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreOutcome {
    storage: StorageInfo,
    /// Nome do backup de seguranca criado antes da sobrescrita.
    /// `None` apenas quando o cofre alvo ainda nao existia.
    safety_backup: Option<String>,
}

#[derive(Serialize)]
struct WindowsHelloStatus {
    available: bool,
    /// Compatibilidade: verdadeiro apenas quando `state == "configured"`.
    enabled: bool,
    /// "disabled" | "configured" | "stale" | "invalid" -- ver `hello_record_state`.
    state: String,
    reason: String,
    vault_name: String,
}

#[derive(Serialize)]
struct StartupStatus {
    enabled: bool,
    registry_key: String,
    value_name: String,
    command_line: String,
    startup_argument: String,
}

fn now_epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn now_epoch_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn modified_epoch_ms(modified: SystemTime) -> u128 {
    modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn sanitize_vault_name(vault_name: Option<String>) -> Result<String, String> {
    let raw = vault_name.unwrap_or_else(|| "vault".to_string());
    let trimmed = raw.trim();

    if trimmed.is_empty() {
        return Ok("vault".to_string());
    }

    if trimmed.len() > 48 {
        return Err("error.vault.nameTooLong".to_string());
    }

    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err("error.vault.invalidName".to_string());
    }

    // Nomes de dispositivo do Windows nao podem ser arquivos (CON.kpvault abre o console).
    const RESERVED: [&str; 4] = ["con", "prn", "aux", "nul"];
    let lower = trimmed.to_ascii_lowercase();
    let is_port = (lower.starts_with("com") || lower.starts_with("lpt"))
        && lower.len() == 4
        && matches!(lower.as_bytes()[3], b'1'..=b'9');
    if RESERVED.contains(&lower.as_str()) || is_port {
        return Err("error.vault.reservedName".to_string());
    }

    // No Windows "Vault" e "vault" sao o mesmo arquivo, mas as pastas de backup
    // seriam diferentes; o nome canonico e minusculo, como o frontend ja usa.
    #[cfg(windows)]
    return Ok(lower);
    #[cfg(not(windows))]
    Ok(trimmed.to_string())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn open_folder(path: PathBuf) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|error| format!("error.platform.prepareFolder: {error}"))?;

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|error| format!("error.platform.openFolder: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("error.platform.openFolder: {error}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("error.platform.openFolder: {error}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("error.platform.openFolderUnsupported".to_string())
}

fn is_safe_external_url(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://")
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();

    if !is_safe_external_url(trimmed) {
        return Err("URL externa inválida. Use http:// ou https://.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32")
            .arg("url.dll,FileProtocolHandler")
            .arg(trimmed)
            .spawn()
            .map_err(|error| format!("error.platform.openUrl: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|error| format!("error.platform.openUrl: {error}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|error| format!("error.platform.openUrl: {error}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("error.platform.openUrlUnsupported".to_string())
}

/// Roda trabalho pesado (Argon2, disco, QR) fora da thread principal, para a
/// janela continuar respondendo.
async fn run_blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "error.task.interrupted".to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(secrets_bridge::BridgeState::default())
        .manage(secrets_bridge::BridgeRequests::default())
        .manage(secrets_bridge::broker::BrokerState::default())
        .manage(UniversalBridgeState::default())
        .manage(secure_clipboard::SecureClipboard::default())
        .manage(TrayMenu::default())
        .manage(vault_session::VaultSession::default())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main_window(app);
            secrets_bridge::queue_request(app, &args);
        }))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            secrets_bridge::queue_request(app.handle(), &std::env::args().collect::<Vec<_>>());
            // Cofres e backups antigos foram criados com 0644/0755.
            if let Ok(data_dir) = app.path().app_data_dir() {
                if storage_io::create_private_dir(&data_dir).is_ok() {
                    storage_io::harden_existing_files(&data_dir, 2);
                }
            }
            #[cfg(target_os = "linux")]
            if !tauri::is_dev() {
                // Corrige um autostart salvo por outro executavel (ex.: `tauri dev`).
                let _ = linux_platform::repair_startup();
            }

            tray::build(app)?;

            if std::env::args().any(|arg| arg == "--startup") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                    trim_current_process_working_set();
                }
            }

            Ok(())
        })
        .invoke_handler({
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
                secrets_bridge::bridge_open,
                secrets_bridge::bridge_close,
                secrets_bridge::bridge_prepare,
                secrets_bridge::bridge_launch,
                secrets_bridge::bridge_history,
                secrets_bridge::bridge_take_request,
                secrets_bridge::broker::bridge_take_access_request,
                secrets_bridge::broker::bridge_answer_access_request,
                secrets_bridge::broker::bridge_status,
                secrets_bridge::broker::bridge_set_limits,
                secrets_bridge::broker::bridge_revoke_grant,
                platform_name,
                secure_clipboard::clipboard_write_secret,
                secure_clipboard::clipboard_clear_secret,
                linux_capture_qr,
                hide_to_tray,
                set_tray_labels,
                vault_session::vault_session_unlock,
                vault_session::vault_session_encrypt,
                vault_session::vault_session_verify_password,
                vault_session::vault_session_decrypt,
                vault_session::vault_session_close,
                is_startup_enabled,
                get_startup_status,
                set_startup_enabled,
                load_vault_file,
                save_vault_file,
                restore_vault_file,
                get_storage_info,
                list_vault_files,
                delete_vault_file,
                list_backup_files,
                read_backup_file,
                create_pre_argon2_backup,
                reencrypt_backups,
                encrypt_vault_argon2id,
                decrypt_vault_payload,
                verify_backup_payload,
                open_vault_folder,
                open_backup_folder,
                open_external_url,
                windows_hello_status,
                enable_windows_hello,
                disable_windows_hello,
                unlock_with_windows_hello,
                discard_orphan_windows_hello,
                quarantine_windows_hello,
                decode_qr_from_image_data_url,
                get_windows_clipboard_sequence_number,
                start_windows_screen_snip,
                restore_main_window_after_screen_snip,
                read_windows_clipboard_image_png_data_url
            ];
            move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
                if invoke.message.webview().label() == "bridge-approval"
                    && !["bridge_take_access_request", "bridge_answer_access_request"]
                        .contains(&invoke.message.command())
                {
                    invoke.resolver.reject("error.ipc.commandNotAllowed");
                    return true;
                }
                handler(invoke)
            }
        })
        .build(tauri::generate_context!())
        .expect("erro ao executar o KPassword")
        .run(|app, event| {
            // Senha copiada e senha da sessao nao sobrevivem ao encerramento.
            if let tauri::RunEvent::Exit = event {
                secure_clipboard::clear_now(app);
                vault_session::close(&app.state::<vault_session::VaultSession>());
            }
        });
}

#[cfg(test)]
mod vault_name_tests {
    use super::sanitize_vault_name;

    #[test]
    fn rejects_windows_device_names() {
        for name in ["con", "CON", "nul", "aux", "prn", "com1", "LPT9"] {
            assert!(sanitize_vault_name(Some(name.into())).is_err(), "{name}");
        }
        for name in ["console", "com0", "com10", "lpt", "vault", "trabalho_2"] {
            assert!(sanitize_vault_name(Some(name.into())).is_ok(), "{name}");
        }
    }
}

#[cfg(test)]
mod acl_tests {
    /// Cada comando registrado no handler precisa estar no manifesto do
    /// build.rs, senao o ACL do Tauri recusa a chamada em tempo de execucao.
    #[test]
    fn handler_commands_match_the_app_manifest_and_capabilities() {
        let lib = include_str!("lib.rs");
        let start = lib.find("tauri::generate_handler![").unwrap();
        let end = start + lib[start..].find("];").unwrap();
        let mut handler: Vec<&str> = lib[start..end]
            .lines()
            .skip(1)
            .map(|line| line.trim().trim_end_matches(','))
            .filter(|line| !line.is_empty())
            .map(|line| line.rsplit("::").next().unwrap())
            .collect();
        let build = include_str!("../build.rs");
        let mut manifest: Vec<&str> = build
            .lines()
            .filter_map(|line| line.trim().strip_prefix('"')?.strip_suffix("\","))
            .collect();
        handler.sort();
        manifest.sort();
        assert_eq!(handler, manifest);

        let main = include_str!("../capabilities/default.json");
        let approval = include_str!("../capabilities/bridge-approval.json");
        for command in ["save_vault_file", "clipboard_write_secret", "bridge_open"] {
            assert!(
                main.contains(&format!("\"allow-{}\"", command.replace('_', "-"))),
                "{command}"
            );
            assert!(
                !approval.contains(&format!("\"allow-{}\"", command.replace('_', "-"))),
                "{command}"
            );
        }
        assert_eq!(approval.matches("\"allow-").count(), 2);
    }
}
