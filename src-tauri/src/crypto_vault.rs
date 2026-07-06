use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use zeroize::Zeroize;

const APP_NAME: &str = "KPassword";
const FILE_VERSION: u8 = 1;
const CRYPTO_VERSION_LEGACY: u8 = 1;
const CRYPTO_VERSION_ARGON2ID: u8 = 2;
const LEGACY_KDF: &str = "PBKDF2-SHA-256";
const LEGACY_CIPHER: &str = "AES-GCM";
const LEGACY_AAD: &[u8] = b"KPassword:Vault:v1";
const ARGON2ID_KDF: &str = "argon2id";
const ARGON2ID_CIPHER: &str = "AES-256-GCM";
const GENERIC_CRYPTO_ERROR: &str = "Senha mestra incorreta ou arquivo de cofre invalido.";
const ARGON2ID_MAX_MEMORY_KIB: u32 = 262_144;
const ARGON2ID_MAX_TIME_COST: u32 = 10;
const ARGON2ID_MAX_PARALLELISM: u32 = 4;
const LEGACY_PBKDF2_MAX_ITERATIONS: u32 = 2_000_000;
const BACKUP_VERIFY_SUCCESS_MESSAGE: &str = "backup_verified";
const BACKUP_VERIFY_FAILURE_MESSAGE: &str = "backup_verification_failed";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
pub struct Argon2idParams {
    #[serde(rename = "memoryKiB")]
    pub memory_kib: u32,
    #[serde(rename = "timeCost")]
    pub time_cost: u32,
    pub parallelism: u32,
    #[serde(rename = "outputLength")]
    pub output_length: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct KdfMetadata {
    pub algorithm: String,
    pub params: Argon2idParams,
    pub salt: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CipherMetadata {
    pub algorithm: String,
    pub nonce: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedVaultFileV2 {
    pub version: u8,
    pub app: String,
    pub crypto_version: u8,
    pub kdf: KdfMetadata,
    pub cipher: CipherMetadata,
    pub created_at: String,
    pub updated_at: String,
    pub payload: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupVerificationReport {
    pub ok: bool,
    pub message: String,
    pub backup_version: Option<String>,
    pub crypto_version: Option<u8>,
    pub item_count: Option<usize>,
    pub created_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct LegacyCryptoMetadata {
    algorithm: String,
    kdf: String,
    iterations: u32,
    salt: String,
    iv: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyEncryptedVaultFile {
    version: u8,
    app: String,
    crypto: LegacyCryptoMetadata,
    created_at: String,
    updated_at: String,
    payload: String,
}

pub fn default_argon2id_params() -> Argon2idParams {
    Argon2idParams {
        memory_kib: 65_536,
        time_cost: 3,
        parallelism: 1,
        output_length: 32,
    }
}

pub fn crypto_version(file: &Value) -> u8 {
    file.get("cryptoVersion")
        .and_then(Value::as_u64)
        .and_then(|value| u8::try_from(value).ok())
        .unwrap_or(CRYPTO_VERSION_LEGACY)
}

fn random_bytes(length: usize) -> Result<Vec<u8>, String> {
    let mut bytes = vec![0u8; length];
    getrandom::fill(&mut bytes).map_err(|_| "Falha ao gerar bytes aleatorios.".to_string())?;
    Ok(bytes)
}

fn decode_base64(value: &str) -> Result<Vec<u8>, String> {
    STANDARD
        .decode(value)
        .map_err(|_| GENERIC_CRYPTO_ERROR.to_string())
}

fn encode_base64(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

fn validate_argon2id_params(params: Argon2idParams) -> Result<(), String> {
    if params.memory_kib == 0
        || params.memory_kib > ARGON2ID_MAX_MEMORY_KIB
        || params.time_cost == 0
        || params.time_cost > ARGON2ID_MAX_TIME_COST
        || params.parallelism == 0
        || params.parallelism > ARGON2ID_MAX_PARALLELISM
        || params.output_length != 32
    {
        return Err(GENERIC_CRYPTO_ERROR.to_string());
    }

    Ok(())
}

fn derive_argon2id_key(
    password: &[u8],
    salt: &[u8],
    params: Argon2idParams,
) -> Result<Vec<u8>, String> {
    validate_argon2id_params(params)?;

    if salt.len() < 16 {
        return Err(GENERIC_CRYPTO_ERROR.to_string());
    }

    let argon_params = Params::new(
        params.memory_kib,
        params.time_cost,
        params.parallelism,
        Some(params.output_length),
    )
    .map_err(|_| GENERIC_CRYPTO_ERROR.to_string())?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);
    let mut key = vec![0u8; params.output_length];
    argon2
        .hash_password_into(password, salt, &mut key)
        .map_err(|_| GENERIC_CRYPTO_ERROR.to_string())?;
    Ok(key)
}

fn derive_legacy_pbkdf2_key(
    password: &[u8],
    salt: &[u8],
    iterations: u32,
) -> Result<Vec<u8>, String> {
    if salt.len() < 16 || iterations == 0 || iterations > LEGACY_PBKDF2_MAX_ITERATIONS {
        return Err(GENERIC_CRYPTO_ERROR.to_string());
    }

    let mut key = vec![0u8; 32];
    pbkdf2_hmac::<Sha256>(password, salt, iterations, &mut key);
    Ok(key)
}

fn aad_v2(file: &EncryptedVaultFileV2) -> Vec<u8> {
    format!(
        "KPassword|cryptoVersion={}|kdf.algorithm={}|kdf.memoryKiB={}|kdf.timeCost={}|kdf.parallelism={}|kdf.outputLength={}|kdf.salt={}|cipher.algorithm={}|cipher.nonce={}",
        file.crypto_version,
        file.kdf.algorithm,
        file.kdf.params.memory_kib,
        file.kdf.params.time_cost,
        file.kdf.params.parallelism,
        file.kdf.params.output_length,
        file.kdf.salt,
        file.cipher.algorithm,
        file.cipher.nonce,
    )
    .into_bytes()
}

fn extract_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

pub fn encrypt_vault_v2_default(
    plain_vault_json: &str,
    master_password: &str,
    created_at: Option<&str>,
) -> Result<EncryptedVaultFileV2, String> {
    encrypt_vault_v2_with_params(
        plain_vault_json,
        master_password,
        created_at,
        default_argon2id_params(),
    )
}

fn encrypt_vault_v2_with_params(
    plain_vault_json: &str,
    master_password: &str,
    created_at: Option<&str>,
    params: Argon2idParams,
) -> Result<EncryptedVaultFileV2, String> {
    validate_argon2id_params(params)?;

    let plain_value: Value = serde_json::from_str(plain_vault_json)
        .map_err(|_| "Conteudo do cofre invalido.".to_string())?;
    let updated_at = extract_string(&plain_value, "updatedAt").unwrap_or_default();
    let created_at = created_at
        .map(str::to_string)
        .or_else(|| extract_string(&plain_value, "createdAt"))
        .unwrap_or_else(|| updated_at.clone());

    let salt = random_bytes(32)?;
    let nonce = random_bytes(12)?;
    let mut password_bytes = master_password.as_bytes().to_vec();
    let mut key = match derive_argon2id_key(&password_bytes, &salt, params) {
        Ok(key) => key,
        Err(error) => {
            password_bytes.zeroize();
            return Err(error);
        }
    };

    let mut file = EncryptedVaultFileV2 {
        version: FILE_VERSION,
        app: APP_NAME.to_string(),
        crypto_version: CRYPTO_VERSION_ARGON2ID,
        kdf: KdfMetadata {
            algorithm: ARGON2ID_KDF.to_string(),
            params,
            salt: encode_base64(&salt),
        },
        cipher: CipherMetadata {
            algorithm: ARGON2ID_CIPHER.to_string(),
            nonce: encode_base64(&nonce),
        },
        created_at,
        updated_at,
        payload: String::new(),
    };

    let encrypted_result = (|| {
        let aad = aad_v2(&file);
        let cipher =
            Aes256Gcm::new_from_slice(&key).map_err(|_| GENERIC_CRYPTO_ERROR.to_string())?;
        cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: plain_vault_json.as_bytes(),
                    aad: &aad,
                },
            )
            .map_err(|_| GENERIC_CRYPTO_ERROR.to_string())
    })();

    key.zeroize();
    password_bytes.zeroize();
    let encrypted = encrypted_result?;
    file.payload = encode_base64(&encrypted);
    Ok(file)
}

fn validate_v2_metadata(file: &EncryptedVaultFileV2) -> Result<(), String> {
    if file.version != FILE_VERSION
        || file.app != APP_NAME
        || file.crypto_version != CRYPTO_VERSION_ARGON2ID
        || file.kdf.algorithm != ARGON2ID_KDF
        || file.cipher.algorithm != ARGON2ID_CIPHER
    {
        return Err(GENERIC_CRYPTO_ERROR.to_string());
    }

    Ok(())
}

fn decrypt_v2(file: EncryptedVaultFileV2, master_password: &str) -> Result<String, String> {
    validate_v2_metadata(&file)?;

    let salt = decode_base64(&file.kdf.salt)?;
    let nonce = decode_base64(&file.cipher.nonce)?;
    let payload = decode_base64(&file.payload)?;

    if nonce.len() != 12 {
        return Err(GENERIC_CRYPTO_ERROR.to_string());
    }

    let mut password_bytes = master_password.as_bytes().to_vec();
    let mut key = match derive_argon2id_key(&password_bytes, &salt, file.kdf.params) {
        Ok(key) => key,
        Err(error) => {
            password_bytes.zeroize();
            return Err(error);
        }
    };
    let decrypted_result = (|| {
        let aad = aad_v2(&file);
        let cipher =
            Aes256Gcm::new_from_slice(&key).map_err(|_| GENERIC_CRYPTO_ERROR.to_string())?;
        cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: payload.as_ref(),
                    aad: &aad,
                },
            )
            .map_err(|_| GENERIC_CRYPTO_ERROR.to_string())
    })();

    key.zeroize();
    password_bytes.zeroize();
    let decrypted = decrypted_result?;
    String::from_utf8(decrypted).map_err(|_| GENERIC_CRYPTO_ERROR.to_string())
}

fn validate_legacy_metadata(file: &LegacyEncryptedVaultFile) -> Result<(), String> {
    if file.version != FILE_VERSION
        || file.app != APP_NAME
        || file.crypto.algorithm != LEGACY_CIPHER
        || file.crypto.kdf != LEGACY_KDF
    {
        return Err(GENERIC_CRYPTO_ERROR.to_string());
    }

    Ok(())
}

fn decrypt_legacy(file: LegacyEncryptedVaultFile, master_password: &str) -> Result<String, String> {
    validate_legacy_metadata(&file)?;

    let salt = decode_base64(&file.crypto.salt)?;
    let nonce = decode_base64(&file.crypto.iv)?;
    let payload = decode_base64(&file.payload)?;

    if nonce.len() != 12 {
        return Err(GENERIC_CRYPTO_ERROR.to_string());
    }

    let mut password_bytes = master_password.as_bytes().to_vec();
    let mut key = match derive_legacy_pbkdf2_key(&password_bytes, &salt, file.crypto.iterations) {
        Ok(key) => key,
        Err(error) => {
            password_bytes.zeroize();
            return Err(error);
        }
    };
    let decrypted_result = (|| {
        let cipher =
            Aes256Gcm::new_from_slice(&key).map_err(|_| GENERIC_CRYPTO_ERROR.to_string())?;
        cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: payload.as_ref(),
                    aad: LEGACY_AAD,
                },
            )
            .map_err(|_| GENERIC_CRYPTO_ERROR.to_string())
    })();

