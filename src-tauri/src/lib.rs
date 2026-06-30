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
}

#[derive(Serialize)]
struct WindowsHelloStatus {
    available: bool,
    enabled: bool,
    reason: String,
    vault_name: String,
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

fn sanitize_vault_name(vault_name: Option<String>) -> Result<String, String> {
    let raw = vault_name.unwrap_or_else(|| "vault".to_string());
    let trimmed = raw.trim();

    if trimmed.is_empty() {
        return Ok("vault".to_string());
    }

    if trimmed.len() > 48 {
        return Err("Nome do cofre muito longo.".to_string());
    }

    if !trimmed
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err("Nome de cofre inválido.".to_string());
    }

    Ok(trimmed.to_string())
}

fn vault_filename(vault_name: &str) -> String {
    if vault_name == "vault" {
        "vault.kpvault".to_string()
    } else {
        format!("{vault_name}.kpvault")
    }
}

fn storage_paths(app: &AppHandle, vault_name: Option<String>) -> Result<(PathBuf, PathBuf, String), String> {
    let safe_vault_name = sanitize_vault_name(vault_name)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Erro ao localizar pasta local do app: {error}"))?;

    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Erro ao criar pasta do cofre: {error}"))?;

    let backup_dir = if safe_vault_name == "vault" {
        data_dir.join("backups")
    } else {
        data_dir.join("backups").join(&safe_vault_name)
    };

    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("Erro ao criar pasta de backups: {error}"))?;

    Ok((data_dir.join(vault_filename(&safe_vault_name)), backup_dir, safe_vault_name))
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

fn build_storage_info(app: &AppHandle, vault_name: Option<String>) -> Result<StorageInfo, String> {
    let (vault_path, backup_dir, safe_vault_name) = storage_paths(app, vault_name)?;
    let backups = get_backups_from_dir(&backup_dir)?;

    Ok(StorageInfo {
        vault_path: vault_path.to_string_lossy().to_string(),
        backup_dir: backup_dir.to_string_lossy().to_string(),
        backups,
        vault_name: safe_vault_name,
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
fn load_vault_file(app: AppHandle, vault_name: Option<String>) -> Result<Option<String>, String> {
    let (vault_path, _, _) = storage_paths(&app, vault_name)?;

    if !vault_path.exists() {
        return Ok(None);
    }

    fs::read_to_string(vault_path).map(Some).map_err(|error| {
        format!("Erro ao carregar o cofre local criptografado: {error}")
    })
}

#[tauri::command]
fn save_vault_file(app: AppHandle, payload: String, vault_name: Option<String>) -> Result<StorageInfo, String> {
    let (vault_path, backup_dir, safe_vault_name) = storage_paths(&app, vault_name)?;
    let temp_path = vault_path.with_extension("kpvault.tmp");

    fs::write(&temp_path, payload.as_bytes())
        .map_err(|error| format!("Erro ao gravar arquivo temporário do cofre: {error}"))?;

    fs::rename(&temp_path, &vault_path)
        .map_err(|error| format!("Erro ao atualizar arquivo do cofre: {error}"))?;

    if should_create_backup(&backup_dir) {
        let backup_name = format!("{}-{}.kpvault", safe_vault_name, now_epoch_seconds());
        let backup_path = backup_dir.join(backup_name);

        fs::write(backup_path, payload.as_bytes())
            .map_err(|error| format!("Erro ao criar backup criptografado: {error}"))?;
    }

    build_storage_info(&app, Some(safe_vault_name))
}

#[tauri::command]
fn get_storage_info(app: AppHandle, vault_name: Option<String>) -> Result<StorageInfo, String> {
    build_storage_info(&app, vault_name)
}

#[tauri::command]
fn list_vault_files(app: AppHandle) -> Result<Vec<VaultFileInfo>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Erro ao localizar pasta local do app: {error}"))?;

    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Erro ao criar pasta do cofre: {error}"))?;

    let mut vaults = Vec::new();
    let entries = fs::read_dir(&data_dir)
        .map_err(|error| format!("Erro ao listar cofres locais: {error}"))?;

    for entry in entries.flatten() {
        let path = entry.path();

        if path.extension().and_then(|value| value.to_str()) != Some("kpvault") {
            continue;
        }

        let filename = entry.file_name().to_string_lossy().to_string();
        let name = filename.trim_end_matches(".kpvault").to_string();
        let safe_name = if name == "vault" { "vault".to_string() } else { name };

        if let Ok(metadata) = entry.metadata() {
            vaults.push(VaultFileInfo {
                display_name: if safe_name == "vault" {
                    "Principal".to_string()
                } else {
                    safe_name.replace('_', " ").replace('-', " ")
                },
                filename,
                name: safe_name.clone(),
                size_bytes: metadata.len(),
                modified_epoch_ms: metadata
                    .modified()
                    .map(modified_epoch_ms)
                    .unwrap_or_default(),
                is_default: safe_name == "vault",
            });
        }
    }

    vaults.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then_with(|| b.modified_epoch_ms.cmp(&a.modified_epoch_ms))
    });

    Ok(vaults)
}

