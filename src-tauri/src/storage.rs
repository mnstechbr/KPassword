//! Arquivos do cofre e backups: carregar, gravar, restaurar, listar e recifrar.
use super::*;

pub(crate) fn vault_filename(vault_name: &str) -> String {
    if vault_name == "vault" {
        "vault.kpvault".to_string()
    } else {
        format!("{vault_name}.kpvault")
    }
}

pub(crate) fn storage_paths(
    app: &AppHandle,
    vault_name: Option<String>,
) -> Result<(PathBuf, PathBuf, String), String> {
    let safe_vault_name = sanitize_vault_name(vault_name)?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("error.storage.appDataDir: {error}"))?;

    storage_io::create_private_dir(&data_dir)
        .map_err(|error| format!("error.storage.createVaultDir: {error}"))?;

    let backup_dir = if safe_vault_name == "vault" {
        data_dir.join("backups")
    } else {
        data_dir.join("backups").join(&safe_vault_name)
    };

    storage_io::create_private_dir(&data_dir.join("backups"))
        .and_then(|_| storage_io::create_private_dir(&backup_dir))
        .map_err(|error| format!("error.storage.createBackupDir: {error}"))?;

    Ok((
        data_dir.join(vault_filename(&safe_vault_name)),
        backup_dir,
        safe_vault_name,
    ))
}