    key.zeroize();
    password_bytes.zeroize();
    let decrypted = decrypted_result?;
    String::from_utf8(decrypted).map_err(|_| GENERIC_CRYPTO_ERROR.to_string())
}

pub fn decrypt_vault_file(file: &Value, master_password: &str) -> Result<String, String> {
    match crypto_version(file) {
        CRYPTO_VERSION_ARGON2ID => {
            let v2: EncryptedVaultFileV2 = serde_json::from_value(file.clone())
                .map_err(|_| GENERIC_CRYPTO_ERROR.to_string())?;
            decrypt_v2(v2, master_password)
        }
        CRYPTO_VERSION_LEGACY => {
            let legacy: LegacyEncryptedVaultFile = serde_json::from_value(file.clone())
                .map_err(|_| GENERIC_CRYPTO_ERROR.to_string())?;
            decrypt_legacy(legacy, master_password)
        }
        _ => Err(GENERIC_CRYPTO_ERROR.to_string()),
    }
}

fn failed_backup_verification() -> BackupVerificationReport {
    BackupVerificationReport {
        ok: false,
        message: BACKUP_VERIFY_FAILURE_MESSAGE.to_string(),
        backup_version: None,
        crypto_version: None,
        item_count: None,
        created_at: None,
    }
}

fn extract_backup_version(file: &Value) -> Option<String> {
    let version = file.get("version")?;

    if let Some(number) = version.as_u64() {
        return Some(number.to_string());
    }

    version.as_str().map(str::to_string)
}

