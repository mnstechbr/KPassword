// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    if std::env::args().nth(1).as_deref() == Some("--secrets-bridge-child") {
        std::process::exit(if kpassword_lib::secrets_bridge_child().is_ok() { 0 } else { 1 });
    }
    kpassword_lib::run();
}