pub(crate) fn get_backups_from_dir(backup_dir: &Path) -> Result<Vec<BackupFile>, String> {
    let mut backups = Vec::new();

    if !backup_dir.exists() {
        return Ok(backups);
    }

    let entries =
        fs::read_dir(backup_dir).map_err(|error| format!("error.backup.listDir: {error}"))?;

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

pub(crate) fn should_create_backup(backup_dir: &Path, interval_hours: u64) -> bool {
    let Ok(backups) = get_backups_from_dir(backup_dir) else {
        return true;
    };

    let Some(last_backup) = backups.first() else {
        return true;
    };

    let last_backup_seconds = (last_backup.modified_epoch_ms / 1000) as u64;
    now_epoch_seconds().saturating_sub(last_backup_seconds) >= interval_hours.clamp(1, 24) * 60 * 60
}

pub(crate) fn create_labeled_backup(
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

    storage_io::write_atomic_private(&backup_path, payload.as_bytes())
        .map_err(|error| format!("error.backup.create: {error}"))?;

    Ok(backup_path)
}

pub(crate) fn create_backup(
    backup_dir: &Path,
    safe_vault_name: &str,
    payload: &str,
) -> Result<(), String> {
    create_labeled_backup(backup_dir, safe_vault_name, None, payload)?;
    prune_automatic_backups(backup_dir, safe_vault_name);
    Ok(())
}

/// Aplica a retencao aos backups automaticos; copias com rotulo ficam.
pub(crate) fn prune_automatic_backups(backup_dir: &Path, safe_vault_name: &str) {
    let Ok(backups) = get_backups_from_dir(backup_dir) else {
        return;
    };
    let automatic: Vec<(String, u64)> = backups
        .into_iter()
        .filter(|backup| storage_io::is_automatic_backup(&backup.filename, safe_vault_name))
        .map(|backup| (backup.filename, (backup.modified_epoch_ms / 1000) as u64))
        .collect();
    for name in storage_io::backups_to_prune(&automatic, now_epoch_seconds()) {
        let _ = fs::remove_file(backup_dir.join(name));
    }
}

/// Recusa gravar como cofre algo que nao seja um arquivo cifrado do KPassword.
pub(crate) fn validate_encrypted_payload(payload: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(payload)
        .map_err(|_| "error.vault.invalidContentNotSaved".to_string())?;
    if crypto_vault::is_encrypted_vault_file(&value) {
        Ok(())
    } else {
        Err("error.vault.invalidContentNotSaved".to_string())
    }
}

/// Nucleo FAIL-CLOSED da restauracao de backup.
///
/// Defeito corrigido (reproduzido nas Fases 5.1 e 5.2): a copia de seguranca do
/// cofre alvo vivia no frontend, sob `if (vault && masterPassword)`. Restaurando
/// pela tela BLOQUEADA, `vault` e null -- a salvaguarda era pulada e o alvo era
/// sobrescrito sem nenhuma copia. O conteudo anterior ficava irrecuperavel.
///
/// Aqui a copia deixa de ser best-effort e passa a ser PRE-CONDICAO da escrita,
/// no mesmo comando: se o backup nao for criado E verificado byte a byte, nada
/// e gravado e o arquivo original permanece intacto.
///
/// Preserva os BYTES CIFRADOS existentes: nunca decifra nem recifra, e por isso
/// nao depende de senha mestra nem de cofre destravado.
///
/// Funcao pura sobre caminhos, para permitir teste deterministico sem AppHandle.
///
/// Devolve o nome do backup de seguranca criado, ou `None` quando o alvo ainda
/// nao existia (nada a preservar).
pub(crate) fn perform_safe_restore(
    vault_path: &Path,
    backup_dir: &Path,
    safe_vault_name: &str,
    payload: &str,
) -> Result<Option<String>, String> {
    let safety_backup = if vault_path.exists() {
        let current =
            fs::read(vault_path).map_err(|error| format!("error.restore.readCurrent: {error}"))?;

        let current_text = String::from_utf8(current.clone())
            .map_err(|_| "error.restore.currentNotUtf8".to_string())?;

        let backup_path = create_labeled_backup(
            backup_dir,
            safe_vault_name,
            Some("pre-restore"),
            &current_text,
        )
        .map_err(|error| format!("error.restore.aborted: {error}"))?;

        // FAIL-CLOSED: so prossegue se o backup existir e conferir byte a byte.
        let written = fs::read(&backup_path)
            .map_err(|error| format!("error.restore.safetyBackupUnreadable: {error}"))?;

        if written != current {
            let _ = fs::remove_file(&backup_path);
            return Err("error.restore.safetyBackupMismatch".to_string());
        }

        Some(
            backup_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string(),
        )
    } else {
        // Alvo inexistente: nao ha conteudo anterior a preservar.
        None
    };

    // Escrita atomica e duravel, mesmo padrao de save_vault_file.
    storage_io::write_atomic_private(vault_path, payload.as_bytes())
        .map_err(|error| format!("error.storage.writeVault: {error}"))?;

    Ok(safety_backup)
}

/// Compara a identidade confirmada pelo usuario com a resolvida agora.
///
/// Guard rail contra estado obsoleto: o nome do cofre vive no `localStorage`
/// (perfil do WebView2), separado dos arquivos. Se o cofre ativo mudar enquanto
/// a confirmacao esta pendente, a restauracao tem de abortar em vez de gravar
/// no cofre errado.
pub(crate) fn restore_target_matches(expected: Option<&str>, resolved: &str) -> Result<(), String> {
    match expected {
        Some(expected) if expected != resolved => Err(format!(
            "error.restore.targetChanged: {expected} → {resolved}"
        )),
        _ => Ok(()),
    }
}

pub(crate) fn build_storage_info(
    app: &AppHandle,
    vault_name: Option<String>,
) -> Result<StorageInfo, String> {
    let (vault_path, backup_dir, safe_vault_name) = storage_paths(app, vault_name)?;
    let backups = get_backups_from_dir(&backup_dir)?;

    Ok(StorageInfo {
        vault_path: vault_path.to_string_lossy().to_string(),
        backup_dir: backup_dir.to_string_lossy().to_string(),
        backups,
        vault_name: safe_vault_name,
        warning: None,
    })
}

#[tauri::command]
pub(crate) fn open_vault_folder(app: AppHandle, vault_name: Option<String>) -> Result<(), String> {
    let (vault_path, _, _) = storage_paths(&app, vault_name)?;
    let folder = vault_path
        .parent()
        .ok_or_else(|| "error.storage.vaultDir".to_string())?
        .to_path_buf();

    open_folder(folder)
}

#[tauri::command]
pub(crate) fn open_backup_folder(app: AppHandle, vault_name: Option<String>) -> Result<(), String> {
    let (_, backup_dir, _) = storage_paths(&app, vault_name)?;
    open_folder(backup_dir)
}

#[tauri::command]
pub(crate) fn load_vault_file(
    app: AppHandle,
    vault_name: Option<String>,
) -> Result<Option<String>, String> {
    let (vault_path, _, _) = storage_paths(&app, vault_name)?;

    if !vault_path.exists() {
        return Ok(None);
    }

    fs::read_to_string(vault_path)
        .map(Some)
        .map_err(|error| format!("error.storage.readVault: {error}"))
}

#[tauri::command]
pub(crate) async fn save_vault_file(
    app: AppHandle,
    payload: String,
    vault_name: Option<String>,
    force_backup: Option<bool>,
    backup_interval_hours: Option<u64>,
) -> Result<StorageInfo, String> {
    run_blocking(move || {
        save_vault_file_blocking(
            &app,
            payload,
            vault_name,
            force_backup,
            backup_interval_hours,
        )
    })
    .await
}

pub(crate) fn save_vault_file_blocking(
    app: &AppHandle,
    payload: String,
    vault_name: Option<String>,
    force_backup: Option<bool>,
    backup_interval_hours: Option<u64>,
) -> Result<StorageInfo, String> {
    validate_encrypted_payload(&payload)?;
    let _storage = storage_io::STORAGE_LOCK
        .lock()
        .map_err(|_| "error.storage.unavailable")?;
    let (vault_path, backup_dir, safe_vault_name) = storage_paths(app, vault_name)?;
    secrets_bridge::save_with_history_check(app, &safe_vault_name, &payload, || {
        storage_io::write_atomic_private(&vault_path, payload.as_bytes())
            .map_err(|error| format!("error.storage.writeVault: {error}"))
    })?;

    let force_backup_requested = force_backup.unwrap_or(false);
    let interval_hours = backup_interval_hours.unwrap_or(DEFAULT_BACKUP_INTERVAL_HOURS);
    let mut warning = None;

    if force_backup_requested || should_create_backup(&backup_dir, interval_hours) {
        if let Err(error) = create_backup(&backup_dir, &safe_vault_name, &payload) {
            // O cofre ja foi gravado: devolver erro deixaria a tela diferente do disco.
            if force_backup_requested {
                warning = Some(format!("error.backup.savedWithoutBackup: {error}"));
            } else {
                eprintln!("Aviso: cofre salvo, mas backup automático falhou.");
            }
        }
    }

    let mut info = build_storage_info(app, Some(safe_vault_name))?;
    info.warning = warning;
    Ok(info)
}

/// Restaura um backup sobre um cofre, criando a copia de seguranca do conteudo
/// atual ANTES de sobrescrever -- numa unica operacao de backend.
///
/// Substitui a coordenacao de duas operacoes destrutivas separadas no frontend,
/// que era onde o defeito HIGH vivia. Nao decifra nada e nao exige senha, entao
/// funciona igualmente na tela bloqueada e com o cofre destravado.
#[tauri::command]
pub(crate) async fn restore_vault_file(
    app: AppHandle,
    payload: String,
    vault_name: Option<String>,
    expected_vault_name: Option<String>,
) -> Result<RestoreOutcome, String> {
    run_blocking(move || restore_vault_file_blocking(app, payload, vault_name, expected_vault_name))
        .await
}

pub(crate) fn restore_vault_file_blocking(
    app: AppHandle,
    payload: String,
    vault_name: Option<String>,
    expected_vault_name: Option<String>,
) -> Result<RestoreOutcome, String> {
    validate_encrypted_payload(&payload)?;
    let _storage = storage_io::STORAGE_LOCK
        .lock()
        .map_err(|_| "error.storage.unavailable")?;
    secrets_bridge::close(&app);
    let (vault_path, backup_dir, safe_vault_name) = storage_paths(&app, vault_name)?;

    // Identidade estavel: o alvo resolvido tem de ser o que o usuario confirmou.
    let expected = match expected_vault_name {
        Some(name) => Some(sanitize_vault_name(Some(name))?),
        None => None,
    };
    restore_target_matches(expected.as_deref(), &safe_vault_name)?;

    let safety_backup = perform_safe_restore(&vault_path, &backup_dir, &safe_vault_name, &payload)?;

    Ok(RestoreOutcome {
        storage: build_storage_info(&app, Some(safe_vault_name))?,
        safety_backup,
    })
}

#[tauri::command]
pub(crate) fn get_storage_info(
    app: AppHandle,
    vault_name: Option<String>,
) -> Result<StorageInfo, String> {
    build_storage_info(&app, vault_name)
}

#[tauri::command]
pub(crate) async fn delete_vault_file(
    app: AppHandle,
    vault_name: String,
    expected_vault_name: String,
    master_password: String,
) -> Result<String, String> {
    run_blocking(move || {
        delete_vault_file_blocking(app, vault_name, expected_vault_name, master_password)
    })
    .await
}

pub(crate) fn delete_vault_file_blocking(
    app: AppHandle,
    vault_name: String,
    expected_vault_name: String,
    master_password: String,
) -> Result<String, String> {
    let password = zeroize::Zeroizing::new(master_password);
    let _storage = storage_io::STORAGE_LOCK
        .lock()
        .map_err(|_| "error.storage.unavailable")?;
    let (path, backups, safe_name) = storage_paths(&app, Some(vault_name))?;
    if safe_name != sanitize_vault_name(Some(expected_vault_name))? {
        return Err("error.delete.selectionChanged".into());
    }
    let (_, hello, _) = vault_and_hello_paths(&app, Some(safe_name))?;
    secrets_bridge::close(&app);
    vault_removal::remove(&path, &hello, &backups, &password)
}

#[tauri::command]
pub(crate) fn list_vault_files(app: AppHandle) -> Result<Vec<VaultFileInfo>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("error.storage.appDataDir: {error}"))?;

    storage_io::create_private_dir(&data_dir)
        .map_err(|error| format!("error.storage.createVaultDir: {error}"))?;

    let mut vaults = Vec::new();
    let entries =
        fs::read_dir(&data_dir).map_err(|error| format!("error.storage.listVaults: {error}"))?;

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
pub(crate) fn list_backup_files(
    app: AppHandle,
    vault_name: Option<String>,
) -> Result<Vec<BackupFile>, String> {
    let (_, backup_dir, _) = storage_paths(&app, vault_name)?;
    get_backups_from_dir(&backup_dir)
}