fn validate_plain_vault_schema(plain_vault_json: &str) -> Result<usize, String> {
    let value: Value =
        serde_json::from_str(plain_vault_json).map_err(|_| GENERIC_CRYPTO_ERROR.to_string())?;

    if value.get("version").and_then(Value::as_u64) != Some(FILE_VERSION as u64) {
        return Err(GENERIC_CRYPTO_ERROR.to_string());
    }

    if value.get("createdAt").and_then(Value::as_str).is_none()
        || value.get("updatedAt").and_then(Value::as_str).is_none()
    {
        return Err(GENERIC_CRYPTO_ERROR.to_string());
    }

    let Some(credentials) = value.get("credentials").and_then(Value::as_array) else {
        return Err(GENERIC_CRYPTO_ERROR.to_string());
    };

    match value.get("settings") {
        Some(settings) if settings.is_object() => {}
        _ => return Err(GENERIC_CRYPTO_ERROR.to_string()),
    }

    Ok(credentials.len())
}

pub fn verify_backup_payload(raw: &str, master_password: &str) -> BackupVerificationReport {
    if raw.trim().is_empty() || master_password.is_empty() {
        return failed_backup_verification();
    }

    let file: Value = match serde_json::from_str(raw) {
        Ok(value) => value,
        Err(_) => return failed_backup_verification(),
    };

    let crypto_version = crypto_version(&file);
    let mut decrypted = match decrypt_vault_file(&file, master_password) {
        Ok(value) => value,
        Err(_) => return failed_backup_verification(),
    };

    let item_count = validate_plain_vault_schema(&decrypted);
    decrypted.zeroize();

    let Ok(item_count) = item_count else {
        return failed_backup_verification();
    };

    BackupVerificationReport {
        ok: true,
        message: BACKUP_VERIFY_SUCCESS_MESSAGE.to_string(),
        backup_version: extract_backup_version(&file),
        crypto_version: Some(crypto_version),
        item_count: Some(item_count),
        created_at: file
            .get("createdAt")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

#[cfg(test)]
fn encrypt_legacy_for_test(
    plain_vault_json: &str,
    master_password: &str,
    iterations: u32,
) -> LegacyEncryptedVaultFile {
    let salt = vec![7u8; 32];
    let nonce = vec![9u8; 12];
    let mut key = derive_legacy_pbkdf2_key(master_password.as_bytes(), &salt, iterations).unwrap();
    let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plain_vault_json.as_bytes(),
                aad: LEGACY_AAD,
            },
        )
        .unwrap();
    key.zeroize();

    LegacyEncryptedVaultFile {
        version: FILE_VERSION,
        app: APP_NAME.to_string(),
        crypto: LegacyCryptoMetadata {
            algorithm: LEGACY_CIPHER.to_string(),
            kdf: LEGACY_KDF.to_string(),
            iterations,
            salt: encode_base64(&salt),
            iv: encode_base64(&nonce),
        },
        created_at: "2026-01-01T00:00:00.000Z".to_string(),
        updated_at: "2026-01-01T00:00:00.000Z".to_string(),
        payload: encode_base64(&encrypted),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_params() -> Argon2idParams {
        Argon2idParams {
            memory_kib: 256,
            time_cost: 1,
            parallelism: 1,
            output_length: 32,
        }
    }

    fn sample_plaintext() -> String {
        r#"{"version":1,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","credentials":[],"settings":{"autoLockMinutes":3,"backupIntervalHours":4,"clipboardClearSeconds":60}}"#.to_string()
    }

    fn tamper_payload(mut value: Value) -> Value {
        let payload = value.get("payload").and_then(Value::as_str).unwrap();
        let mut bytes = decode_base64(payload).unwrap();
        bytes[0] ^= 0xff;
        value["payload"] = Value::String(encode_base64(&bytes));
        value
    }

    #[test]
    fn default_argon2id_params_match_release_policy() {
        assert_eq!(
            default_argon2id_params(),
            Argon2idParams {
                memory_kib: 65_536,
                time_cost: 3,
                parallelism: 1,
                output_length: 32,
            }
        );
    }

    #[test]
    fn legacy_pbkdf2_v1_opens_with_correct_password() {
        let legacy = encrypt_legacy_for_test(&sample_plaintext(), "correct horse", 10_000);
        let value = serde_json::to_value(legacy).unwrap();
        let decrypted = decrypt_vault_file(&value, "correct horse").unwrap();
        assert_eq!(decrypted, sample_plaintext());
    }

    #[test]
    fn argon2id_v2_opens_with_correct_password() {
        let encrypted =
            encrypt_vault_v2_with_params(&sample_plaintext(), "correct horse", None, test_params())
                .unwrap();
        let value = serde_json::to_value(encrypted).unwrap();
        let decrypted = decrypt_vault_file(&value, "correct horse").unwrap();
        assert_eq!(decrypted, sample_plaintext());
    }

    #[test]
    fn wrong_password_fails() {
        let encrypted =
            encrypt_vault_v2_with_params(&sample_plaintext(), "correct horse", None, test_params())
                .unwrap();
        let value = serde_json::to_value(encrypted).unwrap();
        assert!(decrypt_vault_file(&value, "wrong password").is_err());
    }

    #[test]
    fn tampered_payload_fails() {
        let encrypted =
            encrypt_vault_v2_with_params(&sample_plaintext(), "correct horse", None, test_params())
                .unwrap();
        let value = tamper_payload(serde_json::to_value(encrypted).unwrap());
        assert!(decrypt_vault_file(&value, "correct horse").is_err());
    }

    #[test]
    fn authenticated_metadata_tampering_fails() {
        let encrypted =
            encrypt_vault_v2_with_params(&sample_plaintext(), "correct horse", None, test_params())
                .unwrap();
        let mut value = serde_json::to_value(encrypted).unwrap();
        value["kdf"]["params"]["timeCost"] = Value::Number(2.into());
        assert!(decrypt_vault_file(&value, "correct horse").is_err());
    }

    #[test]
    fn legacy_v1_can_migrate_to_v2() {
        let legacy = encrypt_legacy_for_test(&sample_plaintext(), "correct horse", 10_000);
        let legacy_value = serde_json::to_value(&legacy).unwrap();
        let plaintext = decrypt_vault_file(&legacy_value, "correct horse").unwrap();
        let migrated =
            encrypt_vault_v2_with_params(&plaintext, "correct horse", None, test_params()).unwrap();
        let migrated_value = serde_json::to_value(migrated).unwrap();

        assert_eq!(crypto_version(&legacy_value), 1);
        assert_eq!(crypto_version(&migrated_value), 2);
        assert_eq!(
            decrypt_vault_file(&migrated_value, "correct horse").unwrap(),
            sample_plaintext()
        );
    }

    #[test]
    fn successive_v2_saves_generate_different_nonce() {
        let first =
            encrypt_vault_v2_with_params(&sample_plaintext(), "correct horse", None, test_params())
                .unwrap();
        let second =
            encrypt_vault_v2_with_params(&sample_plaintext(), "correct horse", None, test_params())
                .unwrap();

        assert_ne!(first.cipher.nonce, second.cipher.nonce);
    }

    #[test]
    fn old_backups_remain_openable_after_migration() {
        let legacy = encrypt_legacy_for_test(&sample_plaintext(), "correct horse", 10_000);
        let legacy_value = serde_json::to_value(&legacy).unwrap();
        let plaintext = decrypt_vault_file(&legacy_value, "correct horse").unwrap();
        let _migrated =
            encrypt_vault_v2_with_params(&plaintext, "correct horse", None, test_params()).unwrap();

        assert_eq!(
            decrypt_vault_file(&legacy_value, "correct horse").unwrap(),
            sample_plaintext()
        );
    }

    #[test]
    fn unknown_crypto_version_fails_safely() {
        let encrypted =
            encrypt_vault_v2_with_params(&sample_plaintext(), "correct horse", None, test_params())
                .unwrap();
        let mut value = serde_json::to_value(encrypted).unwrap();
        value["cryptoVersion"] = Value::Number(99.into());

        assert!(decrypt_vault_file(&value, "correct horse").is_err());
    }

    #[test]
    fn missing_v2_metadata_fails_safely() {
        let encrypted =
            encrypt_vault_v2_with_params(&sample_plaintext(), "correct horse", None, test_params())
                .unwrap();
        let mut value = serde_json::to_value(encrypted).unwrap();
        value["cipher"].as_object_mut().unwrap().remove("nonce");

        assert!(decrypt_vault_file(&value, "correct horse").is_err());
    }

    #[test]
    fn excessive_argon2id_memory_is_rejected() {
        let encrypted =
            encrypt_vault_v2_with_params(&sample_plaintext(), "correct horse", None, test_params())
                .unwrap();
        let mut value = serde_json::to_value(encrypted).unwrap();
        value["kdf"]["params"]["memoryKiB"] =
            Value::Number((ARGON2ID_MAX_MEMORY_KIB as u64 + 1).into());

        assert!(decrypt_vault_file(&value, "correct horse").is_err());
    }

    #[test]
    fn excessive_argon2id_time_cost_is_rejected() {
        let encrypted =
            encrypt_vault_v2_with_params(&sample_plaintext(), "correct horse", None, test_params())
                .unwrap();
        let mut value = serde_json::to_value(encrypted).unwrap();
        value["kdf"]["params"]["timeCost"] =
            Value::Number((ARGON2ID_MAX_TIME_COST as u64 + 1).into());

        assert!(decrypt_vault_file(&value, "correct horse").is_err());
    }

    #[test]
    fn excessive_legacy_pbkdf2_iterations_are_rejected() {
        let legacy = encrypt_legacy_for_test(&sample_plaintext(), "correct horse", 10_000);
        let mut value = serde_json::to_value(&legacy).unwrap();
        value["crypto"]["iterations"] =
            Value::Number((LEGACY_PBKDF2_MAX_ITERATIONS as u64 + 1).into());

        assert!(decrypt_vault_file(&value, "correct horse").is_err());
    }

    #[test]
    fn valid_backup_verification_succeeds_without_restoring() {
        let encrypted =
            encrypt_vault_v2_with_params(&sample_plaintext(), "correct horse", None, test_params())
                .unwrap();
        let raw = serde_json::to_string(&encrypted).unwrap();

        let report = verify_backup_payload(&raw, "correct horse");

        assert!(report.ok);
        assert_eq!(report.message, BACKUP_VERIFY_SUCCESS_MESSAGE);
        assert_eq!(report.backup_version.as_deref(), Some("1"));
        assert_eq!(report.crypto_version, Some(CRYPTO_VERSION_ARGON2ID));
        assert_eq!(report.item_count, Some(0));
        assert_eq!(
            report.created_at.as_deref(),
            Some("2026-01-01T00:00:00.000Z")
        );
    }

    #[test]
    fn invalid_json_backup_verification_fails_safely() {
        let report = verify_backup_payload("not json", "correct horse");

        assert!(!report.ok);
        assert_eq!(report.message, BACKUP_VERIFY_FAILURE_MESSAGE);
        assert!(report.crypto_version.is_none());
        assert!(report.item_count.is_none());
    }

    #[test]
    fn wrong_password_backup_verification_fails_safely() {
        let encrypted =
            encrypt_vault_v2_with_params(&sample_plaintext(), "correct horse", None, test_params())
                .unwrap();
        let raw = serde_json::to_string(&encrypted).unwrap();

        let report = verify_backup_payload(&raw, "wrong password");

        assert!(!report.ok);
        assert_eq!(report.message, BACKUP_VERIFY_FAILURE_MESSAGE);
        assert!(report.crypto_version.is_none());
        assert!(report.item_count.is_none());
    }

    #[test]
    fn future_crypto_version_backup_verification_fails_safely() {
        let encrypted =
            encrypt_vault_v2_with_params(&sample_plaintext(), "correct horse", None, test_params())
                .unwrap();
        let mut value = serde_json::to_value(encrypted).unwrap();
        value["cryptoVersion"] = Value::Number(99.into());
        let raw = serde_json::to_string(&value).unwrap();

        let report = verify_backup_payload(&raw, "correct horse");

        assert!(!report.ok);
        assert_eq!(report.message, BACKUP_VERIFY_FAILURE_MESSAGE);
        assert!(report.crypto_version.is_none());
        assert!(report.item_count.is_none());
    }

    #[test]
    fn invalid_decrypted_schema_backup_verification_fails_safely() {
        let encrypted =
            encrypt_vault_v2_with_params("{}", "correct horse", None, test_params()).unwrap();
        let raw = serde_json::to_string(&encrypted).unwrap();

        let report = verify_backup_payload(&raw, "correct horse");

        assert!(!report.ok);
        assert_eq!(report.message, BACKUP_VERIFY_FAILURE_MESSAGE);
        assert!(report.crypto_version.is_none());
        assert!(report.item_count.is_none());
    }
}
