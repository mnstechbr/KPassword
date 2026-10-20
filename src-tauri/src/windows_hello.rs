//! Windows Hello: registro DPAPI da senha mestra por cofre.
use super::*;

/// Limites de tamanho plausiveis para um registro Windows Hello v1.
/// Serve apenas para distinguir arquivo truncado/absurdo de registro utilizavel.
pub(crate) const HELLO_RECORD_MIN_BYTES: u64 = 16;
pub(crate) const HELLO_RECORD_MAX_BYTES: u64 = 64 * 1024;

pub const HELLO_STATE_DISABLED: &str = "disabled";
pub const HELLO_STATE_CONFIGURED: &str = "configured";
pub const HELLO_STATE_STALE: &str = "stale";
pub const HELLO_STATE_INVALID: &str = "invalid";

/// Classifica o estado do registro Windows Hello a partir de fatos observaveis.
///
/// Funcao pura, para permitir teste sem sistema de arquivos nem Windows.
///
/// IMPORTANTE: isto NAO prova vinculo criptografico entre o registro e o cofre.
/// O formato v1 nao oferece essa propriedade. A classificacao apenas separa
/// estados operacionais:
///
/// - `disabled`   nao ha registro;
/// - `stale`      ha registro, mas o cofre correspondente nao existe (orfao);
/// - `invalid`    ha registro, mas com tamanho fora do plausivel;
/// - `configured` ha registro e ha cofre -- utilizavel, sem garantia de que abre.
///
/// Deliberadamente NAO inspecionamos o cabecalho interno do blob DPAPI: seu
/// layout nao e documentado pela Microsoft, e esta fase existe justamente para
/// deixar de depender de comportamento nao documentado.
pub(crate) fn hello_record_state(vault_exists: bool, record_size: Option<u64>) -> &'static str {
    match record_size {
        None => HELLO_STATE_DISABLED,
        Some(_) if !vault_exists => HELLO_STATE_STALE,
        Some(size) if !(HELLO_RECORD_MIN_BYTES..=HELLO_RECORD_MAX_BYTES).contains(&size) => {
            HELLO_STATE_INVALID
        }
        Some(_) => HELLO_STATE_CONFIGURED,
    }
}

/// Caminhos do cofre e do registro Hello, SEM criar diretorios.
pub(crate) fn vault_and_hello_paths(
    app: &AppHandle,
    vault_name: Option<String>,
) -> Result<(PathBuf, PathBuf, String), String> {
    let safe_vault_name = sanitize_vault_name(vault_name)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("error.storage.appDataDir: {error}"))?;

    let vault_path = data_dir.join(vault_filename(&safe_vault_name));
    let record_path = data_dir
        .join("windows_hello")
        .join(format!("{safe_vault_name}.kphello"));

    Ok((vault_path, record_path, safe_vault_name))
}

/// Estado atual do registro Hello para um cofre.
pub(crate) fn classify_hello_record(
    app: &AppHandle,
    vault_name: Option<String>,
) -> Result<(&'static str, String), String> {
    let (vault_path, record_path, safe_vault_name) = vault_and_hello_paths(app, vault_name)?;
    let record_size = fs::metadata(&record_path).ok().map(|meta| meta.len());
    Ok((
        hello_record_state(vault_path.exists(), record_size),
        safe_vault_name,
    ))
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
            .map_err(|error| format!("error.storage.appDataDir: {error}"))?;
        let dir = data_dir.join("windows_hello");
        fs::create_dir_all(&dir)
            .map_err(|error| format!("error.windowsHello.createDir: {error}"))?;
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
            .map_err(|error| format!("error.windowsHello.query: {error}"))?
            .get()
            .map_err(|error| format!("error.windowsHello.query: {error}"))
    }

    fn verify_user(reason: &str) -> Result<(), String> {
        force_windows_hello_foreground();

        let availability = check_availability()?;

        if availability != UserConsentVerifierAvailability::Available {
            return Err(format!(
                "error.windowsHello.unavailable: {}",
                availability_reason(availability)
            ));
        }

        let result = UserConsentVerifier::RequestVerificationAsync(&HSTRING::from(reason))
            .map_err(|error| format!("error.windowsHello.open: {error}"))?
            .get()
            .map_err(|error| format!("error.windowsHello.verify: {error}"))?;

        if result != UserConsentVerificationResult::Verified {
            return Err(format!(
                "error.windowsHello.notVerified: {}",
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
            return Err("error.windowsHello.protect".to_string());
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
            return Err("error.windowsHello.unprotect".to_string());
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
                Err("error.windowsHello.invalidSecret".to_string())
            }
        }
    }

    pub fn status(
        app: AppHandle,
        vault_name: Option<String>,
    ) -> Result<WindowsHelloStatus, String> {
        let (state, safe_vault_name) = super::classify_hello_record(&app, vault_name)?;
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
            // `enabled` deixa de significar "o arquivo existe" e passa a
            // significar "ha registro utilizavel para um cofre existente".
            enabled: state == super::HELLO_STATE_CONFIGURED,
            state: state.to_string(),
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
            return Err("error.vault.passwordUnavailable".to_string());
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
        fs::write(path, protected)
            .map_err(|error| format!("error.windowsHello.saveCredential: {error}"))?;

        status(app, vault_name)
    }

    pub fn disable(
        app: AppHandle,
        vault_name: Option<String>,
    ) -> Result<WindowsHelloStatus, String> {
        let (path, _) = token_path(&app, vault_name.clone())?;

        if path.exists() {
            fs::remove_file(path).map_err(|error| format!("error.windowsHello.remove: {error}"))?;
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
            return Err("error.windowsHello.notEnabled".to_string());
        }

        verify_user(&reason)?;

        let protected = fs::read(path)
            .map_err(|error| format!("error.windowsHello.readCredential: {error}"))?;

        unprotect_secret(&protected, &safe_vault_name)
    }
}