#[tauri::command]
fn list_backup_files(app: AppHandle, vault_name: Option<String>) -> Result<Vec<BackupFile>, String> {
    let (_, backup_dir, _) = storage_paths(&app, vault_name)?;
    get_backups_from_dir(&backup_dir)
}

#[tauri::command]
fn read_backup_file(app: AppHandle, filename: String, vault_name: Option<String>) -> Result<String, String> {
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Nome de backup inválido.".to_string());
    }

    let (_, backup_dir, _) = storage_paths(&app, vault_name)?;
    let backup_path = backup_dir.join(filename);

    fs::read_to_string(backup_path)
        .map_err(|error| format!("Erro ao ler backup criptografado: {error}"))
}


#[cfg(windows)]
mod windows_hello_native {
    use super::{sanitize_vault_name, WindowsHelloStatus};
    use std::{fs, path::PathBuf, ptr};
    use tauri::{AppHandle, Manager};
    use windows::core::HSTRING;
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use std::ffi::c_void;

    #[repr(C)]
    struct DATA_BLOB {
        cbData: u32,
        pbData: *mut u8,
    }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    #[link(name = "Crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const DATA_BLOB,
            sz_data_descr: *const u16,
            p_optional_entropy: *const DATA_BLOB,
            pv_reserved: *mut c_void,
            p_prompt_struct: *mut c_void,
            dw_flags: u32,
            p_data_out: *mut DATA_BLOB,
        ) -> i32;

        fn CryptUnprotectData(
            p_data_in: *const DATA_BLOB,
            ppsz_data_descr: *mut *mut u16,
            p_optional_entropy: *const DATA_BLOB,
            pv_reserved: *mut c_void,
            p_prompt_struct: *mut c_void,
            dw_flags: u32,
            p_data_out: *mut DATA_BLOB,
        ) -> i32;
    }

    #[link(name = "Kernel32")]
    extern "system" {
        fn LocalFree(h_mem: *mut c_void) -> *mut c_void;
    }

    fn hello_dir(app: &AppHandle) -> Result<PathBuf, String> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Erro ao localizar pasta local do app: {error}"))?;
        let dir = data_dir.join("windows_hello");
        fs::create_dir_all(&dir)
            .map_err(|error| format!("Erro ao criar pasta do Windows Hello: {error}"))?;
        Ok(dir)
    }

    fn token_path(app: &AppHandle, vault_name: Option<String>) -> Result<(PathBuf, String), String> {
        let safe_vault_name = sanitize_vault_name(vault_name)?;
        let file_name = format!("{safe_vault_name}.kphello");
        Ok((hello_dir(app)?.join(file_name), safe_vault_name))
    }

    fn entropy(vault_name: &str) -> Vec<u8> {
        format!("KPassword.WindowsHello.{vault_name}.v1").into_bytes()
    }

    fn availability_reason(availability: UserConsentVerifierAvailability) -> String {
        match availability {
            UserConsentVerifierAvailability::Available => "available".to_string(),
            UserConsentVerifierAvailability::DeviceNotPresent => "device_not_present".to_string(),
            UserConsentVerifierAvailability::NotConfiguredForUser => "not_configured_for_user".to_string(),
            UserConsentVerifierAvailability::DisabledByPolicy => "disabled_by_policy".to_string(),
            UserConsentVerifierAvailability::DeviceBusy => "device_busy".to_string(),
            _ => "unavailable".to_string(),
        }
    }

    fn verification_reason(result: UserConsentVerificationResult) -> String {
        match result {
            UserConsentVerificationResult::Verified => "verified".to_string(),
            UserConsentVerificationResult::DeviceNotPresent => "device_not_present".to_string(),
            UserConsentVerificationResult::NotConfiguredForUser => "not_configured_for_user".to_string(),
            UserConsentVerificationResult::DisabledByPolicy => "disabled_by_policy".to_string(),
            UserConsentVerificationResult::DeviceBusy => "device_busy".to_string(),
            UserConsentVerificationResult::RetriesExhausted => "retries_exhausted".to_string(),
            UserConsentVerificationResult::Canceled => "canceled".to_string(),
            _ => "failed".to_string(),
        }
    }

    fn check_availability() -> Result<UserConsentVerifierAvailability, String> {
        UserConsentVerifier::CheckAvailabilityAsync()
            .map_err(|error| format!("Erro ao consultar Windows Hello: {error}"))?
            .get()
            .map_err(|error| format!("Erro ao consultar Windows Hello: {error}"))
    }

    fn verify_user(reason: &str) -> Result<(), String> {
        let availability = check_availability()?;

        if availability != UserConsentVerifierAvailability::Available {
            return Err(format!("Windows Hello indisponível: {}", availability_reason(availability)));
        }

        let result = UserConsentVerifier::RequestVerificationAsync(&HSTRING::from(reason))
            .map_err(|error| format!("Erro ao abrir Windows Hello: {error}"))?
            .get()
            .map_err(|error| format!("Erro ao validar Windows Hello: {error}"))?;

        if result != UserConsentVerificationResult::Verified {
            return Err(format!("Windows Hello não validado: {}", verification_reason(result)));
        }

        Ok(())
    }

    fn protect_secret(secret: &str, vault_name: &str) -> Result<Vec<u8>, String> {
        let mut secret_bytes = secret.as_bytes().to_vec();
        let mut entropy_bytes = entropy(vault_name);

        let input = DATA_BLOB {
            cbData: secret_bytes.len() as u32,
            pbData: secret_bytes.as_mut_ptr(),
        };

        let optional_entropy = DATA_BLOB {
            cbData: entropy_bytes.len() as u32,
            pbData: entropy_bytes.as_mut_ptr(),
        };

        let mut output = DATA_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };

        let ok = unsafe {
            CryptProtectData(
                &input,
                ptr::null(),
                &optional_entropy,
                ptr::null_mut(),
                ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };

        if ok == 0 {
            return Err("Erro ao proteger segredo com DPAPI.".to_string());
        }

        let protected = unsafe {
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
        };

        unsafe {
            let _ = LocalFree(output.pbData as _);
        }

        Ok(protected)
    }

    fn unprotect_secret(protected: &[u8], vault_name: &str) -> Result<String, String> {
        let mut protected_bytes = protected.to_vec();
        let mut entropy_bytes = entropy(vault_name);

        let input = DATA_BLOB {
            cbData: protected_bytes.len() as u32,
            pbData: protected_bytes.as_mut_ptr(),
        };

        let optional_entropy = DATA_BLOB {
            cbData: entropy_bytes.len() as u32,
            pbData: entropy_bytes.as_mut_ptr(),
        };

        let mut output = DATA_BLOB {
            cbData: 0,
            pbData: ptr::null_mut(),
        };

        let ok = unsafe {
            CryptUnprotectData(
                &input,
                ptr::null_mut(),
                &optional_entropy,
                ptr::null_mut(),
                ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };

        if ok == 0 {
            return Err("Erro ao desbloquear segredo protegido pelo dispositivo.".to_string());
        }

        let unprotected = unsafe {
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
        };

        unsafe {
            let _ = LocalFree(output.pbData as _);
        }

        String::from_utf8(unprotected)
            .map_err(|_| "Segredo local inválido.".to_string())
    }

    pub fn status(app: AppHandle, vault_name: Option<String>) -> Result<WindowsHelloStatus, String> {
        let (path, safe_vault_name) = token_path(&app, vault_name)?;
        let availability = check_availability();

        let (available, reason) = match availability {
            Ok(value) => (
                value == UserConsentVerifierAvailability::Available,
                availability_reason(value),
            ),
            Err(error) => (false, error),
        };

        Ok(WindowsHelloStatus {
            available,
            enabled: path.exists(),
            reason,
            vault_name: safe_vault_name,
        })
    }

    pub fn enable(
        app: AppHandle,
        vault_name: Option<String>,
        master_password: String,
        reason: String,
    ) -> Result<WindowsHelloStatus, String> {
        if master_password.is_empty() {
            return Err("Senha mestra indisponível.".to_string());
        }

        let (path, safe_vault_name) = token_path(&app, vault_name.clone())?;

        verify_user(&reason)?;

        let protected = protect_secret(&master_password, &safe_vault_name)?;
        fs::write(path, protected)
            .map_err(|error| format!("Erro ao salvar credencial local do Windows Hello: {error}"))?;

        status(app, vault_name)
    }

    pub fn disable(app: AppHandle, vault_name: Option<String>) -> Result<WindowsHelloStatus, String> {
        let (path, _) = token_path(&app, vault_name.clone())?;

        if path.exists() {
            fs::remove_file(path)
                .map_err(|error| format!("Erro ao remover Windows Hello deste cofre: {error}"))?;
        }

        status(app, vault_name)
    }

    pub fn unlock(
        app: AppHandle,
        vault_name: Option<String>,
        reason: String,
    ) -> Result<String, String> {
        let (path, safe_vault_name) = token_path(&app, vault_name)?;

        if !path.exists() {
            return Err("Windows Hello não está ativado para este cofre.".to_string());
        }

        verify_user(&reason)?;

        let protected = fs::read(path)
            .map_err(|error| format!("Erro ao ler credencial local do Windows Hello: {error}"))?;

        unprotect_secret(&protected, &safe_vault_name)
    }
}

