use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use tauri_plugin_notification::NotificationExt;
use zeroize::Zeroize;

mod crypto_vault;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

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

fn storage_paths(
    app: &AppHandle,
    vault_name: Option<String>,
) -> Result<(PathBuf, PathBuf, String), String> {
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

    Ok((
        data_dir.join(vault_filename(&safe_vault_name)),
        backup_dir,
        safe_vault_name,
    ))
}

fn get_backups_from_dir(backup_dir: &Path) -> Result<Vec<BackupFile>, String> {
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

    backups.sort_by_key(|backup| std::cmp::Reverse(backup.modified_epoch_ms));

    Ok(backups)
}

fn should_create_backup(backup_dir: &Path) -> bool {
    let Ok(backups) = get_backups_from_dir(backup_dir) else {
        return true;
    };

    let Some(last_backup) = backups.first() else {
        return true;
    };

    let last_backup_seconds = (last_backup.modified_epoch_ms / 1000) as u64;
    now_epoch_seconds().saturating_sub(last_backup_seconds) >= BACKUP_INTERVAL_SECONDS
}

fn create_labeled_backup(
    backup_dir: &Path,
    safe_vault_name: &str,
    label: Option<&str>,
    payload: &str,
) -> Result<PathBuf, String> {
    let backup_name = match label {
        Some(label) => format!(
            "{}-{}-{}.kpvault",
            safe_vault_name,
            label,
            now_epoch_millis()
        ),
        None => format!("{}-{}.kpvault", safe_vault_name, now_epoch_millis()),
    };
    let backup_path = backup_dir.join(backup_name);

    fs::write(&backup_path, payload.as_bytes())
        .map_err(|error| format!("Erro ao criar backup criptografado: {error}"))?;

    Ok(backup_path)
}

fn create_backup(backup_dir: &Path, safe_vault_name: &str, payload: &str) -> Result<(), String> {
    create_labeled_backup(backup_dir, safe_vault_name, None, payload).map(|_| ())
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

fn show_main_window_sized(app: &AppHandle, width: f64, height: f64) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.unmaximize();
        let _ = window.show();
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
        let _ = window.center();
        let _ = window.set_focus();
    }
}

fn show_main_window_full(app: &AppHandle) {
    show_main_window_sized(app, 1120.0, 720.0);
}

fn show_main_window_compact(app: &AppHandle) {
    show_main_window_sized(app, 430.0, 760.0);
}

fn open_folder(path: PathBuf) -> Result<(), String> {
    fs::create_dir_all(&path)
        .map_err(|error| format!("Erro ao preparar pasta para abrir: {error}"))?;

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Erro ao abrir pasta no Explorer: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Erro ao abrir pasta no Finder: {error}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Erro ao abrir pasta: {error}"))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("Abrir pasta não é suportado nesta plataforma.".to_string())
}

#[tauri::command]
fn open_vault_folder(app: AppHandle, vault_name: Option<String>) -> Result<(), String> {
    let (vault_path, _, _) = storage_paths(&app, vault_name)?;
    let folder = vault_path
        .parent()
        .ok_or_else(|| "Erro ao localizar pasta do cofre.".to_string())?
        .to_path_buf();

    open_folder(folder)
}

#[tauri::command]
fn open_backup_folder(app: AppHandle, vault_name: Option<String>) -> Result<(), String> {
    let (_, backup_dir, _) = storage_paths(&app, vault_name)?;
    open_folder(backup_dir)
}

#[tauri::command]
fn load_vault_file(app: AppHandle, vault_name: Option<String>) -> Result<Option<String>, String> {
    let (vault_path, _, _) = storage_paths(&app, vault_name)?;

    if !vault_path.exists() {
        return Ok(None);
    }

    fs::read_to_string(vault_path)
        .map(Some)
        .map_err(|error| format!("Erro ao carregar o cofre local criptografado: {error}"))
}