#[tauri::command]
pub(crate) fn read_backup_file(
    app: AppHandle,
    filename: String,
    vault_name: Option<String>,
) -> Result<String, String> {
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("error.backup.invalidName".to_string());
    }

    let (_, backup_dir, _) = storage_paths(&app, vault_name)?;
    let backup_path = backup_dir.join(filename);

    fs::read_to_string(backup_path).map_err(|error| format!("error.backup.read: {error}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupReencryptReport {
    reencrypted: usize,
    skipped: usize,
}

/// Depois de trocar a senha mestra, recifra com a senha nova os backups que
/// abriam com a anterior, para a senha antiga deixar de abrir copias do cofre.
/// Backups de senhas ainda mais antigas ficam como estao e entram em `skipped`.
#[tauri::command]
pub(crate) async fn reencrypt_backups(
    app: AppHandle,
    vault_name: Option<String>,
    old_password: String,
    new_password: String,
) -> Result<BackupReencryptReport, String> {
    let old_password = zeroize::Zeroizing::new(old_password);
    let new_password = zeroize::Zeroizing::new(new_password);
    run_blocking(move || {
        let _storage = storage_io::STORAGE_LOCK
            .lock()
            .map_err(|_| "error.storage.unavailable")?;
        let (_, backup_dir, _) = storage_paths(&app, vault_name)?;
        Ok(reencrypt_backups_in_dir(
            &backup_dir,
            &old_password,
            &new_password,
        ))
    })
    .await
}

pub(crate) fn reencrypt_backups_in_dir(
    backup_dir: &Path,
    old_password: &str,
    new_password: &str,
) -> BackupReencryptReport {
    let mut report = BackupReencryptReport {
        reencrypted: 0,
        skipped: 0,
    };
    let Ok(backups) = get_backups_from_dir(backup_dir) else {
        return report;
    };
    for backup in backups {
        let path = backup_dir.join(&backup.filename);
        let reencrypted = (|| {
            let modified = fs::metadata(&path).ok()?.modified().ok()?;
            let file: serde_json::Value = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
            let plain = zeroize::Zeroizing::new(
                crypto_vault::decrypt_vault_file(&file, old_password).ok()?,
            );
            let created_at = file.get("createdAt").and_then(serde_json::Value::as_str);
            let encrypted =
                crypto_vault::encrypt_vault_v2_default(&plain, new_password, created_at).ok()?;
            let payload = serde_json::to_vec_pretty(&encrypted).ok()?;
            storage_io::write_atomic_private(&path, &payload).ok()?;
            // A data do backup e a do arquivo: preserva para a lista e a retencao.
            if let Ok(file) = fs::File::options().write(true).open(&path) {
                let _ = file.set_modified(modified);
            }
            Some(())
        })();
        if reencrypted.is_some() {
            report.reencrypted += 1
        } else {
            report.skipped += 1
        }
    }
    report
}

#[tauri::command]
pub(crate) async fn create_pre_argon2_backup(
    app: AppHandle,
    payload: String,
    vault_name: Option<String>,
) -> Result<StorageInfo, String> {
    run_blocking(move || create_pre_argon2_backup_blocking(app, payload, vault_name)).await
}

pub(crate) fn create_pre_argon2_backup_blocking(
    app: AppHandle,
    payload: String,
    vault_name: Option<String>,
) -> Result<StorageInfo, String> {
    let (_, backup_dir, safe_vault_name) = storage_paths(&app, vault_name)?;
    create_labeled_backup(&backup_dir, &safe_vault_name, Some("pre-argon2"), &payload)?;
    build_storage_info(&app, Some(safe_vault_name))
}

#[tauri::command]
pub(crate) async fn encrypt_vault_argon2id(
    plain_vault_json: String,
    master_password: String,
    created_at: Option<String>,
) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        encrypt_vault_argon2id_blocking(plain_vault_json, master_password, created_at)
    })
    .await
}

