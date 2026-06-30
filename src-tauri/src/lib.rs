use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use tauri_plugin_autostart::ManagerExt;

const BACKUP_INTERVAL_SECONDS: u64 = 4 * 60 * 60;

#[derive(Serialize)]
struct BackupFile {
    filename: String,
    size_bytes: u64,
    modified_epoch_ms: u128,
}

#[derive(Serialize)]
struct StorageInfo {
    vault_path: String,
    backup_dir: String,
    backups: Vec<BackupFile>,
}

fn now_epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn modified_epoch_ms(modified: SystemTime) -> u128 {
    modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn storage_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Erro ao localizar pasta local do app: {error}"))?;

    let backup_dir = data_dir.join("backups");

    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("Erro ao criar pasta de backups: {error}"))?;

    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Erro ao criar pasta do cofre: {error}"))?;

    Ok((data_dir.join("vault.kpvault"), backup_dir))
}

fn get_backups_from_dir(backup_dir: &PathBuf) -> Result<Vec<BackupFile>, String> {
    let mut backups = Vec::new();

    if !backup_dir.exists() {
        return Ok(backups);
    }

    let entries = fs::read_dir(backup_dir)
        .map_err(|error| format!("Erro ao ler pasta de backups: {error}"))?;

    for entry in entries.flatten() {
        let path = entry.path();

        if path.extension().and_then(|value| value.to_str()) != Some("kpvault") {
            continue;
        }

        if let Ok(metadata) = entry.metadata() {
            backups.push(BackupFile {
                filename: entry.file_name().to_string_lossy().to_string(),
                size_bytes: metadata.len(),
                modified_epoch_ms: metadata
                    .modified()
                    .map(modified_epoch_ms)
                    .unwrap_or_default(),
            });
        }
    }

    backups.sort_by(|a, b| b.modified_epoch_ms.cmp(&a.modified_epoch_ms));

    Ok(backups)
}

fn should_create_backup(backup_dir: &PathBuf) -> bool {
    let Ok(backups) = get_backups_from_dir(backup_dir) else {
        return true;
    };

    let Some(last_backup) = backups.first() else {
        return true;
    };

    let last_backup_seconds = (last_backup.modified_epoch_ms / 1000) as u64;
    now_epoch_seconds().saturating_sub(last_backup_seconds) >= BACKUP_INTERVAL_SECONDS
}

fn build_storage_info(app: &AppHandle) -> Result<StorageInfo, String> {
    let (vault_path, backup_dir) = storage_paths(app)?;
    let backups = get_backups_from_dir(&backup_dir)?;

    Ok(StorageInfo {
        vault_path: vault_path.to_string_lossy().to_string(),
        backup_dir: backup_dir.to_string_lossy().to_string(),
        backups,
    })
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn load_vault_file(app: AppHandle) -> Result<Option<String>, String> {
    let (vault_path, _) = storage_paths(&app)?;

    if !vault_path.exists() {
        return Ok(None);
    }

    fs::read_to_string(vault_path).map(Some).map_err(|error| {
        format!("Erro ao carregar o cofre local criptografado: {error}")
    })
}

#[tauri::command]
fn save_vault_file(app: AppHandle, payload: String) -> Result<StorageInfo, String> {
    let (vault_path, backup_dir) = storage_paths(&app)?;
    let temp_path = vault_path.with_extension("kpvault.tmp");

    fs::write(&temp_path, payload.as_bytes())
        .map_err(|error| format!("Erro ao gravar arquivo temporário do cofre: {error}"))?;

    fs::rename(&temp_path, &vault_path)
        .map_err(|error| format!("Erro ao atualizar arquivo do cofre: {error}"))?;

    if should_create_backup(&backup_dir) {
        let backup_name = format!("vault-{}.kpvault", now_epoch_seconds());
        let backup_path = backup_dir.join(backup_name);

        fs::write(backup_path, payload.as_bytes())
            .map_err(|error| format!("Erro ao criar backup criptografado: {error}"))?;
    }

    build_storage_info(&app)
}

#[tauri::command]
fn get_storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    build_storage_info(&app)
}

#[tauri::command]
fn list_backup_files(app: AppHandle) -> Result<Vec<BackupFile>, String> {
    let (_, backup_dir) = storage_paths(&app)?;
    get_backups_from_dir(&backup_dir)
}

#[tauri::command]
fn read_backup_file(app: AppHandle, filename: String) -> Result<String, String> {
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Nome de backup inválido.".to_string());
    }

    let (_, backup_dir) = storage_paths(&app)?;
    let backup_path = backup_dir.join(filename);

    fs::read_to_string(backup_path)
        .map_err(|error| format!("Erro ao ler backup criptografado: {error}"))
}

#[tauri::command]
fn hide_to_tray(app: AppHandle, reason: String) {
    println!("KPassword enviado para bandeja. Motivo: {}", reason);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Olá, {}! KPassword está rodando.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                let _ = app.autolaunch().enable();
            }

            let open_item = MenuItem::with_id(app, "open", "Abrir KPassword", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair do KPassword", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            TrayIconBuilder::new()
                .tooltip("KPassword")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        show_main_window(app);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {
                        println!("Item de menu não tratado: {:?}", event.id);
                    }
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        let app = tray.app_handle();
                        show_main_window(&app);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            hide_to_tray,
            load_vault_file,
            save_vault_file,
            get_storage_info,
            list_backup_files,
            read_backup_file
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar o KPassword");
}