#[tauri::command]
fn save_vault_file(
    app: AppHandle,
    payload: String,
    vault_name: Option<String>,
    force_backup: Option<bool>,
) -> Result<StorageInfo, String> {
    let (vault_path, backup_dir, safe_vault_name) = storage_paths(&app, vault_name)?;
    let temp_path = vault_path.with_extension("kpvault.tmp");

    fs::write(&temp_path, payload.as_bytes())
        .map_err(|error| format!("Erro ao gravar arquivo temporário do cofre: {error}"))?;

    fs::rename(&temp_path, &vault_path)
        .map_err(|error| format!("Erro ao atualizar arquivo do cofre: {error}"))?;

    if force_backup.unwrap_or(false) || should_create_backup(&backup_dir) {
        create_backup(&backup_dir, &safe_vault_name, &payload)?;
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
        let safe_name = if name == "vault" {
            "vault".to_string()
        } else {
            name
        };

        if let Ok(metadata) = entry.metadata() {
            vaults.push(VaultFileInfo {
                display_name: if safe_name == "vault" {
                    "Principal".to_string()
                } else {
                    safe_name.replace(['_', '-'], " ")
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
fn list_backup_files(
    app: AppHandle,
    vault_name: Option<String>,
) -> Result<Vec<BackupFile>, String> {
    let (_, backup_dir, _) = storage_paths(&app, vault_name)?;
    get_backups_from_dir(&backup_dir)
}

#[tauri::command]
fn read_backup_file(
    app: AppHandle,
    filename: String,
    vault_name: Option<String>,
) -> Result<String, String> {
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Nome de backup inválido.".to_string());
    }

    let (_, backup_dir, _) = storage_paths(&app, vault_name)?;
    let backup_path = backup_dir.join(filename);

    fs::read_to_string(backup_path)
        .map_err(|error| format!("Erro ao ler backup criptografado: {error}"))
}

#[tauri::command]
fn create_pre_argon2_backup(
    app: AppHandle,
    payload: String,
    vault_name: Option<String>,
) -> Result<StorageInfo, String> {
    let (_, backup_dir, safe_vault_name) = storage_paths(&app, vault_name)?;
    create_labeled_backup(&backup_dir, &safe_vault_name, Some("pre-argon2"), &payload)?;
    build_storage_info(&app, Some(safe_vault_name))
}

#[tauri::command]
fn encrypt_vault_argon2id(
    plain_vault_json: String,
    mut master_password: String,
    created_at: Option<String>,
) -> Result<serde_json::Value, String> {
    let result = crypto_vault::encrypt_vault_v2_default(
        &plain_vault_json,
        &master_password,
        created_at.as_deref(),
    )
    .and_then(|encrypted| {
        serde_json::to_value(encrypted)
            .map_err(|_| "Erro ao preparar cofre criptografado.".to_string())
    });

    master_password.zeroize();
    result
}

#[tauri::command]
fn decrypt_vault_payload(
    file: serde_json::Value,
    mut master_password: String,
) -> Result<String, String> {
    let result = crypto_vault::decrypt_vault_file(&file, &master_password);
    master_password.zeroize();
    result
}

#[tauri::command]
fn verify_backup_payload(
    raw: String,
    mut master_password: String,
) -> crypto_vault::BackupVerificationReport {
    let result = crypto_vault::verify_backup_payload(&raw, &master_password);
    master_password.zeroize();
    result
}
#[cfg(windows)]
mod windows_hello_native {
    use super::{sanitize_vault_name, WindowsHelloStatus};
    use std::ffi::c_void;
    use std::{fs, path::PathBuf, ptr};
    use tauri::{AppHandle, Manager};
    use windows::core::HSTRING;
    use windows::Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    };
    use zeroize::Zeroize;

    #[repr(C)]
    #[allow(non_snake_case)]
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

    type Hwnd = isize;

    const SW_RESTORE: i32 = 9;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_SHOWWINDOW: u32 = 0x0040;
    const HWND_TOPMOST: Hwnd = -1isize;
    const HWND_NOTOPMOST: Hwnd = -2isize;
    const ASFW_ANY: u32 = u32::MAX;

    #[repr(C)]
    struct WindowSearchState {
        process_id: u32,
        hwnd: Hwnd,
    }

    #[link(name = "User32")]
    extern "system" {
        fn EnumWindows(
            callback: Option<unsafe extern "system" fn(Hwnd, isize) -> i32>,
            l_param: isize,
        ) -> i32;
        fn GetWindowThreadProcessId(hwnd: Hwnd, process_id: *mut u32) -> u32;
        fn IsWindowVisible(hwnd: Hwnd) -> i32;
        fn GetWindowTextLengthW(hwnd: Hwnd) -> i32;
        fn GetWindowTextW(hwnd: Hwnd, lp_string: *mut u16, n_max_count: i32) -> i32;
        fn ShowWindow(hwnd: Hwnd, n_cmd_show: i32) -> i32;
        fn SetForegroundWindow(hwnd: Hwnd) -> i32;
        fn BringWindowToTop(hwnd: Hwnd) -> i32;
        fn SetActiveWindow(hwnd: Hwnd) -> Hwnd;
        fn SetFocus(hwnd: Hwnd) -> Hwnd;
        fn SetWindowPos(
            hwnd: Hwnd,
            hwnd_insert_after: Hwnd,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
        fn GetForegroundWindow() -> Hwnd;
        fn AttachThreadInput(id_attach: u32, id_attach_to: u32, attach: i32) -> i32;
        fn AllowSetForegroundWindow(process_id: u32) -> i32;
    }

    #[link(name = "Kernel32")]
    extern "system" {
        fn GetCurrentProcessId() -> u32;
        fn GetCurrentThreadId() -> u32;
    }

    unsafe extern "system" fn enum_kpassword_windows(hwnd: Hwnd, l_param: isize) -> i32 {
        if hwnd == 0 || IsWindowVisible(hwnd) == 0 {
            return 1;
        }

        let state = &mut *(l_param as *mut WindowSearchState);
        let mut process_id = 0u32;
        let _ = GetWindowThreadProcessId(hwnd, &mut process_id as *mut u32);

        if process_id != state.process_id {
            return 1;
        }

        let title_len = GetWindowTextLengthW(hwnd);
        if title_len <= 0 {
            return 1;
        }

        let mut title_buffer = vec![0u16; (title_len as usize) + 1];
        let copied = GetWindowTextW(hwnd, title_buffer.as_mut_ptr(), title_buffer.len() as i32);
        if copied <= 0 {
            return 1;
        }

        let title = String::from_utf16_lossy(&title_buffer[..copied as usize]);
        if title.contains("KPassword") {
            state.hwnd = hwnd;
            return 0;
        }

        1
    }

    fn find_kpassword_hwnd() -> Option<Hwnd> {
        let mut state = WindowSearchState {
            process_id: unsafe { GetCurrentProcessId() },
            hwnd: 0,
        };

        unsafe {
            let _ = EnumWindows(
                Some(enum_kpassword_windows),
                &mut state as *mut WindowSearchState as isize,
            );
        }

        if state.hwnd == 0 {
            None
        } else {
            Some(state.hwnd)
        }
    }

    fn force_windows_hello_foreground() {
        let Some(hwnd) = find_kpassword_hwnd() else {
            return;
        };

        unsafe {
            let _ = AllowSetForegroundWindow(ASFW_ANY);
            let _ = ShowWindow(hwnd, SW_RESTORE);

            let foreground_hwnd = GetForegroundWindow();
            let current_thread = GetCurrentThreadId();
            let mut attached = false;

            if foreground_hwnd != 0 {
                let foreground_thread =
                    GetWindowThreadProcessId(foreground_hwnd, std::ptr::null_mut());
                if foreground_thread != 0 && foreground_thread != current_thread {
                    attached = AttachThreadInput(current_thread, foreground_thread, 1) != 0;
                }
            }

            let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW;
            let _ = SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, flags);
            let _ = BringWindowToTop(hwnd);
            let _ = SetActiveWindow(hwnd);
            let _ = SetFocus(hwnd);
            let _ = SetForegroundWindow(hwnd);
            std::thread::sleep(std::time::Duration::from_millis(180));

            let _ = SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, flags);
            let _ = BringWindowToTop(hwnd);
            let _ = SetActiveWindow(hwnd);
            let _ = SetFocus(hwnd);
            let _ = SetForegroundWindow(hwnd);

            if attached && foreground_hwnd != 0 {
                let foreground_thread =
                    GetWindowThreadProcessId(foreground_hwnd, std::ptr::null_mut());
                let _ = AttachThreadInput(current_thread, foreground_thread, 0);
            }

            std::thread::sleep(std::time::Duration::from_millis(120));
        }
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

    fn token_path(
        app: &AppHandle,
        vault_name: Option<String>,
    ) -> Result<(PathBuf, String), String> {
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
            UserConsentVerifierAvailability::NotConfiguredForUser => {
                "not_configured_for_user".to_string()
            }
            UserConsentVerifierAvailability::DisabledByPolicy => "disabled_by_policy".to_string(),
            UserConsentVerifierAvailability::DeviceBusy => "device_busy".to_string(),
            _ => "unavailable".to_string(),
        }
    }

    fn verification_reason(result: UserConsentVerificationResult) -> String {
        match result {
            UserConsentVerificationResult::Verified => "verified".to_string(),
            UserConsentVerificationResult::DeviceNotPresent => "device_not_present".to_string(),
            UserConsentVerificationResult::NotConfiguredForUser => {
                "not_configured_for_user".to_string()
            }
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
        force_windows_hello_foreground();

        let availability = check_availability()?;

        if availability != UserConsentVerifierAvailability::Available {
            return Err(format!(
                "Windows Hello indisponível: {}",
                availability_reason(availability)
            ));
        }

        let result = UserConsentVerifier::RequestVerificationAsync(&HSTRING::from(reason))
            .map_err(|error| format!("Erro ao abrir Windows Hello: {error}"))?
            .get()
            .map_err(|error| format!("Erro ao validar Windows Hello: {error}"))?;

        if result != UserConsentVerificationResult::Verified {
            return Err(format!(
                "Windows Hello não validado: {}",
                verification_reason(result)
            ));
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
            secret_bytes.zeroize();
            entropy_bytes.zeroize();
            return Err("Erro ao proteger segredo com DPAPI.".to_string());
        }

        let protected =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };

        unsafe {
            let _ = LocalFree(output.pbData as _);
        }

        secret_bytes.zeroize();
        entropy_bytes.zeroize();
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
            protected_bytes.zeroize();
            entropy_bytes.zeroize();
            return Err("Erro ao desbloquear segredo protegido pelo dispositivo.".to_string());
        }

        let unprotected =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };

        unsafe {
            let _ = LocalFree(output.pbData as _);
        }

        protected_bytes.zeroize();
        entropy_bytes.zeroize();

        match String::from_utf8(unprotected) {
            Ok(secret) => Ok(secret),
            Err(error) => {
                let mut bytes = error.into_bytes();
                bytes.zeroize();
                Err("Segredo local inválido.".to_string())
            }
        }
    }

    pub fn status(
        app: AppHandle,
        vault_name: Option<String>,
    ) -> Result<WindowsHelloStatus, String> {
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
        mut master_password: String,
        reason: String,
    ) -> Result<WindowsHelloStatus, String> {
        if master_password.is_empty() {
            return Err("Senha mestra indisponível.".to_string());
        }

        let (path, safe_vault_name) = match token_path(&app, vault_name.clone()) {
            Ok(value) => value,
            Err(error) => {
                master_password.zeroize();
                return Err(error);
            }
        };

        if let Err(error) = verify_user(&reason) {
            master_password.zeroize();
            return Err(error);
        }

        let protected = match protect_secret(&master_password, &safe_vault_name) {
            Ok(value) => value,
            Err(error) => {
                master_password.zeroize();
                return Err(error);
            }
        };
        master_password.zeroize();
        fs::write(path, protected).map_err(|error| {
            format!("Erro ao salvar credencial local do Windows Hello: {error}")
        })?;

        status(app, vault_name)
    }

    pub fn disable(
        app: AppHandle,
        vault_name: Option<String>,
    ) -> Result<WindowsHelloStatus, String> {
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

async fn run_windows_hello_task<T, F>(operation: &'static str, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Falha ao executar Windows Hello ({operation}): {error}"))?
}

#[tauri::command]
async fn windows_hello_status(
    app: AppHandle,
    vault_name: Option<String>,
) -> Result<WindowsHelloStatus, String> {
    #[cfg(windows)]
    {
        run_windows_hello_task("status", move || {
            windows_hello_native::status(app, vault_name)
        })
        .await
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
async fn enable_windows_hello(
    app: AppHandle,
    vault_name: Option<String>,
    master_password: String,
    reason: String,
) -> Result<WindowsHelloStatus, String> {
    #[cfg(windows)]
    {
        show_main_window(&app);
        run_windows_hello_task("enable", move || {
            windows_hello_native::enable(app, vault_name, master_password, reason)
        })
        .await
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
async fn disable_windows_hello(
    app: AppHandle,
    vault_name: Option<String>,
) -> Result<WindowsHelloStatus, String> {
    #[cfg(windows)]
    {
        run_windows_hello_task("disable", move || {
            windows_hello_native::disable(app, vault_name)
        })
        .await
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
async fn unlock_with_windows_hello(
    app: AppHandle,
    vault_name: Option<String>,
    reason: String,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        show_main_window(&app);
        run_windows_hello_task("unlock", move || {
            windows_hello_native::unlock(app, vault_name, reason)
        })
        .await
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        let _ = vault_name;
        let _ = reason;
        Err("Windows Hello disponível apenas no Windows.".to_string())
    }
}

#[cfg(test)]
mod storage_tests {
    use super::*;

    #[test]
    fn pre_argon2_backup_name_is_identifiable_and_preserves_payload() {
        let backup_dir =
            std::env::temp_dir().join(format!("kpassword-pre-argon2-test-{}", now_epoch_millis(),));
        fs::create_dir_all(&backup_dir).unwrap();

        let backup_path = create_labeled_backup(
            &backup_dir,
            "vault",
            Some("pre-argon2"),
            "legacy encrypted payload",
        )
        .unwrap();

        let filename = backup_path.file_name().unwrap().to_string_lossy();
        assert!(filename.contains("pre-argon2"));
        assert_eq!(
            fs::read_to_string(&backup_path).unwrap(),
            "legacy encrypted payload"
        );

        let _ = fs::remove_dir_all(&backup_dir);
    }
}
#[tauri::command]
fn hide_to_tray(
    app: AppHandle,
    reason: String,
    notify: Option<bool>,
    notification_title: Option<String>,
    notification_body: Option<String>,
) {
    let _ = reason;

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }

    if notify.unwrap_or(true) {
        let title = notification_title.unwrap_or_else(|| "KPassword protegido".to_string());
        let body = notification_body
            .unwrap_or_else(|| "O KPassword continua protegido na bandeja.".to_string());

        let _ = app.notification().builder().title(title).body(body).show();
    }
}

fn first_non_empty_qr_payload(payloads: Vec<String>) -> Option<String> {
    payloads
        .into_iter()
        .map(|content| content.trim().to_string())
        .find(|content| !content.is_empty())
}

fn decode_qr_with_rqrr(gray_image: image::GrayImage) -> Option<String> {
    let mut prepared = rqrr::PreparedImage::prepare(gray_image);
    let grids = prepared.detect_grids();

    let mut payloads = Vec::new();
    for grid in grids {
        if let Ok((_meta, content)) = grid.decode() {
            payloads.push(content);
        }
    }

    first_non_empty_qr_payload(payloads)
}

fn decode_qr_with_quircs(gray_image: &image::GrayImage) -> Option<String> {
    let mut decoder = quircs::Quirc::default();
    let codes = decoder.identify(
        gray_image.width() as usize,
        gray_image.height() as usize,
        gray_image.as_raw(),
    );

    let mut payloads = Vec::new();
    for code in codes {
        let Ok(code) = code else {
            continue;
        };
        let Ok(decoded) = code.decode() else {
            continue;
        };
        if let Ok(content) = std::str::from_utf8(&decoded.payload) {
            payloads.push(content.to_string());
        }
    }

    first_non_empty_qr_payload(payloads)
}

fn brighten_qr_image(gray_image: &image::GrayImage) -> image::GrayImage {
    let mut output = gray_image.clone();

    for pixel in output.pixels_mut() {
        let value = pixel[0];
        pixel[0] = if value < 150 { 0 } else { 255 };
    }

    output
}

fn qr_image_variants(decoded_image: &image::DynamicImage) -> Vec<image::GrayImage> {
    let original = decoded_image.to_luma8();
    let mut variants = vec![original.clone(), brighten_qr_image(&original)];

    let max_dimension = original.width().max(original.height());
    if max_dimension < 700 {
        let scaled = image::imageops::resize(
            &original,
            original.width().saturating_mul(2),
            original.height().saturating_mul(2),
            image::imageops::FilterType::Nearest,
        );
        variants.push(scaled.clone());
        variants.push(brighten_qr_image(&scaled));
    }

    variants
}

#[tauri::command]
fn decode_qr_from_image_data_url(data_url: String) -> Result<String, String> {
    let encoded = data_url
        .split_once(',')
        .map(|(_, payload)| payload)
        .unwrap_or(data_url.as_str());

    let image_bytes = general_purpose::STANDARD
        .decode(encoded.as_bytes())
        .map_err(|_| "Imagem inválida ou corrompida.".to_string())?;

    if image_bytes.len() > 12 * 1024 * 1024 {
        return Err("Imagem muito grande. Use um print menor do QR Code.".to_string());
    }

    let decoded_image = image::load_from_memory(&image_bytes)
        .map_err(|_| "Não foi possível abrir a imagem do QR Code.".to_string())?;

    for variant in qr_image_variants(&decoded_image) {
        if let Some(content) = decode_qr_with_quircs(&variant) {
            return Ok(content);
        }

        if let Some(content) = decode_qr_with_rqrr(variant) {
            return Ok(content);
        }
    }

    Err("Não foi possível ler um QR Code nessa imagem.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let open_full_item =
                MenuItem::with_id(app, "open_full", "Abrir APP Completo", true, None::<&str>)?;
            let open_compact_item = MenuItem::with_id(
                app,
                "open_compact",
                "Abrir APP Compacto",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_full_item, &open_compact_item, &quit_item])?;

            TrayIconBuilder::new()
                .tooltip("KPassword")
                .icon(Image::new(
                    include_bytes!("../icons/tray-icon.rgba"),
                    32,
                    32,
                ))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open_full" => {
                        show_main_window_full(app);
                    }
                    "open_compact" => {
                        show_main_window_compact(app);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {
                        println!("Item de menu nao tratado: {:?}", event.id);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        show_main_window(app);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hide_to_tray,
            load_vault_file,
            save_vault_file,
            get_storage_info,
            list_vault_files,
            list_backup_files,
            read_backup_file,
            create_pre_argon2_backup,
            encrypt_vault_argon2id,
            decrypt_vault_payload,
            verify_backup_payload,
            open_vault_folder,
            open_backup_folder,
            windows_hello_status,
            enable_windows_hello,
            disable_windows_hello,
            unlock_with_windows_hello,
            decode_qr_from_image_data_url
        ])
        .run(tauri::generate_context!())
        .expect("erro ao executar o KPassword");
}