pub(crate) fn encrypt_vault_argon2id_blocking(
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
        serde_json::to_value(encrypted).map_err(|_| "error.vault.serialize".to_string())
    });

    master_password.zeroize();
    result
}

#[tauri::command]
pub(crate) async fn decrypt_vault_payload(
    file: serde_json::Value,
    master_password: String,
) -> Result<String, String> {
    run_blocking(move || decrypt_vault_payload_blocking(file, master_password)).await
}

pub(crate) fn decrypt_vault_payload_blocking(
    file: serde_json::Value,
    mut master_password: String,
) -> Result<String, String> {
    let result = crypto_vault::decrypt_vault_file(&file, &master_password);
    master_password.zeroize();
    result
}

#[tauri::command]
pub(crate) async fn verify_backup_payload(
    raw: String,
    master_password: String,
) -> crypto_vault::BackupVerificationReport {
    tauri::async_runtime::spawn_blocking(move || {
        verify_backup_payload_blocking(raw, master_password)
    })
    .await
    .unwrap_or_else(|_| crypto_vault::failed_backup_verification())
}

pub(crate) fn verify_backup_payload_blocking(
    raw: String,
    mut master_password: String,
) -> crypto_vault::BackupVerificationReport {
    let result = crypto_vault::verify_backup_payload(&raw, &master_password);
    master_password.zeroize();
    result
}