#[cfg(windows)]
pub(crate) async fn run_windows_hello_task<T, F>(
    operation: &'static str,
    task: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("error.windowsHello.operation: {operation}: {error}"))?
}

#[tauri::command]
pub(crate) async fn windows_hello_status(
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
        let _ = app;
        let safe_vault_name = sanitize_vault_name(vault_name)?;
        Ok(WindowsHelloStatus {
            available: false,
            enabled: false,
            state: HELLO_STATE_DISABLED.to_string(),
            reason: "not_windows".to_string(),
            vault_name: safe_vault_name,
        })
    }
}

/// Remove um registro Hello ORFAO (estado `stale`): existe o `.kphello`, mas nao
/// existe o `.kpvault` correspondente.
///
/// Recusa-se a agir em qualquer outro estado -- em particular, nunca remove o
/// registro de um cofre existente. Devolve `true` quando removeu algo.
#[tauri::command]
pub(crate) fn discard_orphan_windows_hello(
    app: AppHandle,
    vault_name: Option<String>,
) -> Result<bool, String> {
    let (state, _) = classify_hello_record(&app, vault_name.clone())?;

    if state != HELLO_STATE_STALE {
        return Ok(false);
    }

    let (_, record_path, _) = vault_and_hello_paths(&app, vault_name)?;
    fs::remove_file(&record_path)
        .map_err(|error| format!("error.windowsHello.removeOrphan: {error}"))?;
    Ok(true)
}

/// Coloca o registro Hello em quarentena, renomeando-o em vez de apagar.
///
/// Usado quando o segredo recuperado nao abre o cofre atual. Preserva o arquivo
/// para diagnostico e evita que a interface continue oferecendo um Hello que
/// comprovadamente nao funciona.
#[tauri::command]
pub(crate) fn quarantine_windows_hello(
    app: AppHandle,
    vault_name: Option<String>,
) -> Result<bool, String> {
    let (_, record_path, _) = vault_and_hello_paths(&app, vault_name)?;

    if !record_path.exists() {
        return Ok(false);
    }

    let quarantined = record_path.with_extension(format!("kphello.invalid-{}", now_epoch_millis()));
    fs::rename(&record_path, &quarantined)
        .map_err(|error| format!("error.windowsHello.quarantine: {error}"))?;
    Ok(true)
}

#[tauri::command]
pub(crate) async fn enable_windows_hello(
    app: AppHandle,
    vault_name: Option<String>,
    reason: String,
) -> Result<WindowsHelloStatus, String> {
    #[cfg(windows)]
    {
        // O registro Hello guarda a senha da sessao aberta deste cofre.
        let safe_vault_name = sanitize_vault_name(vault_name.clone())?;
        let master_password = vault_session::password(&app, &safe_vault_name)
            .ok_or("error.vault.passwordUnavailable")?;
        show_main_window(&app);
        run_windows_hello_task("enable", move || {
            windows_hello_native::enable(app, vault_name, master_password.to_string(), reason)
        })
        .await
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        let safe_vault_name = sanitize_vault_name(vault_name)?;
        let _ = reason;
        Ok(WindowsHelloStatus {
            available: false,
            enabled: false,
            state: HELLO_STATE_DISABLED.to_string(),
            reason: "not_windows".to_string(),
            vault_name: safe_vault_name,
        })
    }
}

#[tauri::command]
pub(crate) async fn disable_windows_hello(
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
        let _ = app;
        let safe_vault_name = sanitize_vault_name(vault_name)?;
        Ok(WindowsHelloStatus {
            available: false,
            enabled: false,
            state: HELLO_STATE_DISABLED.to_string(),
            reason: "not_windows".to_string(),
            vault_name: safe_vault_name,
        })
    }
}

#[tauri::command]
pub(crate) async fn unlock_with_windows_hello(
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
        Err("error.windowsHello.windowsOnly".to_string())
    }
}