#[tauri::command]
fn windows_hello_status(app: AppHandle, vault_name: Option<String>) -> Result<WindowsHelloStatus, String> {
    #[cfg(windows)]
    {
        windows_hello_native::status(app, vault_name)
    }

    #[cfg(not(windows))]
    {
        let safe_vault_name = sanitize_vault_name(vault_name)?;
        Ok(WindowsHelloStatus {
            available: false,
            enabled: false,
            reason: "not_windows".to_string(),
            vault_name: safe_vault_name,
        })
    }
}

#[tauri::command]
fn enable_windows_hello(
    app: AppHandle,
    vault_name: Option<String>,
    master_password: String,
    reason: String,
) -> Result<WindowsHelloStatus, String> {
    #[cfg(windows)]
    {
        windows_hello_native::enable(app, vault_name, master_password, reason)
    }

    #[cfg(not(windows))]
    {
        let safe_vault_name = sanitize_vault_name(vault_name)?;
        let _ = master_password;
        let _ = reason;
        Ok(WindowsHelloStatus {
            available: false,
            enabled: false,
            reason: "not_windows".to_string(),
            vault_name: safe_vault_name,
        })
    }
}

#[tauri::command]
fn disable_windows_hello(app: AppHandle, vault_name: Option<String>) -> Result<WindowsHelloStatus, String> {
    #[cfg(windows)]
    {
        windows_hello_native::disable(app, vault_name)
    }

    #[cfg(not(windows))]
    {
        let safe_vault_name = sanitize_vault_name(vault_name)?;
        Ok(WindowsHelloStatus {
            available: false,
            enabled: false,
            reason: "not_windows".to_string(),
            vault_name: safe_vault_name,
        })
    }
}

#[tauri::command]
fn unlock_with_windows_hello(
    app: AppHandle,
    vault_name: Option<String>,
    reason: String,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        windows_hello_native::unlock(app, vault_name, reason)
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        let _ = vault_name;
        let _ = reason;
        Err("Windows Hello disponível apenas no Windows.".to_string())
    }
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
            list_vault_files,
            list_backup_files,
            read_backup_file,
            windows_hello_status,
            enable_windows_hello,
            disable_windows_hello,
            unlock_with_windows_hello
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar o KPassword");
}