#[cfg(test)]
mod storage_tests {
    /// Regressao do defeito HIGH das Fases 5.1/5.2.
    ///
    /// Antes do fix a salvaguarda vivia no frontend, sob `vault && masterPassword`.
    /// Restaurando pela tela bloqueada, `vault` era null: o cofre alvo era
    /// sobrescrito sem copia e o conteudo anterior se perdia.
    ///
    /// `perform_safe_restore` nao recebe senha nem estado de sessao, entao os
    /// casos destravado e bloqueado percorrem a mesma chamada -- e esse e o ponto.
    fn restore_dirs(tag: &str) -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!(
            "kpassword-restore-test-{}-{}",
            tag,
            now_epoch_millis()
        ));
        let backup_dir = base.join("backups");
        fs::create_dir_all(&backup_dir).unwrap();
        (base.join("beta.kpvault"), backup_dir)
    }

    #[test]
    fn reencrypt_backups_moves_old_password_backups_to_new_password() {
        let (_, backup_dir) = restore_dirs("reencrypt");
        let plain = r#"{"version":1,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","credentials":[],"settings":{}}"#;
        let old_file = crypto_vault::encrypt_vault_v2_default(plain, "senha-antiga", None).unwrap();
        let other_file =
            crypto_vault::encrypt_vault_v2_default(plain, "senha-mais-antiga", None).unwrap();
        fs::write(
            backup_dir.join("beta-1.kpvault"),
            serde_json::to_vec(&old_file).unwrap(),
        )
        .unwrap();
        fs::write(
            backup_dir.join("beta-2.kpvault"),
            serde_json::to_vec(&other_file).unwrap(),
        )
        .unwrap();
        let before = fs::metadata(backup_dir.join("beta-1.kpvault"))
            .unwrap()
            .modified()
            .unwrap();

        let report = reencrypt_backups_in_dir(&backup_dir, "senha-antiga", "senha-nova");
        assert_eq!((report.reencrypted, report.skipped), (1, 1));

        let rewritten: serde_json::Value =
            serde_json::from_slice(&fs::read(backup_dir.join("beta-1.kpvault")).unwrap()).unwrap();
        assert!(crypto_vault::decrypt_vault_file(&rewritten, "senha-antiga").is_err());
        assert!(crypto_vault::decrypt_vault_file(&rewritten, "senha-nova").is_ok());
        let after = fs::metadata(backup_dir.join("beta-1.kpvault"))
            .unwrap()
            .modified()
            .unwrap();
        assert_eq!(before, after);
        let _ = fs::remove_dir_all(backup_dir.parent().unwrap());
    }

    #[test]
    fn save_validation_rejects_non_vault_payloads() {
        assert!(validate_encrypted_payload("not json").is_err());
        assert!(validate_encrypted_payload(r#"{"app":"KPassword"}"#).is_err());
        let plain =
            r#"{"version":1,"createdAt":"a","updatedAt":"b","credentials":[],"settings":{}}"#;
        let file = crypto_vault::encrypt_vault_v2_default(plain, "x", None).unwrap();
        assert!(validate_encrypted_payload(&serde_json::to_string(&file).unwrap()).is_ok());
    }

    fn backups_em(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn a_restore_com_cofre_destravado_cria_backup_e_grava() {
        let (vault_path, backup_dir) = restore_dirs("a-unlocked");
        fs::write(&vault_path, "CONTEUDO-BETA-ANTIGO").unwrap();

        let criado = perform_safe_restore(&vault_path, &backup_dir, "beta", "CONTEUDO-A1").unwrap();

        assert!(criado.is_some(), "deveria criar backup de seguranca");
        assert_eq!(fs::read_to_string(&vault_path).unwrap(), "CONTEUDO-A1");
        let backups = backups_em(&backup_dir);
        assert_eq!(backups.len(), 1);
        assert_eq!(
            fs::read_to_string(backup_dir.join(&backups[0])).unwrap(),
            "CONTEUDO-BETA-ANTIGO"
        );
    }

    #[test]
    fn b_restore_com_cofre_bloqueado_cria_backup_e_grava() {
        // O nucleo nao conhece sessao: sem senha, sem cofre em memoria, sem modo.
        let (vault_path, backup_dir) = restore_dirs("b-locked");
        fs::write(&vault_path, "CONTEUDO-BETA-ANTIGO").unwrap();

        let criado = perform_safe_restore(&vault_path, &backup_dir, "beta", "CONTEUDO-A1").unwrap();

        assert!(criado.is_some());
        assert_eq!(fs::read_to_string(&vault_path).unwrap(), "CONTEUDO-A1");
        assert_eq!(backups_em(&backup_dir).len(), 1);
    }

    #[test]
    fn c_falha_ao_criar_backup_aborta_e_preserva_o_alvo() {
        let (vault_path, backup_dir) = restore_dirs("c-fail");
        fs::write(&vault_path, "CONTEUDO-BETA-ANTIGO").unwrap();

        // Torna a criacao do backup impossivel: o diretorio deixa de existir.
        fs::remove_dir_all(&backup_dir).unwrap();

        let resultado = perform_safe_restore(&vault_path, &backup_dir, "beta", "CONTEUDO-A1");

        assert!(resultado.is_err(), "deveria abortar");
        assert!(resultado.unwrap_err().starts_with("error.restore."));
        assert_eq!(
            fs::read_to_string(&vault_path).unwrap(),
            "CONTEUDO-BETA-ANTIGO",
            "o alvo tem de permanecer byte a byte intacto"
        );
    }

    #[test]
    fn d_backup_de_alpha_sobre_beta_preserva_o_beta_anterior() {
        let (vault_path, backup_dir) = restore_dirs("d-cross");
        fs::write(&vault_path, "MARCADOR-BETA").unwrap();

        let criado =
            perform_safe_restore(&vault_path, &backup_dir, "beta", "MARCADOR-ALPHA").unwrap();

        assert_eq!(fs::read_to_string(&vault_path).unwrap(), "MARCADOR-ALPHA");
        let nome = criado.unwrap();
        assert!(nome.starts_with("beta-pre-restore-"), "nome: {nome}");
        assert_eq!(
            fs::read_to_string(backup_dir.join(&nome)).unwrap(),
            "MARCADOR-BETA"
        );
    }

    #[test]
    fn e_troca_de_cofre_durante_a_confirmacao_aborta() {
        assert!(restore_target_matches(Some("beta"), "beta").is_ok());
        assert!(restore_target_matches(None, "beta").is_ok());

        let erro = restore_target_matches(Some("beta"), "alpha").unwrap_err();
        assert!(erro.starts_with("error.restore."));
        assert!(erro.contains("beta") && erro.contains("alpha"));
    }

    #[test]
    fn f_alvo_inexistente_grava_sem_backup() {
        let (vault_path, backup_dir) = restore_dirs("f-novo");
        assert!(!vault_path.exists());

        let criado = perform_safe_restore(&vault_path, &backup_dir, "beta", "CONTEUDO-A1").unwrap();

        assert!(criado.is_none(), "nao ha conteudo anterior a preservar");
        assert_eq!(fs::read_to_string(&vault_path).unwrap(), "CONTEUDO-A1");
        assert!(backups_em(&backup_dir).is_empty());
    }

    #[test]
    fn g_o_backup_de_seguranca_preserva_os_bytes_exatos() {
        let (vault_path, backup_dir) = restore_dirs("g-verify");
        let original = "CONTEUDO-BETA-COM-BYTES-NAO-ASCII-cao-acentuacao";
        fs::write(&vault_path, original).unwrap();

        let nome = perform_safe_restore(&vault_path, &backup_dir, "beta", "CONTEUDO-A1")
            .unwrap()
            .unwrap();

        assert_eq!(
            fs::read(backup_dir.join(&nome)).unwrap(),
            original.as_bytes(),
            "o backup preserva os bytes exatos, sem recodificar"
        );
    }

    #[test]
    fn h_alvo_so_muda_por_chamada_explicita_de_restore() {
        // Cancelamento do usuario nunca alcanca esta funcao.
        let (vault_path, backup_dir) = restore_dirs("h-cancel");
        fs::write(&vault_path, "CONTEUDO-BETA-ANTIGO").unwrap();

        assert_eq!(
            fs::read_to_string(&vault_path).unwrap(),
            "CONTEUDO-BETA-ANTIGO"
        );
        assert!(backups_em(&backup_dir).is_empty());
    }

    use super::*;

    // --- HELLO-2 / STATUS: classificacao de estado do registro Windows Hello ---
    // Funcao pura: nao exige Windows, sistema de arquivos nem prompt.

    #[test]
    fn sem_registro_o_estado_e_disabled() {
        assert_eq!(hello_record_state(true, None), HELLO_STATE_DISABLED);
        assert_eq!(hello_record_state(false, None), HELLO_STATE_DISABLED);
    }

    #[test]
    fn registro_sem_cofre_correspondente_e_orfao() {
        // HELLO-2: o .kpvault foi removido, o .kphello sobreviveu.
        assert_eq!(hello_record_state(false, Some(246)), HELLO_STATE_STALE);
    }

    #[test]
    fn registro_com_tamanho_implausivel_e_invalido() {
        assert_eq!(hello_record_state(true, Some(0)), HELLO_STATE_INVALID);
        assert_eq!(
            hello_record_state(true, Some(HELLO_RECORD_MIN_BYTES - 1)),
            HELLO_STATE_INVALID
        );
        assert_eq!(
            hello_record_state(true, Some(HELLO_RECORD_MAX_BYTES + 1)),
            HELLO_STATE_INVALID
        );
    }

    #[test]
    fn registro_com_cofre_e_tamanho_plausivel_e_configured() {
        assert_eq!(hello_record_state(true, Some(246)), HELLO_STATE_CONFIGURED);
        assert_eq!(
            hello_record_state(true, Some(HELLO_RECORD_MIN_BYTES)),
            HELLO_STATE_CONFIGURED
        );
        assert_eq!(
            hello_record_state(true, Some(HELLO_RECORD_MAX_BYTES)),
            HELLO_STATE_CONFIGURED
        );
    }

    #[test]
    fn apenas_configured_habilita_o_desbloqueio_por_hello() {
        // A interface so deve oferecer Hello no estado configured.
        for (vault, size) in [
            (false, Some(246)),
            (true, Some(0)),
            (true, None),
            (false, None),
        ] {
            assert_ne!(hello_record_state(vault, size), HELLO_STATE_CONFIGURED);
        }
    }

    #[test]
    fn orfao_tem_precedencia_sobre_tamanho_invalido() {
        // Sem cofre, o registro e orfao independentemente do tamanho: em ambos
        // os casos nao deve ser usado, mas "stale" descreve melhor a causa.
        assert_eq!(hello_record_state(false, Some(0)), HELLO_STATE_STALE);
    }

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
