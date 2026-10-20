//! Sessao do cofre desbloqueado.
//!
//! A senha mestra e a chave derivada ficam aqui, em memoria zerada ao fechar,
//! em vez de viverem no estado do React e atravessarem o IPC a cada gravacao.
//! O Argon2id roda uma vez no desbloqueio; cada gravacao reaproveita a chave
//! (mesmo sal) com um nonce novo.
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroizing;

use crate::crypto_vault::{self, EncryptedVaultFileV2, VaultKey};

struct Session {
    vault_name: String,
    password: Zeroizing<String>,
    key: Option<VaultKey>,
}

#[derive(Default)]
pub struct VaultSession(Mutex<Option<Session>>);

const NO_SESSION: &str = "error.vault.passwordUnavailable";

fn lock(state: &VaultSession) -> Result<std::sync::MutexGuard<'_, Option<Session>>, String> {
    state.0.lock().map_err(|_| "error.task.interrupted".to_string())
}

/// Abre a sessao: decifra `file` com a senha e devolve o JSON do cofre.
#[tauri::command]
pub async fn vault_session_unlock(
    app: AppHandle,
    vault_name: Option<String>,
    file: Value,
    master_password: String,
) -> Result<String, String> {
    let master_password = Zeroizing::new(master_password);
    crate::run_blocking(move || {
        let vault_name = crate::sanitize_vault_name(vault_name)?;
        let (plaintext, key) = crypto_vault::unlock_vault_file(&file, &master_password)?;
        let state = app.state::<VaultSession>();
        *lock(&state)? = Some(Session { vault_name, password: master_password, key });
        Ok(plaintext)
    })
    .await
}

/// Cifra o cofre da sessao aberta. Recusa outro cofre que nao o desbloqueado.
#[tauri::command]
pub async fn vault_session_encrypt(
    app: AppHandle,
    vault_name: Option<String>,
    plain_vault_json: String,
    created_at: Option<String>,
) -> Result<EncryptedVaultFileV2, String> {
    let plain_vault_json = Zeroizing::new(plain_vault_json);
    crate::run_blocking(move || {
        let vault_name = crate::sanitize_vault_name(vault_name)?;
        let state = app.state::<VaultSession>();
        let mut session = lock(&state)?;
        let session = session.as_mut().filter(|s| s.vault_name == vault_name).ok_or(NO_SESSION)?;
        if session.key.is_none() {
            // Cofre PBKDF2 aberto nesta sessao: a primeira gravacao migra.
            session.key = Some(VaultKey::generate(&session.password)?);
        }
        let key = session.key.as_ref().ok_or(NO_SESSION)?;
        crypto_vault::encrypt_with_key(&plain_vault_json, key, created_at.as_deref())
    })
    .await
}

/// Confere a senha digitada (exportar CSV, trocar a senha mestra).
#[tauri::command]
pub fn vault_session_verify_password(state: State<'_, VaultSession>, master_password: String) -> bool {
    let master_password = Zeroizing::new(master_password);
    let Ok(session) = lock(&state) else { return false };
    session.as_ref().is_some_and(|s| constant_time_eq(s.password.as_bytes(), master_password.as_bytes()))
}

/// Decifra outro arquivo (ex.: um backup) com a senha da sessao.
#[tauri::command]
pub async fn vault_session_decrypt(app: AppHandle, file: Value) -> Result<String, String> {
    crate::run_blocking(move || {
        let state = app.state::<VaultSession>();
        let password = lock(&state)?.as_ref().map(|s| s.password.clone()).ok_or(NO_SESSION)?;
        crypto_vault::decrypt_vault_file(&file, &password)
    })
    .await
}

#[tauri::command]
pub fn vault_session_close(state: State<'_, VaultSession>) {
    close(&state);
}

pub fn close(state: &VaultSession) {
    if let Ok(mut session) = state.0.lock() {
        *session = None;
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
/// Senha da sessao, se o cofre `vault_name` (ja sanitizado) estiver aberto.
pub fn password(app: &AppHandle, vault_name: &str) -> Option<Zeroizing<String>> {
    let state = app.state::<VaultSession>();
    let session = state.0.lock().ok()?;
    session.as_ref().filter(|s| s.vault_name == vault_name).map(|s| s.password.clone())
}

/// Decifra um arquivo do cofre aberto: sem Argon2id quando ele foi gravado
/// nesta sessao, com a senha nos demais casos.
pub fn decrypt(app: &AppHandle, vault_name: &str, file: &Value) -> Option<Result<String, String>> {
    let state = app.state::<VaultSession>();
    let session = state.0.lock().ok()?;
    let session = session.as_ref().filter(|s| s.vault_name == vault_name)?;
    if let Some(result) = session.key.as_ref().and_then(|key| crypto_vault::decrypt_with_key(file, key)) {
        return Some(result);
    }
    Some(crypto_vault::decrypt_vault_file(file, &session.password))
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |diff, (x, y)| diff | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    const PLAIN: &str = r#"{"version":1,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z","credentials":[],"settings":{}}"#;

    #[test]
    fn session_key_encrypts_files_the_password_still_opens() {
        let key = VaultKey::generate("senha-mestra-longa").unwrap();
        let first = crypto_vault::encrypt_with_key(PLAIN, &key, None).unwrap();
        let second = crypto_vault::encrypt_with_key(PLAIN, &key, None).unwrap();
        assert_eq!(first.kdf.salt, second.kdf.salt);
        assert_ne!(first.cipher.nonce, second.cipher.nonce);

        let value = serde_json::to_value(&second).unwrap();
        assert_eq!(crypto_vault::decrypt_vault_file(&value, "senha-mestra-longa").unwrap(), PLAIN);
        assert_eq!(crypto_vault::decrypt_with_key(&value, &key).unwrap().unwrap(), PLAIN);
        assert!(crypto_vault::decrypt_vault_file(&value, "outra-senha").is_err());
    }

    #[test]
    fn unlock_returns_a_key_that_skips_argon2_on_the_same_file() {
        let file = crypto_vault::encrypt_vault_v2_default(PLAIN, "senha-mestra-longa", None).unwrap();
        let value = serde_json::to_value(&file).unwrap();
        let (plaintext, key) = crypto_vault::unlock_vault_file(&value, "senha-mestra-longa").unwrap();
        assert_eq!(plaintext, PLAIN);
        let key = key.unwrap();
        assert!(crypto_vault::decrypt_with_key(&value, &key).is_some());

        let other = crypto_vault::encrypt_vault_v2_default(PLAIN, "senha-mestra-longa", None).unwrap();
        let other = serde_json::to_value(&other).unwrap();
        assert!(crypto_vault::decrypt_with_key(&other, &key).is_none(), "sal diferente exige a senha");
    }

    #[test]
    fn password_comparison_requires_exact_match() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"abcd"));
    }
}
