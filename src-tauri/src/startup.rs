//! Iniciar com o sistema (registro do Windows ou autostart XDG no Linux).
use super::*;

#[cfg(windows)]
pub(crate) const STARTUP_REGISTRY_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
pub(crate) const STARTUP_VALUE_NAME: &str = "KPassword";

#[cfg(windows)]
pub(crate) fn startup_command_line() -> Result<String, String> {
    let exe =
        std::env::current_exe().map_err(|error| format!("error.startup.executable: {error}"))?;
    Ok(format!("\"{}\" --startup", exe.to_string_lossy()))
}

/// reg.exe e um programa de console: sem esta flag, cada chamada pisca uma janela.
#[cfg(windows)]
pub(crate) fn reg_command() -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = Command::new("reg");
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(windows)]
pub(crate) fn run_reg_command(args: &[&str]) -> Result<(), String> {
    let status = reg_command()
        .args(args)
        .status()
        .map_err(|error| format!("error.startup.registry: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("reg.exe retornou código {:?}", status.code()))
    }
}

#[cfg(windows)]
pub(crate) fn is_startup_enabled_impl() -> bool {
    reg_command()
        .args(["query", STARTUP_REGISTRY_KEY, "/v", STARTUP_VALUE_NAME])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(all(not(windows), not(target_os = "linux")))]
pub(crate) fn is_startup_enabled_impl() -> bool {
    false
}

#[cfg(windows)]
pub(crate) fn set_startup_enabled_impl(enabled: bool) -> Result<(), String> {
    if enabled {
        let command_line = startup_command_line()?;
        run_reg_command(&[
            "add",
            STARTUP_REGISTRY_KEY,
            "/v",
            STARTUP_VALUE_NAME,
            "/t",
            "REG_SZ",
            "/d",
            &command_line,
            "/f",
        ])
    } else if is_startup_enabled_impl() {
        run_reg_command(&[
            "delete",
            STARTUP_REGISTRY_KEY,
            "/v",
            STARTUP_VALUE_NAME,
            "/f",
        ])
    } else {
        Ok(())
    }
}

#[cfg(all(not(windows), not(target_os = "linux")))]
pub(crate) fn set_startup_enabled_impl(_enabled: bool) -> Result<(), String> {
    Err("error.startup.windowsOnly".to_string())
}

#[tauri::command]
pub(crate) fn is_startup_enabled() -> bool {
    is_startup_enabled_impl()
}

#[cfg(target_os = "linux")]
pub(crate) fn is_startup_enabled_impl() -> bool {
    linux_platform::startup_enabled()
}

#[cfg(target_os = "linux")]
pub(crate) fn set_startup_enabled_impl(enabled: bool) -> Result<(), String> {
    linux_platform::set_startup(enabled)
}

#[cfg(target_os = "linux")]
pub(crate) fn get_startup_status_impl() -> StartupStatus {
    StartupStatus {
        enabled: is_startup_enabled_impl(),
        registry_key: linux_platform::autostart_path()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        value_name: "KPassword".into(),
        command_line: linux_platform::startup_command()
            .or_else(|| {
                std::env::current_exe()
                    .ok()
                    .map(|p| format!("{} --startup", p.display()))
            })
            .unwrap_or_default(),
        startup_argument: "--startup".into(),
    }
}

#[cfg(windows)]
pub(crate) fn get_startup_status_impl() -> StartupStatus {
    StartupStatus {
        enabled: is_startup_enabled_impl(),
        registry_key: STARTUP_REGISTRY_KEY.to_string(),
        value_name: STARTUP_VALUE_NAME.to_string(),
        command_line: startup_command_line().unwrap_or_default(),
        startup_argument: "--startup".to_string(),
    }
}

#[cfg(all(not(windows), not(target_os = "linux")))]
pub(crate) fn get_startup_status_impl() -> StartupStatus {
    StartupStatus {
        enabled: false,
        registry_key: "Disponível apenas no Windows".to_string(),
        value_name: "KPassword".to_string(),
        command_line: String::new(),
        startup_argument: "--startup".to_string(),
    }
}

#[tauri::command]
pub(crate) fn get_startup_status() -> StartupStatus {
    get_startup_status_impl()
}

#[tauri::command]
pub(crate) fn set_startup_enabled(enabled: bool) -> Result<bool, String> {
    // Um build de desenvolvimento carrega o devUrl do Vite; registrado no
    // autostart, ele abre "Connection refused" no login. Sempre desativar e
    // permitido, para o usuario conseguir limpar um registro antigo.
    if enabled && tauri::is_dev() {
        return Err("error.startup.devBuild".to_string());
    }
    set_startup_enabled_impl(enabled)?;
    Ok(is_startup_enabled_impl())
}
