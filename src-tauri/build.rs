// Comandos do app: o tauri-build gera as permissoes allow-<comando>, e cada
// janela so chama o que a sua capability (capabilities/*.json) concede.
const COMMANDS: &[&str] = &[
    "bridge_open",
    "bridge_close",
    "bridge_prepare",
    "bridge_launch",
    "bridge_history",
    "bridge_take_request",
    "bridge_take_access_request",
    "bridge_answer_access_request",
    "bridge_status",
    "bridge_set_limits",
    "bridge_revoke_grant",
    "platform_name",
    "clipboard_write_secret",
    "clipboard_clear_secret",
    "linux_capture_qr",
    "hide_to_tray",
    "set_tray_labels",
    "is_startup_enabled",
    "get_startup_status",
    "set_startup_enabled",
    "load_vault_file",
    "save_vault_file",
    "restore_vault_file",
    "get_storage_info",
    "list_vault_files",
    "delete_vault_file",
    "list_backup_files",
    "read_backup_file",
    "create_pre_argon2_backup",
    "reencrypt_backups",
    "encrypt_vault_argon2id",
    "decrypt_vault_payload",
    "verify_backup_payload",
    "open_vault_folder",
    "open_backup_folder",
    "open_external_url",
    "windows_hello_status",
    "enable_windows_hello",
    "disable_windows_hello",
    "unlock_with_windows_hello",
    "discard_orphan_windows_hello",
    "quarantine_windows_hello",
    "decode_qr_from_image_data_url",
    "get_windows_clipboard_sequence_number",
    "start_windows_screen_snip",
    "restore_main_window_after_screen_snip",
    "read_windows_clipboard_image_png_data_url",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("erro ao executar tauri-build");
}
